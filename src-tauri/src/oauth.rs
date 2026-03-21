use tauri_plugin_http::reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{timeout, Duration};
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

#[command]
pub async fn login_oauth<R: Runtime>(
    app: AppHandle<R>,
    config: OAuthConfig,
) -> Result<OAuthResponse, String> {
    // 0. Parse port from redirect_uri
    let redirect_url =
        Url::parse(&config.redirect_uri).map_err(|e| format!("Invalid redirect_uri: {}", e))?;
    let port = redirect_url.port().unwrap_or(7878);
    let host = redirect_url.host_str().unwrap_or("127.0.0.1");

    // 1. Start listener
    // Note: We bind to the port specified in the redirect_uri to match provider expectations.
    let listener = TcpListener::bind(format!("{}:{}", host, port))
        .await
        .map_err(|e| format!("Port {} is already in use. Please ensure no other instance of the app is running and try again. Error: {}", port, e))?;

    // 2. Construct Auth URL
    let mut url = Url::parse(&config.auth_url).map_err(|e| e.to_string())?;
    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs
            .append_pair("client_id", &config.client_id)
            .append_pair("redirect_uri", &config.redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", &config.scopes);

        if let Some(extra) = &config.extra_params {
            for (key, value) in extra {
                query_pairs.append_pair(key, value);
            }
        }
    }

    // 3. Open Browser
    app.opener()
        .open_url(url.as_str(), None::<String>)
        .map_err(|e| e.to_string())?;

    // 4. Wait for callback with timeout
    let (mut stream, _) = timeout(Duration::from_secs(120), listener.accept())
        .await
        .map_err(|_| "Authentication timed out. Please try again.".to_string())?
        .map_err(|e| e.to_string())?;

    let mut buffer = [0; 4096];
    let len = stream.read(&mut buffer).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..len]);

    // 5. Extract code
    // Request looks like "GET /callback?code=... HTTP/1.1 ..."
    let mut parts = request.split_whitespace();
    let _method = parts.next();
    let path_and_query = parts.next().ok_or("Malformed request")?;

    // Construct a full URL to parse query params
    let full_url = format!("http://localhost:{}{}", port, path_and_query);
    let parsed_url = Url::parse(&full_url).map_err(|e| e.to_string())?;

    let code_pair = parsed_url.query_pairs().find(|(key, _)| key == "code");

    if let Some((_, code)) = code_pair {
        // 6. Send response to browser
        let response_body = include_str!("oauth_success.html");
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/html\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stream.flush().await.map_err(|e| e.to_string())?;

        // 7. Exchange code for token
        let client = Client::new();
        let mut params = std::collections::HashMap::new();
        params.insert("client_id", config.client_id.as_str());
        if let Some(secret) = &config.client_secret {
            params.insert("client_secret", secret.as_str());
        }
        params.insert("code", &code);
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
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/html\r\n\r\n{}",
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
