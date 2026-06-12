use std::{
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, TitleBarStyle};
use tauri::{
    Manager, PhysicalPosition, Position as WindowPosition, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_positioner::{Position as PositionerPosition, WindowExt};

pub const FILE_CAPTURE_WINDOW_LABEL: &str = "file-capture";

const FILE_CAPTURE_WINDOW_ROUTE: &str = "file-capture";
const FILE_CAPTURE_WINDOW_WIDTH: f64 = 320.0;
const FILE_CAPTURE_WINDOW_HEIGHT: f64 = 320.0;
const FILE_CAPTURE_DROP_SETTLE_DELAY: Duration = Duration::from_millis(350);
#[cfg(target_os = "macos")]
const FILE_CAPTURE_SHOW_ANIMATION_DURATION: f64 = 0.18;

struct FileCaptureWindowState {
    drag_enabled: bool,
    drag_active: bool,
    keep_open: bool,
    pending_hide_until: Option<Instant>,
    active_drag_change_count: Option<isize>,
    last_observed_drag_change_count: Option<isize>,
}

impl Default for FileCaptureWindowState {
    fn default() -> Self {
        Self {
            drag_enabled: true,
            drag_active: false,
            keep_open: false,
            pending_hide_until: None,
            active_drag_change_count: None,
            last_observed_drag_change_count: None,
        }
    }
}

#[derive(Default)]
pub struct FileCaptureState(Mutex<FileCaptureWindowState>);

pub fn setup<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    app.manage(FileCaptureState::default());
    create_file_capture_window(app)?;

    #[cfg(target_os = "macos")]
    macos::install_drag_monitor(app.handle().clone())?;

    Ok(())
}

fn create_file_capture_window<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<()> {
    if manager
        .app_handle()
        .get_webview_window(FILE_CAPTURE_WINDOW_LABEL)
        .is_some()
    {
        return Ok(());
    }

    let window_builder = WebviewWindowBuilder::new(
        manager,
        FILE_CAPTURE_WINDOW_LABEL,
        WebviewUrl::App(FILE_CAPTURE_WINDOW_ROUTE.into()),
    )
    .title("File Capture")
    .inner_size(FILE_CAPTURE_WINDOW_WIDTH, FILE_CAPTURE_WINDOW_HEIGHT)
    .min_inner_size(FILE_CAPTURE_WINDOW_WIDTH, FILE_CAPTURE_WINDOW_HEIGHT)
    .resizable(true)
    .maximizable(true)
    .minimizable(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .decorations(true)
    .shadow(true)
    .transparent(true)
    .accept_first_mouse(true)
    .focused(false)
    .visible(false);

    #[cfg(target_os = "macos")]
    let window_builder = window_builder
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(LogicalPosition::new(16.0, 26.0));

    let window = window_builder.build()?;

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    apply_window_appearance(&window);

    let _ = window.center();

    Ok(())
}

fn center_window_on_monitor<R: Runtime>(
    window: &WebviewWindow<R>,
    cursor_x: f64,
    cursor_y: f64,
) -> tauri::Result<()> {
    let monitor = window
        .monitor_from_point(cursor_x, cursor_y)?
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return Ok(());
    };

    let monitor_position = monitor.position();
    window.set_position(WindowPosition::Physical(PhysicalPosition::new(
        monitor_position.x,
        monitor_position.y,
    )))?;
    window.move_window(PositionerPosition::Center)?;

    Ok(())
}

fn show_file_capture_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    cursor_x: f64,
    cursor_y: f64,
) -> tauri::Result<()> {
    create_file_capture_window(app)?;

    let Some(window) = app.get_webview_window(FILE_CAPTURE_WINDOW_LABEL) else {
        return Ok(());
    };

    center_window_on_monitor(&window, cursor_x, cursor_y)?;

    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    show_window(&window)?;

    Ok(())
}

fn hide_file_capture_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window(FILE_CAPTURE_WINDOW_LABEL) {
        #[cfg(target_os = "macos")]
        prepare_window_for_hide(&window);

        let _ = window.hide();
    }
}

#[cfg(not(target_os = "macos"))]
fn show_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    window.show()
}

#[cfg(target_os = "macos")]
fn show_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    use block2::RcBlock;
    use core::ptr::NonNull;
    use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSWindow};

    let was_visible = window.is_visible().unwrap_or(false);
    if was_visible {
        return window.show();
    }

    if let Ok(ns_window) = window.ns_window() {
        let ns_window_ptr = ns_window as *mut NSWindow;

        if !ns_window_ptr.is_null() {
            let ns_window = unsafe { &*ns_window_ptr };
            ns_window.setAlphaValue(0.0);
            window.show()?;

            let animations = RcBlock::new(move |context: NonNull<NSAnimationContext>| {
                let context = unsafe { context.as_ref() };
                context.setDuration(FILE_CAPTURE_SHOW_ANIMATION_DURATION);
                context.setAllowsImplicitAnimation(true);

                if let Some(ns_window) = unsafe { ns_window_ptr.as_ref() } {
                    let animator = ns_window.animator();
                    animator.setAlphaValue(1.0);
                }
            });

            NSAnimationContext::runAnimationGroup(&animations);
            return Ok(());
        }
    }

    window.show()
}

#[cfg(target_os = "macos")]
fn prepare_window_for_hide<R: Runtime>(window: &WebviewWindow<R>) {
    use objc2_app_kit::NSWindow;

    if let Ok(ns_window) = window.ns_window() {
        let ns_window_ptr = ns_window as *mut NSWindow;

        if !ns_window_ptr.is_null() {
            let ns_window = unsafe { &*ns_window_ptr };
            ns_window.setAlphaValue(1.0);
        }
    }
}

fn set_keep_open<R: Runtime>(app: &tauri::AppHandle<R>, keep_open: bool) {
    let state = app.state::<FileCaptureState>();
    let mut state = state.0.lock().unwrap();
    state.keep_open = keep_open;
    state.active_drag_change_count = None;
    state.pending_hide_until = None;
}

pub fn reset_file_capture_window_state<R: Runtime>(app: &tauri::AppHandle<R>) {
    let state = app.state::<FileCaptureState>();
    let mut state = state.0.lock().unwrap();
    state.drag_active = false;
    state.keep_open = false;
    state.active_drag_change_count = None;
    state.pending_hide_until = None;
}

fn dismiss_file_capture_window_inner<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    reset_file_capture_window_state(app);
    hide_file_capture_window(app);

    Ok(())
}

#[cfg(target_os = "macos")]
fn apply_window_appearance<R: Runtime>(window: &WebviewWindow<R>) {
    use objc2_app_kit::{NSWindow, NSWindowAnimationBehavior};
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

    if let Ok(ns_window) = window.ns_window() {
        let ns_window = ns_window as *mut NSWindow;

        // AppKit infers no automatic animation for this floating HUD-style window
        // unless the behavior is set explicitly.
        if let Some(ns_window) = unsafe { ns_window.as_ref() } {
            ns_window.setAnimationBehavior(NSWindowAnimationBehavior::UtilityWindow);
        }
    }

    let _ = apply_vibrancy(
        window,
        NSVisualEffectMaterial::HudWindow,
        Some(NSVisualEffectState::Active),
        None,
    );
}

#[cfg(target_os = "windows")]
fn apply_window_appearance<R: Runtime>(window: &WebviewWindow<R>) {
    use window_vibrancy::apply_mica;

    let _ = apply_mica(window, None);
}

#[tauri::command]
pub fn keep_file_capture_window_open<R: Runtime>(app: tauri::AppHandle<R>) -> tauri::Result<()> {
    set_keep_open(&app, true);

    if let Some(window) = app.get_webview_window(FILE_CAPTURE_WINDOW_LABEL) {
        let _ = window.set_always_on_top(true);
        let _ = window.set_visible_on_all_workspaces(true);
        let _ = window.show();
    }

    Ok(())
}

#[tauri::command]
pub fn dismiss_file_capture_window<R: Runtime>(app: tauri::AppHandle<R>) -> tauri::Result<()> {
    dismiss_file_capture_window_inner(&app)
}

#[tauri::command]
pub fn set_file_capture_drag_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> tauri::Result<()> {
    let state = app.state::<FileCaptureState>();
    let mut state = state.0.lock().unwrap();
    state.drag_enabled = enabled;

    if !enabled {
        state.drag_active = false;
        state.active_drag_change_count = None;
        state.pending_hide_until = None;
    }

    drop(state);

    if !enabled {
        hide_file_capture_window(&app);
    }

    Ok(())
}

#[tauri::command]
pub fn preview_file_path<R: Runtime>(app: tauri::AppHandle<R>, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("File not found: {path}"));
    }

    app.opener()
        .open_path(&path, None::<String>)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{
        hide_file_capture_window, show_file_capture_window, FileCaptureState,
        FILE_CAPTURE_DROP_SETTLE_DELAY,
    };
    use block2::RcBlock;
    use objc2::rc::Retained;
    #[allow(deprecated)]
    use objc2_app_kit::{NSEvent, NSFilenamesPboardType, NSPasteboard, NSPasteboardNameDrag};
    use objc2_foundation::{NSArray, NSRunLoop, NSRunLoopCommonModes, NSString, NSTimer};
    use std::{ffi::CStr, ptr::NonNull, time::Instant};
    use tauri::{AppHandle, Manager, Runtime};

    struct DragMonitor {
        _poll_timer: Retained<NSTimer>,
    }

    pub fn install_drag_monitor<R: Runtime>(app: AppHandle<R>) -> tauri::Result<()> {
        prime_drag_monitor_state(&app);
        let monitor = DragMonitor::new(app)?;

        // Keep the monitor alive for the application lifetime.
        Box::leak(Box::new(monitor));

        Ok(())
    }

    impl DragMonitor {
        fn new<R: Runtime>(app: AppHandle<R>) -> tauri::Result<Self> {
            let poll_handler = RcBlock::new({
                let app = app.clone();
                move |_timer: NonNull<NSTimer>| {
                    poll_drag_state(&app);
                }
            });
            let poll_timer =
                unsafe { NSTimer::timerWithTimeInterval_repeats_block(0.15, true, &poll_handler) };
            let run_loop = NSRunLoop::mainRunLoop();
            unsafe {
                run_loop.addTimer_forMode(&poll_timer, NSRunLoopCommonModes);
            }

            Ok(Self {
                _poll_timer: poll_timer,
            })
        }
    }

    fn prime_drag_monitor_state<R: Runtime>(app: &AppHandle<R>) {
        let state = app.state::<FileCaptureState>();
        let mut state = state.0.lock().unwrap();
        state.last_observed_drag_change_count = Some(current_drag_pasteboard_change_count());
    }

    fn poll_drag_state<R: Runtime>(app: &AppHandle<R>) {
        {
            let state = app.state::<FileCaptureState>();
            let mut state = state.0.lock().unwrap();

            if !state.drag_enabled {
                return;
            }

            if state.keep_open {
                state.drag_active = false;
                state.active_drag_change_count = None;
                state.pending_hide_until = None;
                return;
            }
        }

        let is_drag_button_pressed = (NSEvent::pressedMouseButtons() & 1) == 1;

        if !is_drag_button_pressed {
            handle_drag_end(app);
            return;
        }

        // Read the change count first — this is cheap and does not resolve
        // file-reference URLs, so it won't trigger macOS pasteboard warnings.
        let change_count = current_drag_pasteboard_change_count();

        let should_show = {
            let state = app.state::<FileCaptureState>();
            let mut state = state.0.lock().unwrap();

            if state.active_drag_change_count == Some(change_count) {
                // Already tracking this drag session — no need to re-inspect
                // the pasteboard contents.
                true
            } else if state.last_observed_drag_change_count == Some(change_count) {
                // The change count has not changed since the last poll and this
                // is not an active drag — skip the expensive file-type check.
                false
            } else {
                // A new change count appeared. Update the observed count and
                // check whether the pasteboard actually contains dragged files.
                // This is the only path that reads pasteboard contents and may
                // trigger URL resolution warnings, but it runs at most once per
                // new drag session rather than every poll cycle.
                state.last_observed_drag_change_count = Some(change_count);
                drag_pasteboard_has_files()
            }
        };

        if !should_show {
            handle_drag_end(app);
            return;
        }

        let cursor = NSEvent::mouseLocation();
        let Ok(_) = show_file_capture_window(app, cursor.x, cursor.y) else {
            return;
        };

        let state = app.state::<FileCaptureState>();
        let mut state = state.0.lock().unwrap();
        state.drag_active = true;
        state.active_drag_change_count = Some(change_count);
        state.pending_hide_until = None;
    }

    fn handle_drag_end<R: Runtime>(app: &AppHandle<R>) {
        let now = Instant::now();
        let state = app.state::<FileCaptureState>();
        let mut state = state.0.lock().unwrap();

        if state.keep_open {
            state.drag_active = false;
            state.active_drag_change_count = None;
            state.pending_hide_until = None;
            return;
        }

        if state.drag_active {
            state.drag_active = false;
            state.active_drag_change_count = None;
            state.pending_hide_until = Some(now + FILE_CAPTURE_DROP_SETTLE_DELAY);
            return;
        }

        let should_hide = state
            .pending_hide_until
            .is_some_and(|deadline| now >= deadline);

        if !should_hide {
            return;
        }

        state.pending_hide_until = None;
        drop(state);

        if should_hide {
            hide_file_capture_window(app);
        }
    }

    #[allow(deprecated)]
    fn drag_pasteboard_has_files() -> bool {
        let pasteboard = NSPasteboard::pasteboardWithName(unsafe { NSPasteboardNameDrag });
        let file_types = NSArray::arrayWithObject(unsafe { NSFilenamesPboardType });

        if pasteboard.availableTypeFromArray(&file_types).is_none() {
            return false;
        }

        extract_drag_paths(&pasteboard).is_some()
    }

    #[allow(deprecated)]
    fn current_drag_pasteboard_change_count() -> isize {
        let pasteboard = NSPasteboard::pasteboardWithName(unsafe { NSPasteboardNameDrag });
        pasteboard.changeCount()
    }

    #[allow(deprecated)]
    fn extract_drag_paths(pasteboard: &NSPasteboard) -> Option<Vec<String>> {
        let paths = pasteboard.propertyListForType(unsafe { NSFilenamesPboardType })?;
        let paths = paths.downcast::<NSArray>().ok()?;

        let mut collected_paths = Vec::with_capacity(paths.len());

        for path in paths {
            let path = path.downcast::<NSString>().ok()?;
            let path = unsafe { CStr::from_ptr(path.UTF8String()) }
                .to_string_lossy()
                .into_owned();

            if !path.is_empty() {
                collected_paths.push(path);
            }
        }

        (!collected_paths.is_empty()).then_some(collected_paths)
    }
}
