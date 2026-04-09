use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Runtime,
};

/// Tauri command: start the sing-box proxy process.
/// The binary path is resolved relative to the app resource dir.
#[tauri::command]
fn start_proxy(app: tauri::AppHandle) -> Result<String, String> {
    let sing_box = resolve_singbox_path(&app)?;
    std::process::Command::new(&sing_box)
        .arg("run")
        .arg("-c")
        .arg(config_path(&app))
        .spawn()
        .map_err(|e| format!("Failed to start sing-box: {e}"))?;
    Ok("started".to_string())
}

/// Tauri command: stop the sing-box proxy process.
#[tauri::command]
fn stop_proxy() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    std::process::Command::new("taskkill")
        .args(["/F", "/IM", "sing-box.exe"])
        .output()
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    std::process::Command::new("pkill")
        .arg("sing-box")
        .output()
        .map_err(|e| e.to_string())?;
    Ok("stopped".to_string())
}

/// Tauri command: return basic runtime stats as a JSON string.
/// (For a production build these would query the sing-box gRPC/REST API.)
#[tauri::command]
fn get_stats() -> serde_json::Value {
    serde_json::json!({
        "status": "running",
        "uptime_seconds": 0,
        "bytes_up": 0,
        "bytes_down": 0
    })
}

/// Tauri command: import a subscription URL – saves it to app data dir.
#[tauri::command]
fn import_subscription(url: String, app: tauri::AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("subscription.url");
    std::fs::write(&path, url.as_bytes()).map_err(|e| e.to_string())
}

fn resolve_singbox_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let bin = if cfg!(target_os = "windows") {
        "sing-box.exe"
    } else {
        "sing-box"
    };
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("bin")
        .join(bin);
    Ok(path)
}

fn config_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_default()
        .join("config.json")
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Build system tray
            let quit_item = MenuItem::with_id(app, "quit", "Quit AetherProxy", true, None::<&str>)?;
            let toggle_item =
                MenuItem::with_id(app, "toggle", "Connect / Disconnect", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_item, &quit_item])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "toggle" => {
                        // Toggle proxy on/off (simplified)
                        let _ = app.emit("proxy-toggle", ());
                    }
                    _ => {}
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
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_proxy,
            stop_proxy,
            get_stats,
            import_subscription
        ])
        .run(tauri::generate_context!())
        .expect("error while running AetherProxy desktop");
}
