use licensing_core::{LicenseError, LicenseManager, LicenseStatus};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

type Mgr<'a> = State<'a, Arc<LicenseManager>>;

#[derive(Serialize)]
pub struct CmdError {
    code: String,
    message: String,
}
impl From<LicenseError> for CmdError {
    fn from(e: LicenseError) -> Self {
        Self { code: e.code(), message: e.to_string() }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    product: &'static str,
    os: &'static str,
    arch: &'static str,
    debug: bool,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo { version: env!("CARGO_PKG_VERSION"), product: licensing_core::PRODUCT_NAME, os: std::env::consts::OS, arch: std::env::consts::ARCH, debug: cfg!(debug_assertions) }
}

/// Local evaluation only – no network. Called at start-up and whenever the UI needs the license state.
#[tauri::command]
pub fn license_status(mgr: Mgr<'_>) -> LicenseStatus {
    mgr.status()
}

/// Initial activation (needs internet). Blocking network I/O runs off the UI thread.
#[tauri::command]
pub async fn license_activate(mgr: Mgr<'_>, code: String) -> Result<LicenseStatus, CmdError> {
    let m = mgr.inner().clone();
    tauri::async_runtime::spawn_blocking(move || m.activate(&code))
        .await
        .map_err(|e| CmdError { code: "internal".into(), message: e.to_string() })?
        .map_err(Into::into)
}

/// Online validation. Never fails: when the service is unreachable the offline policy applies.
#[tauri::command]
pub async fn license_check(mgr: Mgr<'_>) -> Result<LicenseStatus, CmdError> {
    let m = mgr.inner().clone();
    tauri::async_runtime::spawn_blocking(move || m.check())
        .await
        .map_err(|e| CmdError { code: "internal".into(), message: e.to_string() })
}

#[tauri::command]
pub async fn license_deactivate(mgr: Mgr<'_>, force_local: bool) -> Result<LicenseStatus, CmdError> {
    let m = mgr.inner().clone();
    tauri::async_runtime::spawn_blocking(move || m.deactivate(force_local))
        .await
        .map_err(|e| CmdError { code: "internal".into(), message: e.to_string() })?
        .map_err(Into::into)
}

/// Feature gate used before sensitive operations (Excel export, Fluke import, …).
/// Client-side gating is a deterrent, not a security boundary – see SECURITY.md.
#[tauri::command]
pub fn license_require(mgr: Mgr<'_>, feature: String) -> Result<(), CmdError> {
    let s = mgr.status();
    if !s.allowed {
        return Err(CmdError { code: "not_licensed".into(), message: s.message });
    }
    if !s.features.is_empty() && !s.features.get(&feature).copied().unwrap_or(false) {
        return Err(CmdError { code: "feature_disabled".into(), message: format!("Your license does not include \"{feature}\".") });
    }
    Ok(())
}
