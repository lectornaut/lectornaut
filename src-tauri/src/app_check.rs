use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCheckProof {
    pub app_id: String,
    pub timestamp_ms: u64,
    pub nonce: String,
    pub signature: String,
}

fn get_env(name: &str) -> Result<String, String> {
    if let Ok(value) = std::env::var(name) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    match name {
        "TAURI_APP_CHECK_SHARED_SECRET" => {
            if let Some(value) = option_env!("TAURI_APP_CHECK_SHARED_SECRET") {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    return Ok(trimmed.to_string());
                }
            }
        }
        "TAURI_APP_CHECK_APP_ID" => {
            if let Some(value) = option_env!("TAURI_APP_CHECK_APP_ID") {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    return Ok(trimmed.to_string());
                }
            }
        }
        _ => {}
    }

    Err(format!("Missing required environment variable: {}", name))
}

fn current_timestamp_ms() -> Result<u64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "System clock is before UNIX epoch".to_string())?;
    Ok(duration.as_millis() as u64)
}

#[command]
pub fn build_app_check_proof(nonce: String) -> Result<AppCheckProof, String> {
    if nonce.len() < 8 || nonce.len() > 200 {
        return Err("Nonce length must be between 8 and 200 characters".to_string());
    }

    let shared_secret = get_env("TAURI_APP_CHECK_SHARED_SECRET")?;
    let app_id = get_env("TAURI_APP_CHECK_APP_ID")?;
    let timestamp_ms = current_timestamp_ms()?;
    let payload = format!("{}:{}:{}", app_id, timestamp_ms, nonce);

    let mut mac = HmacSha256::new_from_slice(shared_secret.as_bytes())
        .map_err(|_| "Failed to initialize proof signer".to_string())?;
    mac.update(payload.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    Ok(AppCheckProof {
        app_id,
        timestamp_ms,
        nonce,
        signature,
    })
}
