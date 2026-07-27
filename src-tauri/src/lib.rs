#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, Submenu};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use window_vibrancy::*;

mod app_check;
mod downloads;
mod file_capture;
mod oauth;

#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_visible(visible).map_err(|e| e.to_string())
    } else {
        Err("Tray not found".into())
    }
}

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

/// Build the macOS application menu bar.
///
/// This replaces Tauri's default menu (see [`tauri::menu::Menu::default`]).
/// The only meaningful difference is that the Quit item is a plain
/// `MenuItem` bound to `CmdOrCtrl+Q` instead of `PredefinedMenuItem::quit`.
///
/// Why: `PredefinedMenuItem::quit` on macOS is wired to
/// `NSApplication::terminate:`, which sends `windowShouldClose:` to every
/// window. tao's window delegate always returns `NO` from that selector
/// (`tao::platform_impl::macos::window_delegate::window_should_close`) and
/// just emits `WindowEvent::CloseRequested`. Because our main window's
/// `CloseRequested` handler hides the window to the tray, Cmd+Q ends up
/// hiding the window and AppKit then cancels the termination — the app
/// never quits. By giving Cmd+Q its own custom `MenuItem`, the keypress
/// becomes a regular `MenuEvent` with id `"quit"` that our existing tray
/// `on_menu_event` handler already routes to `app.exit(0)`. That call goes
/// through `Message::RequestExit` → `RunEvent::ExitRequested` →
/// `control_flow = Exit` and exits the event loop without ever touching
/// `windowShouldClose:`.
#[cfg(target_os = "macos")]
fn create_app_menu<R: tauri::Runtime>(handle: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg_info = handle.package_info();
    let config = handle.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let quit_item = MenuItem::with_id(
        handle,
        "quit",
        format!("Quit {}", pkg_info.name),
        true,
        Some("CmdOrCtrl+Q"),
    )?;

    let app_submenu = Submenu::with_items(
        handle,
        pkg_info.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(handle, None, Some(about_metadata))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &quit_item,
        ],
    )?;

    let edit_submenu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;

    let view_submenu = Submenu::with_items(
        handle,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(handle, None)?],
    )?;

    let window_submenu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    Menu::with_items(
        handle,
        &[&app_submenu, &edit_submenu, &view_submenu, &window_submenu],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ctx = tauri::generate_context!();
    let builder = tauri::Builder::default()
        // Registered first so every later plugin's log output is captured.
        // Webview console output is forwarded here too (src/modules/log.ts),
        // so release builds leave a support trail in the platform log dir.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("lectornaut".into()),
                    }),
                ])
                .max_file_size(5 * 1024 * 1024)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_filter(|label| {
                    // Ephemeral windows: uuid-labelled ask pop-outs would
                    // accumulate dead entries in the window-state file.
                    label != file_capture::FILE_CAPTURE_WINDOW_LABEL && !label.starts_with("ask-")
                })
                .build(),
        )
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            log::info!("second instance launched: {argv:?} in {cwd}");
            app.emit("single-instance", Payload { args: argv, cwd })
                .unwrap();
        }))
        .invoke_handler(tauri::generate_handler![
            oauth::login_oauth,
            oauth::authorize_oauth,
            app_check::build_app_check_proof,
            downloads::download_url_to_path,
            file_capture::keep_file_capture_window_open,
            file_capture::dismiss_file_capture_window,
            file_capture::set_file_capture_drag_enabled,
            file_capture::preview_file_path,
            set_tray_visible
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
                        log::debug!("tray menu item {:?} forwarded to webview", event.id);
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == file_capture::FILE_CAPTURE_WINDOW_LABEL {
                    api.prevent_close();
                    let _ = file_capture::dismiss_file_capture_window(window.app_handle().clone());
                    return;
                }

                if window.label() != "main" {
                    return;
                }

                // Hide the main window to the tray instead of closing it.
                api.prevent_close();
                window.hide().unwrap();
                if let Some(tray) = window.app_handle().tray_by_id("main") {
                    let _ =
                        create_tray_menu(window.app_handle(), true).map(|m| tray.set_menu(Some(m)));
                }
            }
        });

    // Custom macOS application menu so Cmd+Q routes through a regular menu
    // event instead of `NSApplication::terminate:`.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(create_app_menu);

    builder
        .build(ctx)
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = _event
            {
                if !has_visible_windows {
                    if let Some(window) = _app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    if let Some(tray) = _app_handle.tray_by_id("main") {
                        let _ =
                            create_tray_menu(_app_handle, false).map(|m| tray.set_menu(Some(m)));
                    }
                }
            }
        });
}
