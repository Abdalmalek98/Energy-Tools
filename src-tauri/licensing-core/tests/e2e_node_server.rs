//! End-to-end: the real Rust client against the real Node licensing service (dev key, HTTP on loopback).
//! Skipped automatically when `node` is not installed.
use chrono::Utc;
use licensing_core::api::HttpTransport;
use licensing_core::fingerprint::Machine;
use licensing_core::keyring::KeyRing;
use licensing_core::manager::LicenseManager;
use licensing_core::model::LicenseState as S;
use licensing_core::store::{LicenseStore, PortableBox};
use licensing_core::LicenseError;
use serde_json::{json, Value};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const ADMIN: &str = "e2e-admin-token-0123456789abcdef";

struct Server { child: Child, base: String, _dir: tempfile::TempDir }
impl Drop for Server { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }

fn node_available() -> bool { Command::new("node").arg("--version").output().map(|o| o.status.success()).unwrap_or(false) }

fn start_server() -> Server {
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let dir = tempfile::tempdir().unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../license-server");
    let child = Command::new("node")
        .current_dir(&root)
        .args(["--disable-warning=ExperimentalWarning", "src/server.js"])
        .env("CPA_SIGNING_KEY_FILE_dev-1", root.join("dev/dev-private-key.pem"))
        .env("CPA_ACTIVE_KEY_ID", "dev-1")
        .env("CPA_ADMIN_TOKEN", ADMIN)
        .env("CPA_DB_PATH", dir.path().join("lic.db"))
        .env("CPA_PORT", port.to_string())
        .env("CPA_HOST", "127.0.0.1")
        .env("CPA_ALLOW_PLAIN_HTTP", "1")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn node");
    let base = format!("http://127.0.0.1:{port}");
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(15) {
        if ureq::get(&format!("{base}/v1/health")).call().is_ok() { return Server { child, base, _dir: dir }; }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("licensing server did not start");
}

fn admin(base: &str, method: &str, path: &str, body: Value) -> Value {
    let req = ureq::request(method, &format!("{base}{path}")).set("Authorization", &format!("Bearer {ADMIN}"));
    req.send_json(body).unwrap().into_json().unwrap()
}

fn client(base: &str, tag: &str) -> (LicenseManager, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let m = LicenseManager::with_parts(
        LicenseStore::new(dir.path().join("license.dat"), Box::new(PortableBox)),
        KeyRing::embedded(), // includes the dev key in debug/test builds
        Machine::from_raw(&(1..=5).map(|i| ("c", format!("{tag}-{i}"))).map(|(n, v)| (n, v)).collect::<Vec<_>>()),
        Box::new(HttpTransport::new(base, true).unwrap()),
        "1.0.0".into(),
        Box::new(Utc::now),
    );
    (m, dir)
}

#[test]
fn rust_client_against_node_service() {
    if !node_available() { eprintln!("node not available – skipping"); return; }
    let srv = start_server();
    let base = srv.base.clone();

    // owner creates a 30-day, single-activation license
    let created = admin(&base, "POST", "/v1/admin/licenses", json!({"customerName": "ABC Company", "companyName": "ABC", "email": "a@b.c", "durationDays": 30, "maxActivations": 1}));
    let id = created["license"]["licenseId"].as_str().unwrap().to_string();
    let token = created["token"].as_str().unwrap().to_string();

    let (pc1, _d1) = client(&base, "pc1");
    let s = pc1.activate(&token).expect("activation");
    assert_eq!(s.state, S::Active);
    assert_eq!(s.license_id.as_deref(), Some(id.as_str()));
    assert_eq!(s.customer.as_deref(), Some("ABC Company"));
    assert_eq!(s.days_remaining, Some(30));
    assert_eq!(s.key_id.as_deref(), Some("dev-1"));

    // a second computer cannot use the same single-activation code
    let (pc2, _d2) = client(&base, "pc2");
    match pc2.activate(&token) { Err(LicenseError::Server { code, .. }) => assert_eq!(code, "max_activations"), other => panic!("expected max_activations, got {other:?}") }

    // extension is picked up by the next validation – no new code, no rebuild
    admin(&base, "POST", &format!("/v1/admin/licenses/{id}/extend"), json!({"days": 335}));
    let s = pc1.check();
    assert_eq!(s.state, S::Active);
    assert_eq!(s.days_remaining, Some(365));

    // revoke → next validation locks
    admin(&base, "POST", &format!("/v1/admin/licenses/{id}/revoke"), json!({}));
    let s = pc1.check();
    assert_eq!(s.state, S::Revoked);
    assert!(!s.allowed);
    admin(&base, "POST", &format!("/v1/admin/licenses/{id}/reinstate"), json!({}));
    assert!(pc1.check().allowed);

    // the owner frees the slot by deactivating pc1 → pc1 is locked at its next check, pc2 can activate
    let detail = admin(&base, "GET", &format!("/v1/admin/licenses/{id}"), json!(null));
    let act_id = detail["activations"][0]["activationId"].as_i64().unwrap();
    admin(&base, "POST", &format!("/v1/admin/activations/{act_id}/deactivate"), json!({}));
    assert_eq!(pc1.check().state, S::Deactivated);
    assert_eq!(pc2.activate(&token).unwrap().state, S::Active);

    // client-side deactivation releases the slot
    assert_eq!(pc2.deactivate(false).unwrap().state, S::Unlicensed);
    let detail = admin(&base, "GET", &format!("/v1/admin/licenses/{id}"), json!(null));
    assert_eq!(detail["license"]["currentActivations"], 0);

    // server disappears → offline grace applies, application keeps working
    let (pc3, _d3) = client(&base, "pc3");
    pc3.activate(&token).unwrap();
    drop(srv);
    let s = pc3.check();
    assert!(s.allowed);
    assert!(s.offline_note.unwrap().contains("Could not reach the licensing service"));
}
