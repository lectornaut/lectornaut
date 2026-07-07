use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Runtime};
use tauri_plugin_http::reqwest::Client;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{timeout, timeout_at, Duration, Instant};
use url::Url;

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthResponse {
    pub id_token: Option<String>,
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenExchangeResponse {
    access_token: String,
    id_token: Option<String>,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OAuthConfig {
    pub auth_url: String,
    pub token_url: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub redirect_uri: String,
    pub scopes: String,
    pub extra_params: Option<std::collections::HashMap<String, String>>,
}

/// Authorization code (+ optional `state` echo) captured off the loopback
/// redirect — the shared first half of both OAuth commands.
struct CapturedAuthorization {
    code: String,
    state: Option<String>,
}

/// Drive the system-browser authorization leg: bind the loopback listener,
/// open the consent page in the default browser, wait for the redirect, parse
/// `code`/`state` (or the provider error), and answer the browser tab with
/// the success/failure page. Shared by `login_oauth` (which then exchanges
/// the code locally — Firebase sign-in) and `authorize_oauth` (which returns
/// the raw code for a SERVER-side exchange — Connections).
async fn run_loopback_authorization<R: Runtime>(
    app: &AppHandle<R>,
    auth_url: &str,
    client_id: &str,
    redirect_uri: &str,
    scopes: &str,
    extra_params: Option<&std::collections::HashMap<String, String>>,
) -> Result<CapturedAuthorization, String> {
    // 0. Parse port from redirect_uri
    let redirect_url =
        Url::parse(redirect_uri).map_err(|e| format!("Invalid redirect_uri: {}", e))?;
    let port = redirect_url.port().unwrap_or(7878);
    let host = redirect_url.host_str().unwrap_or("127.0.0.1");

    // 1. Start listener
    // Note: We bind to the port specified in the redirect_uri to match provider expectations.
    let listener = TcpListener::bind(format!("{}:{}", host, port))
        .await
        .map_err(|e| format!("Port {} is already in use. Please ensure no other instance of the app is running and try again. Error: {}", port, e))?;

    // 2. Construct Auth URL
    let mut url = Url::parse(auth_url).map_err(|e| e.to_string())?;
    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", scopes);

        if let Some(extra) = extra_params {
            for (key, value) in extra {
                query_pairs.append_pair(key, value);
            }
        }
    }

    // 3. Open Browser
    app.opener()
        .open_url(url.as_str(), None::<String>)
        .map_err(|e| e.to_string())?;

    // 4. Wait for the REAL callback under one overall deadline. The old
    //    one-shot accept() with 120s died two ways in practice: browsers open
    //    speculative preconnect sockets and fetch /favicon.ico against the
    //    loopback origin (a stray consumed the single accept and closed the
    //    port — the actual redirect then hit ERR_CONNECTION_REFUSED), and
    //    restricted-scope consent (unverified-app interstitial + granular
    //    checkboxes, e.g. gmail.readonly) routinely outlasts 120s. So: loop,
    //    skip/answer strays, and give the human 5 minutes.
    let deadline = Instant::now() + Duration::from_secs(300);
    let (mut stream, path_and_query) = loop {
        let (mut candidate, _) = timeout_at(deadline, listener.accept())
            .await
            .map_err(|_| "Authentication timed out. Please try again.".to_string())?
            .map_err(|e| e.to_string())?;

        // A silent preconnect never sends bytes — bound the read so it can't
        // wedge the loop (the real request waits in the accept backlog).
        let mut buffer = [0; 4096];
        let len = match timeout(Duration::from_secs(5), candidate.read(&mut buffer)).await {
            Ok(Ok(len)) if len > 0 => len,
            // Empty, aborted, or idle connection — not the callback.
            _ => continue,
        };
        let request = String::from_utf8_lossy(&buffer[..len]).into_owned();

        // Request looks like "GET /callback?code=... HTTP/1.1 ..."
        let mut parts = request.split_whitespace();
        let _method = parts.next();
        let Some(path_and_query) = parts.next().map(str::to_owned) else {
            continue;
        };

        // Only the redirect carries the authorization response — answer
        // anything else (favicon.ico) with a 404 and keep waiting.
        let full_url = format!("http://localhost:{}{}", port, path_and_query);
        let is_callback = Url::parse(&full_url)
            .map(|u| {
                u.query_pairs()
                    .any(|(key, _)| key == "code" || key == "error")
            })
            .unwrap_or(false);
        if is_callback {
            break (candidate, path_and_query);
        }
        let _ = candidate
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await;
    };

    // 5. Extract code
    let full_url = format!("http://localhost:{}{}", port, path_and_query);
    let parsed_url = Url::parse(&full_url).map_err(|e| e.to_string())?;

    let code_pair = parsed_url.query_pairs().find(|(key, _)| key == "code");

    if let Some((_, code)) = code_pair {
        let state = parsed_url
            .query_pairs()
            .find(|(key, _)| key == "state")
            .map(|(_, v)| v.to_string());

        // 6. Send response to browser
        let response_body = include_str!("oauth_success.html");
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stream.flush().await.map_err(|e| e.to_string())?;

        // Grace window: keep serving the success page to immediate
        // follow-ups (favicon.ico, a reflexive reload, a second navigation
        // racing the shutdown) — a refused tab right after a SUCCESSFUL
        // capture reads as failure. Detached so the code returns to the
        // caller immediately; the listener dies with the task, freeing the
        // port for the next flow.
        tokio::spawn(async move {
            let grace_deadline = Instant::now() + Duration::from_secs(5);
            while let Ok(Ok((mut extra, _))) = timeout_at(grace_deadline, listener.accept()).await {
                let mut sink = [0; 4096];
                let _ = timeout(Duration::from_secs(1), extra.read(&mut sink)).await;
                let body = include_str!("oauth_success.html");
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = extra.write_all(response.as_bytes()).await;
                let _ = extra.flush().await;
            }
        });

        Ok(CapturedAuthorization {
            code: code.to_string(),
            state,
        })
    } else {
        // Check for error
        let error = parsed_url
            .query_pairs()
            .find(|(key, _)| key == "error")
            .map(|(_, v)| v.to_string())
            .unwrap_or_else(|| "Unknown error".to_string());

        let error_description = parsed_url
            .query_pairs()
            .find(|(key, _)| key == "error_description")
            .map(|(_, v)| v.to_string())
            .unwrap_or_default();

        let error_message = if error_description.is_empty() {
            error.clone()
        } else {
            format!("{}: {}", error, error_description)
        };

        // Send failure response
        let response_template = include_str!("oauth_failure.html");
        let response_body = response_template.replace("{{error}}", &error_message);

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stream.flush().await.map_err(|e| e.to_string())?;

        Err(format!("OAuth failed: {}", error_message))
    }
}

#[command]
pub async fn login_oauth<R: Runtime>(
    app: AppHandle<R>,
    config: OAuthConfig,
) -> Result<OAuthResponse, String> {
    let captured = run_loopback_authorization(
        &app,
        &config.auth_url,
        &config.client_id,
        &config.redirect_uri,
        &config.scopes,
        config.extra_params.as_ref(),
    )
    .await?;

    // 7. Exchange code for token
    let client = Client::new();
    let mut params = std::collections::HashMap::new();
    params.insert("client_id", config.client_id.as_str());
    if let Some(secret) = &config.client_secret {
        params.insert("client_secret", secret.as_str());
    }
    params.insert("code", captured.code.as_str());
    params.insert("grant_type", "authorization_code");
    params.insert("redirect_uri", config.redirect_uri.as_str());

    let res = client
        .post(&config.token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let error_text = res
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Token exchange failed: {}", error_text));
    }

    let token_res = res
        .json::<TokenExchangeResponse>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    Ok(OAuthResponse {
        id_token: token_res.id_token,
        access_token: token_res.access_token,
        refresh_token: token_res.refresh_token,
    })
}

/// Config for the authorization-only flow — no `token_url`/`client_secret`:
/// the captured code is exchanged SERVER-side (Cloud Functions hold the
/// client secret and persist the refresh token). Used by Connections.
#[derive(Debug, Deserialize)]
pub struct AuthorizeOnlyConfig {
    pub auth_url: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub scopes: String,
    pub extra_params: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
pub struct AuthorizationCodeResponse {
    pub code: String,
    /// Echo of the caller-supplied `state` — the frontend MUST verify it
    /// matches what it sent (CSRF binding) before using the code.
    pub state: Option<String>,
}

/// System-browser authorization WITHOUT a local token exchange: returns the
/// one-time authorization code for the webview to forward to the backend.
/// Tokens never exist inside the app.
#[command]
pub async fn authorize_oauth<R: Runtime>(
    app: AppHandle<R>,
    config: AuthorizeOnlyConfig,
) -> Result<AuthorizationCodeResponse, String> {
    let captured = run_loopback_authorization(
        &app,
        &config.auth_url,
        &config.client_id,
        &config.redirect_uri,
        &config.scopes,
        config.extra_params.as_ref(),
    )
    .await?;

    Ok(AuthorizationCodeResponse {
        code: captured.code,
        state: captured.state,
    })
}
