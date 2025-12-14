use tauri::command;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{timeout, Duration};

#[command]
pub async fn listen_magic_link(port: u16) -> Result<String, String> {
    // 1. Start listener
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
        .await
        .map_err(|e| format!("Port {} is already in use. Error: {}", port, e))?;

    // 2. Wait for callback with timeout (e.g., 5 minutes for user to click link)
    let (mut stream, _) = timeout(Duration::from_secs(300), listener.accept())
        .await
        .map_err(|_| "Authentication timed out. Please try again.".to_string())?
        .map_err(|e| e.to_string())?;

    let mut buffer = [0; 4096];
    let len = stream.read(&mut buffer).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..len]);

    // 3. Extract complete URL or query params
    // Request: "GET /verify?apiKey=...&oobCode=...&mode=signIn&... HTTP/1.1 ..."
    let mut parts = request.split_whitespace();
    let _method = parts.next();
    let path_and_query = match parts.next() {
        Some(p) => p,
        None => {
            let response_body = include_str!("magic_link_failure.html")
                .replace("{{error}}", "Malformed request");
            let response = format!(
                "HTTP/1.1 400 Bad Request\r\nContent-Length: {}\r\nContent-Type: text/html\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.flush().await;
            return Err("Malformed request".to_string());
        }
    };

    // Construct full URL to return to frontend
    // The frontend needs the full link that Firebase sent, but with the correct host
    let full_url = format!("http://localhost:{}{}", port, path_and_query);

    // 4. Send success response
    let response_body = include_str!("magic_link_success.html");

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

    Ok(full_url)
}
