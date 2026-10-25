use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Runtime};
use tauri_plugin_http::reqwest::Client;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;
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

/// Bumped by every new loopback flow. An older flow still waiting on the
/// port (tab closed, webview reloaded) sees the change and drops its listener,
/// so a retry can rebind instead of failing for the old flow's 5-minute wait.
static FLOW_GENERATION: std::sync::LazyLock<watch::Sender<u64>> =
    std::sync::LazyLock::new(|| watch::Sender::new(0));

/// Error returned to a superseded or cancelled flow. Mirrors
/// `BROWSER_FLOW_CANCELLED` in src/helpers/openExternalUrl.ts (the web popup's
/// cancel sentinel too) so callers treat it as a silent cancel.
const SUPERSEDED: &str = "popup_closed";

/// Error returned when no callback arrives before the deadline, which is
/// usually a closed browser tab. Checked by `invokeLoopbackOAuth` in auth.ts.
const TIMED_OUT: &str = "oauth_timeout";

/// Authorize URL of the latest flow, so the app's "Open" can reopen it. The
/// app can't address the system browser's existing tab, only open a new one;
/// whichever tab finishes first wins the still-waiting listener.
static FLOW_URL: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[command]
pub fn reopen_oauth<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let url = FLOW_URL.lock().map_err(|e| e.to_string())?.clone();
    match url {
        Some(url) => app
            .opener()
            .open_url(url, None::<String>)
            .map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Abandon the in-flight loopback flow, if any. The browser can't tell us the
/// tab was closed, so the app's "Cancel" calls this to free the port and
/// settle the pending command with `SUPERSEDED`.
#[command]
pub fn cancel_oauth() {
    FLOW_GENERATION.send_modify(|g| *g += 1);
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

    // 1. Supersede any in-flight flow, then start the listener. The old flow
    //    releases the port asynchronously, so retry the bind briefly.
    FLOW_GENERATION.send_modify(|g| *g += 1);
    let mut cancel = FLOW_GENERATION.subscribe();
    // Note: We bind to the port specified in the redirect_uri to match provider expectations.
    let mut attempts = 0;
    let listener = loop {
        match TcpListener::bind(format!("{}:{}", host, port)).await {
            Ok(listener) => break listener,
            Err(_) if attempts < 20 => {
                attempts += 1;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) => return Err(format!("Port {} is already in use. Please ensure no other instance of the app is running and try again. Error: {}", port, e)),
        }
    };

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
    if let Ok(mut flow_url) = FLOW_URL.lock() {
        *flow_url = Some(url.to_string());
    }
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
    let wait = async {
        loop {
            let (mut candidate, _) = timeout_at(deadline, listener.accept())
                .await
                .map_err(|_| TIMED_OUT.to_string())?
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

            // Request looks like "GET /callback?code=... HTTP/1.1 ...", or a
            // POST with a form body for `response_mode=form_post` (Apple).
            let mut parts = request.split_whitespace();
            let method = parts.next().unwrap_or_default().to_owned();
            let Some(path) = parts.next() else {
                continue;
            };
            let Ok(mut url) = Url::parse(&format!("http://localhost:{}{}", port, path)) else {
                continue;
            };
            if method == "POST" {
                // ponytail: assumes the form body arrived in the same read as the
                // headers (true for the short OAuth posts); loop on Content-Length if not.
                if let Some((_, body)) = request.split_once("\r\n\r\n") {
                    url.set_query(Some(body));
                }
            }

            // Only the redirect carries the authorization response — answer
            // anything else (favicon.ico) with a 404 and keep waiting.
            let params: Vec<(String, String)> = url.query_pairs().into_owned().collect();
            if params
                .iter()
                .any(|(key, _)| key == "code" || key == "error")
            {
                return Ok::<_, String>((candidate, params));
            }
            let _ = candidate
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
        }
    };
    let (mut stream, params) = tokio::select! {
        result = wait => result?,
        _ = cancel.changed() => return Err(SUPERSEDED.to_string()),
    };

    // 5. Extract code
    let param = |name: &str| {
        params
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, v)| v.clone())
    };

    if let Some(code) = param("code") {
        let state = param("state");

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
            loop {
                let accepted = tokio::select! {
                    accepted = timeout_at(grace_deadline, listener.accept()) => accepted,
                    // A newer flow wants the port.
                    _ = cancel.changed() => break,
                };
                let Ok(Ok((mut extra, _))) = accepted else {
                    break;
                };
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

        Ok(CapturedAuthorization { code, state })
    } else {
        // Check for error
        let error = param("error").unwrap_or_else(|| "Unknown error".to_string());
        let error_description = param("error_description").unwrap_or_default();

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
