use tauri::command;
use tauri_plugin_http::reqwest::Url;
use tokio::io::AsyncWriteExt;

async fn remove_partial_download(target_path: &str) {
    let _ = tokio::fs::remove_file(target_path).await;
}

#[command]
pub async fn download_url_to_path(url: String, target_path: String) -> Result<(), String> {
    let parsed_url = Url::parse(&url).map_err(|error| format!("Invalid download URL: {error}"))?;

    match parsed_url.scheme() {
        "https" | "http" => {}
        scheme => return Err(format!("Unsupported download URL scheme: {scheme}")),
    }

    let mut response = tauri_plugin_http::reqwest::Client::new()
        .get(parsed_url)
        .send()
        .await
        .map_err(|error| format!("Failed to download file: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Download failed with status {status}"));
    }

    let mut file = tokio::fs::File::create(&target_path)
        .await
        .map_err(|error| format!("Failed to save file: {error}"))?;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Failed to read downloaded file: {error}"))?
    {
        if let Err(error) = file.write_all(&chunk).await {
            remove_partial_download(&target_path).await;
            return Err(format!("Failed to save file: {error}"));
        }
    }

    if let Err(error) = file.flush().await {
        remove_partial_download(&target_path).await;
        return Err(format!("Failed to finalize file: {error}"));
    }

    Ok(())
}
