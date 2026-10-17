#[cfg(target_os = "macos")]
fn control_geometry(
    center_y: f64,
    viewport_width: f64,
    logical_width: f64,
    button_height: f64,
    button_origin_y: f64,
) -> Result<(f64, f64), String> {
    if ![
        center_y,
        viewport_width,
        logical_width,
        button_height,
        button_origin_y,
    ]
    .iter()
    .all(|value| value.is_finite())
        || center_y < 0.0
        || viewport_width <= 0.0
        || logical_width <= 0.0
        || button_height <= 0.0
    {
        return Err("Invalid macOS window control geometry".into());
    }
    let zoom = logical_width / viewport_width;
    // tao's inset sets the titlebar height to button_height + y, preserving
    // the button's bottom-origin frame within that titlebar.
    let inset = (center_y * zoom - button_height / 2.0 + button_origin_y).max(0.0);
    Ok((inset, 88.0 / zoom))
}

#[tauri::command]
pub fn align_macos_window_controls(
    window: tauri::WebviewWindow,
    center_y: f64,
    viewport_width: f64,
) -> Result<f64, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::{NSWindow, NSWindowButton};

        let _mtm = MainThreadMarker::new().ok_or("Window controls require the main thread")?;
        if window.is_fullscreen().map_err(|error| error.to_string())? {
            return Err("Cannot align window controls while fullscreen".into());
        }
        let ns_window = window.ns_window().map_err(|error| error.to_string())?;
        // Synchronous Tauri commands execute on the main thread; the window
        // remains owned by Tauri throughout this call.
        let ns_window = unsafe { &*(ns_window as *const NSWindow) };
        let close = ns_window
            .standardWindowButton(NSWindowButton::CloseButton)
            .ok_or("Missing macOS close button")?;
        let button = close.frame();
        let logical_width = window
            .inner_size()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(window.scale_factor().map_err(|error| error.to_string())?)
            .width;
        let (inset, reserved_width) = control_geometry(
            center_y,
            viewport_width,
            logical_width,
            button.size.height,
            button.origin.y,
        )?;
        window
            .set_traffic_light_position(tauri::LogicalPosition::new(16.0, inset).into())
            .map_err(|error| error.to_string())?;
        // tao only stores the inset in its setter. Apply its titlebar frame
        // adjustment now too; WebKit may completely occlude tao's drawRect.
        let container = unsafe {
            close
                .superview()
                .and_then(|view| view.superview())
                .ok_or("Missing macOS titlebar container")?
        };
        let mut frame = container.frame();
        frame.size.height = button.size.height + inset;
        frame.origin.y = ns_window.frame().size.height - frame.size.height;
        container.setFrame(frame);
        Ok(reserved_width)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, center_y, viewport_width);
        Err("Window control alignment is only supported on macOS".into())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::control_geometry;

    #[test]
    fn centers_controls_for_font_size_and_zoom_combinations() {
        for font_size in [12.0, 14.0, 16.0, 18.0, 20.0] {
            for zoom in [0.5, 0.8, 1.0, 1.25, 1.5, 2.0] {
                let center = 1.5 * font_size;
                let (inset, reserved) =
                    control_geometry(center, 1200.0 / zoom, 1200.0, 14.0, 3.0).unwrap();
                let actual_center = inset + 14.0 / 2.0 - 3.0;
                assert!((actual_center - center * zoom).abs() < 0.001);
                assert!((reserved * zoom - 88.0).abs() < 0.001);
            }
        }
    }

    #[test]
    fn rejects_invalid_geometry() {
        for (center, viewport) in [(f64::NAN, 1200.0), (24.0, 0.0), (-1.0, 1200.0)] {
            assert!(control_geometry(center, viewport, 1200.0, 14.0, 3.0).is_err());
        }
    }
}
