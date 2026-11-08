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
mod window_controls;

#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_visible(visible).map_err(|e| e.to_string())
    } else {
        Err("Tray not found".into())
    }
}

// Applies the chosen app icon variant on macOS, in two places:
//
// 1. The running app's Dock / Cmd-Tab tile (`setApplicationIconImage`). Both
//    variants paint explicitly: passing nil does not reliably restore the
//    bundled icon once overridden. Lasts only while the process runs.
// 2. The .app bundle itself (`NSWorkspace setIcon:forFile:`), which is what
//    Finder, Launchpad, Mission Control and the not-running Dock tile read.
//    macOS has no alternate-icon API for apps; a custom bundle icon is the
//    supported equivalent. "light" removes it (nil), restoring the bundled
//    AppIcon with its system light/dark/tinted rendering. Skipped when not
//    running from a .app (`tauri dev`). The write adds an `Icon\r` file to
//    the bundle root, which unseals the code signature; launches are fine,
//    and an update replacing the bundle drops it, so the client re-applies a
//    non-default variant on every launch.
//
// Sync commands already run on the main thread, so this dispatches rather
// than blocks, and reports bundle-write failures to the log.
#[tauri::command]
fn set_dock_icon(app: tauri::AppHandle, variant: String) -> Result<(), String> {
    let dark = match variant.as_str() {
        "light" => false,
        "dark" => true,
        _ => return Err(format!("Unknown dock icon variant: {variant}")),
    };
    #[cfg(target_os = "macos")]
    app.run_on_main_thread(move || {
        use objc2::{AllocAnyThread, MainThreadMarker};
        use objc2_app_kit::{NSApplication, NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
        use objc2_foundation::{NSBundle, NSData};

        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let bytes: &[u8] = if dark {
            include_bytes!("../icons/dock/dark.icns")
        } else {
            include_bytes!("../icons/dock/light.icns")
        };
        let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes));
        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(image.as_deref()) };

        let bundle_path = NSBundle::mainBundle().bundlePath();
        if bundle_path.pathExtension().to_string() != "app" {
            return;
        }
        let bundle_image = if dark { image.as_deref() } else { None };
        let applied = NSWorkspace::sharedWorkspace().setIcon_forFile_options(
            bundle_image,
            &bundle_path,
            NSWorkspaceIconCreationOptions(0),
        );
        if !applied {
            log::warn!("Couldn't set the {variant} app icon on {bundle_path}");
        }
    })
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, dark);
    Ok(())
}

// Whether the menu event being handled came from its key equivalent rather
// than a click: the shortcut is the accidental path (⌘W/⌘Q fat-fingered),
// a click on Quit / Close Window is deliberate. AppKit keeps the keyDown as
// `currentEvent` while the menu event is dispatched (Chrome's ⌘Q warning
// uses the same check).
#[cfg(target_os = "macos")]
fn is_key_equivalent() -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSEventType};

    MainThreadMarker::new()
        .and_then(|mtm| NSApplication::sharedApplication(mtm).currentEvent())
        .is_some_and(|event| event.r#type() == NSEventType::KeyDown)
}

#[cfg(not(target_os = "macos"))]
fn is_key_equivalent() -> bool {
    false
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
            // Custom item instead of `PredefinedMenuItem::close_window` so the
            // ⌘W key equivalent reaches the webview's close-tab logic (it only
            // fires when the webview didn't handle ⌘W, e.g. focus in an input).
            &MenuItem::with_id(
                handle,
                "close-window",
                "Close Window",
                true,
                Some("CmdOrCtrl+W"),
            )?,
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
        .runtime(tauri_runtime_wry::Wry::default())
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
            oauth::cancel_oauth,
            oauth::reopen_oauth,
            app_check::build_app_check_proof,
            downloads::download_url_to_path,
            file_capture::keep_file_capture_window_open,
            file_capture::dismiss_file_capture_window,
            file_capture::set_file_capture_drag_enabled,
            file_capture::preview_file_path,
            window_controls::align_macos_window_controls,
            set_tray_visible,
            set_dock_icon
        ])
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            let menu = create_tray_menu(app.handle(), false)?;

            // Black-on-transparent logo (public/logo.svg) at 44px = 22pt @2x;
            // decoded at compile time, tinted by macOS via icon_as_template.
            let tray_icon = tauri::include_image!("icons/tray-template.png");

            let _tray = TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    // Shortcuts hand off to the webview's close confirmation
                    // (`useCloseConfirmation`); clicks act immediately.
                    "quit" => match app.get_webview_window("main") {
                        // ponytail: a hidden main window quits unprompted
                        // (no dialog to show); show it first if that matters.
                        Some(window)
                            if is_key_equivalent() && window.is_visible().unwrap_or(false) =>
                        {
                            let _ = window.set_focus();
                            let _ = window.emit_to("main", "close-shortcut", "quit");
                        }
                        _ => app.exit(0),
                    },
                    "close-window" => {
                        let focused = app
                            .webview_windows()
                            .into_values()
                            .find(|w| w.is_focused().unwrap_or(false));
                        if let Some(window) = focused {
                            if window.label() == "main" && is_key_equivalent() {
                                let _ = window.emit_to("main", "close-shortcut", "close");
                            } else {
                                let _ = window.close();
                            }
                        }
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
