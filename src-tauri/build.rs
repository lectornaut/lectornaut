fn main() {
    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-env-changed=TAURI_APP_CHECK_SHARED_SECRET");
    println!("cargo:rerun-if-env-changed=TAURI_APP_CHECK_APP_ID");

    let root_env_path = std::path::Path::new("../.env");
    let _ = dotenvy::from_path(root_env_path);

    for key in ["TAURI_APP_CHECK_SHARED_SECRET", "TAURI_APP_CHECK_APP_ID"] {
        if let Ok(value) = std::env::var(key) {
            println!("cargo:rustc-env={}={}", key, value);
        }
    }

    tauri_build::build()
}
