mod commands;

use std::sync::Arc;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Local storage is initialised first; the license is verified on the first UI call.
            let dir = app.path().app_local_data_dir().expect("app data dir");
            std::fs::create_dir_all(&dir).ok();
            let mgr = licensing_core::LicenseManager::new(licensing_core::ManagerConfig {
                store_path: dir.join("license.dat"),
                base_url: licensing_core::manager::DEFAULT_LICENSE_URL.to_string(),
                app_version: env!("CARGO_PKG_VERSION").to_string(),
            })
            .map_err(|e| e.to_string())?;
            app.manage(Arc::new(mgr));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::license_status,
            commands::license_activate,
            commands::license_check,
            commands::license_deactivate,
            commands::license_require,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chiller Plant Analyzer");
}
