use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use window_vibrancy::*;

mod app_check;
mod downloads;
mod file_capture;
mod magic_link;
mod oauth;

#[derive(Clone, serde::Serialize)]
struct Payload {
    args: Vec<String>,
    cwd: String,
}

fn create_tray_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
    show_app_item: bool,
) -> tauri::Result<tauri::menu::Menu<R>> {
    let settings_i = MenuItem::with_id(handle, "settings", "Settings", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(handle, "quit", "Quit Lectornaut", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(handle)?;

    if show_app_item {
        let show_i = MenuItem::with_id(handle, "show", "Show app", true, None::<&str>)?;
        Menu::with_items(handle, &[&show_i, &settings_i, &separator, &quit_i])
    } else {
        Menu::with_items(handle, &[&settings_i, &separator, &quit_i])
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ctx = tauri::generate_context!();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_filter(|label| label != file_capture::FILE_CAPTURE_WINDOW_LABEL)
                .build(),
        )
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            println!("{}, {argv:?}, {cwd}", app.package_info().name);
            app.emit("single-instance", Payload { args: argv, cwd })
                .unwrap();
        }))
        .invoke_handler(tauri::generate_handler![
            oauth::login_oauth,
            magic_link::listen_magic_link,
            app_check::build_app_check_proof,
            downloads::download_url_to_path,
            file_capture::keep_file_capture_window_open,
            file_capture::dismiss_file_capture_window,
            file_capture::preview_file_path
        ])
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            let menu = create_tray_menu(app.handle(), false)?;

            let (pixmap_data, width, height) = {
                let (w, h) = (32, 32);
                let mut pixmap = tiny_skia::Pixmap::new(w, h).unwrap();
                let mut paint = tiny_skia::Paint::default();
                paint.set_color_rgba8(0, 0, 0, 255); // Black for template
                paint.anti_alias = true;

                let circle = tiny_skia::PathBuilder::from_circle(16.0, 16.0, 8.0).unwrap();
                pixmap.fill_path(
                    &circle,
                    &paint,
                    tiny_skia::FillRule::Winding,
                    tiny_skia::Transform::identity(),
                    None,
                );

                (pixmap.data().to_vec(), w, h)
            };

            let tray_icon = tauri::image::Image::new(&pixmap_data, width, height);

            let _tray = TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        if let Some(tray) = app.tray_by_id("main") {
                            let _ = create_tray_menu(app, false).map(|m| tray.set_menu(Some(m)));
                        }
                        app.emit("tray-action", "show").unwrap();
                    }
                    _ => {
                        println!("menu item {:?} not handled", event.id);
                        app.emit("tray-action", event.id.as_ref()).unwrap();
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = create_tray_menu(app, false).map(|m| tray.set_menu(Some(m)));
                    }
                })
                .build(app)?;

            let window = app.get_webview_window("main").unwrap();

            file_capture::setup(app)?;

            #[cfg(target_os = "macos")]
            apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None)
                .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");

            #[cfg(target_os = "windows")]
            apply_mica(&window, None)
                .expect("Unsupported platform! 'apply_mica' is only supported on Windows");

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == file_capture::FILE_CAPTURE_WINDOW_LABEL {
                    api.prevent_close();
                    let _ = file_capture::dismiss_file_capture_window(window.app_handle().clone());
                    return;
                }

                if window.label() != "main" {
                    return;
                }
                api.prevent_close();
                window.hide().unwrap();
                if let Some(tray) = window.app_handle().tray_by_id("main") {
                    let _ =
                        create_tray_menu(window.app_handle(), true).map(|m| tray.set_menu(Some(m)));
                }
            }
            _ => {}
        })
        .run(ctx)
        .expect("error while running tauri application");
}
