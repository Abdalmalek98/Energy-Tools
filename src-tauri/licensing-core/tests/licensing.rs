//! Client-side licensing scenarios: signature, product, dates, revocation, machine binding, offline grace,
//! server unavailable, renewal, deactivation, clock roll-back, key rotation, encrypted storage.
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use chrono::{DateTime, Duration, SecondsFormat, TimeZone, Utc};
use ed25519_dalek::{Signer, SigningKey};
use licensing_core::api::Transport;
use licensing_core::fingerprint::Machine;
use licensing_core::keyring::KeyRing;
use licensing_core::manager::LicenseManager;
use licensing_core::model::LicenseState as S;
use licensing_core::store::{LicenseStore, PortableBox};
use licensing_core::LicenseError;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

fn iso(d: DateTime<Utc>) -> String { d.to_rfc3339_opts(SecondsFormat::Millis, true) }
fn t0() -> DateTime<Utc> { Utc.with_ymd_and_hms(2026, 9, 30, 0, 0, 0).unwrap() }

struct Signing { kid: String, key: SigningKey }
impl Signing {
    fn new(kid: &str, seed: u8) -> Self { Self { kid: kid.into(), key: SigningKey::from_bytes(&[seed; 32]) } }
    fn entry(&self, dev: bool) -> Value { json!({"kid": self.kid, "alg": "ed25519", "public": STANDARD.encode(self.key.verifying_key().to_bytes()), "dev": dev}) }
    fn seal(&self, prefix: &str, mut payload: Value) -> String {
        payload["kid"] = json!(self.kid);
        let p = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap());
        let sig = self.key.sign(format!("{prefix}.{p}").as_bytes());
        format!("{prefix}.{p}.{}", URL_SAFE_NO_PAD.encode(sig.to_bytes()))
    }
}
fn ring(keys: &[&Signing]) -> KeyRing {
    KeyRing::from_json(&json!({"keys": keys.iter().map(|k| k.entry(false)).collect::<Vec<_>>()}).to_string(), false).unwrap()
}
fn machine(tag: &str) -> Machine {
    Machine::from_raw(&[("a", format!("{tag}1")), ("b", format!("{tag}2")), ("c", format!("{tag}3")), ("d", format!("{tag}4")), ("e", format!("{tag}5"))])
}

/// Scripted licensing server state.
#[derive(Clone)]
struct Srv { status: String, exp: Option<DateTime<Utc>>, nbf: DateTime<Utc>, lid: String, reject: Option<(String, String)>, offline: bool, max_act: u32 }
type Shared<T> = Arc<Mutex<T>>;

struct FakeServer { srv: Shared<Srv>, key: Signing, now: Shared<DateTime<Utc>>, calls: Shared<Vec<String>> }
impl Transport for FakeServer {
    fn post(&self, path: &str, body: &Value) -> Result<Value, LicenseError> {
        self.calls.lock().unwrap().push(path.to_string());
        let s = self.srv.lock().unwrap().clone();
        if s.offline { return Err(LicenseError::Network("connection refused".into())); }
        if let Some((code, msg)) = s.reject.clone() { return Err(LicenseError::Server { code, message: msg }); }
        if path == "/v1/deactivate" { return Ok(json!({"ok": true})); }
        let m = &body["machine"];
        let receipt = self.key.seal("CPR1", json!({
            "v": 1, "lid": s.lid, "status": s.status, "exp": s.exp.map(iso), "nbf": iso(s.nbf), "fp": m["fp"], "parts": m["parts"],
            "validatedAt": iso(*self.now.lock().unwrap()), "checkIntervalDays": 7, "graceDays": 14, "activations": 1, "maxAct": s.max_act,
            "features": {"excelExport": true}, "nonce": body["nonce"],
        }));
        Ok(json!({"receipt": receipt}))
    }
}

struct Env {
    mgr: LicenseManager, srv: Shared<Srv>, now: Shared<DateTime<Utc>>, key: Signing, calls: Shared<Vec<String>>, dir: tempfile::TempDir, machine: Machine,
}
impl Env {
    fn new() -> Self { Self::with(|_| {}) }
    fn with(f: impl FnOnce(&mut Srv)) -> Self { Self::build(machine("pc"), f) }
    fn build(m: Machine, f: impl FnOnce(&mut Srv)) -> Self {
        let key = Signing::new("k1", 7);
        let now = Arc::new(Mutex::new(t0()));
        let mut s = Srv { status: "active".into(), exp: Some(t0() + Duration::days(365)), nbf: t0(), lid: "CPA-2026-000001".into(), reject: None, offline: false, max_act: 1 };
        f(&mut s);
        let srv = Arc::new(Mutex::new(s));
        let calls = Arc::new(Mutex::new(vec![]));
        let dir = tempfile::tempdir().unwrap();
        let clock_now = now.clone();
        let mgr = LicenseManager::with_parts(
            LicenseStore::new(dir.path().join("license.dat"), Box::new(PortableBox)),
            ring(&[&key]),
            m.clone(),
            Box::new(FakeServer { srv: srv.clone(), key: Signing::new("k1", 7), now: now.clone(), calls: calls.clone() }),
            "1.0.0".into(),
            Box::new(move || *clock_now.lock().unwrap()),
        );
        Env { mgr, srv, now, key, calls, dir, machine: m }
    }
    fn token(&self, edit: impl FnOnce(&mut Value)) -> String {
        let s = self.srv.lock().unwrap().clone();
        let mut p = json!({
            "v": 1, "lid": s.lid, "product": "Chiller Plant Analyzer", "customer": "ABC Company", "company": "ABC", "iat": iso(t0()), "nbf": iso(s.nbf),
            "exp": s.exp.map(iso), "maxAct": 1, "bind": {"mode": "none"}, "features": {"bmsAnalysis": true, "excelExport": true},
        });
        edit(&mut p);
        self.key.seal("CPA1", p)
    }
    fn advance(&self, days: i64) { *self.now.lock().unwrap() += Duration::days(days); }
    fn activate(&self) -> licensing_core::LicenseStatus { self.mgr.activate(&self.token(|_| {})).unwrap() }
}

#[test]
fn no_license_is_unlicensed_and_blocks_analysis() {
    let e = Env::new();
    let s = e.mgr.status();
    assert_eq!(s.state, S::Unlicensed);
    assert!(!s.allowed);
    assert!(s.machine_id.starts_with("MID1."));
}

#[test]
fn valid_license_activates_and_reports_details() {
    let e = Env::new();
    let s = e.activate();
    assert_eq!(s.state, S::Active);
    assert!(s.allowed);
    assert_eq!(s.license_id.as_deref(), Some("CPA-2026-000001"));
    assert_eq!(s.customer.as_deref(), Some("ABC Company"));
    assert_eq!(s.days_remaining, Some(365));
    assert_eq!(s.machine_status, "notBound");
    assert!(s.features["excelExport"]);
    // status survives a restart (fresh manager over the same file)
    assert_eq!(e.mgr.status().state, S::Active);
}

#[test]
fn invalid_signature_is_rejected_before_any_network_call() {
    let e = Env::new();
    let tok = e.token(|_| {});
    let mut parts: Vec<String> = tok.split('.').map(String::from).collect();
    let mut payload: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(&parts[1]).unwrap()).unwrap();
    payload["exp"] = Value::Null; // try to make the license perpetual
    parts[1] = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap());
    let forged = parts.join(".");
    assert_eq!(e.mgr.activate(&forged).unwrap_err(), LicenseError::BadSignature);
    assert_eq!(e.mgr.activate("CPA1.abc").unwrap_err(), LicenseError::Malformed);
    assert_eq!(e.mgr.activate("garbage").unwrap_err(), LicenseError::Malformed);
    // signed by somebody else's key that claims to be k1
    let other = Signing { kid: "k1".into(), key: SigningKey::from_bytes(&[9; 32]) };
    let evil = other.seal("CPA1", json!({"v":1,"lid":"CPA-2026-000001","product":"Chiller Plant Analyzer","iat":iso(t0()),"nbf":iso(t0()),"exp":null,"maxAct":99,"bind":{"mode":"none"}}));
    assert_eq!(e.mgr.activate(&evil).unwrap_err(), LicenseError::BadSignature);
    assert!(e.calls.lock().unwrap().is_empty(), "no request must be made for a bad code");
    assert_eq!(e.mgr.status().state, S::Unlicensed);
}

#[test]
fn unknown_key_and_dev_keys_in_release_configuration() {
    let e = Env::new();
    let stranger = Signing::new("zz", 3);
    let tok = stranger.seal("CPA1", json!({"v":1,"lid":"x","product":"Chiller Plant Analyzer","iat":iso(t0()),"nbf":iso(t0()),"exp":null,"maxAct":1,"bind":{"mode":"none"}}));
    assert_eq!(e.mgr.activate(&tok).unwrap_err(), LicenseError::UnknownKey("zz".into()));
    // a keyring entry flagged dev is ignored when dev keys are not allowed (release builds)
    let dev = Signing::new("dev-1", 4);
    let release = KeyRing::from_json(&json!({"keys":[dev.entry(true)]}).to_string(), false).unwrap();
    assert!(release.kids().is_empty());
    let debug = KeyRing::from_json(&json!({"keys":[dev.entry(true)]}).to_string(), true).unwrap();
    assert_eq!(debug.kids(), vec!["dev-1"]);
    // the keyring compiled into the app never contains a private key
    assert!(!include_str!("../keys/public-keys.json").to_lowercase().contains("private"));
}

#[test]
fn wrong_product_is_rejected() {
    let e = Env::new();
    let tok = e.token(|p| p["product"] = json!("Some Other Tool"));
    assert_eq!(e.mgr.activate(&tok).unwrap_err(), LicenseError::WrongProduct);
}

#[test]
fn future_license_is_not_yet_valid() {
    let e = Env::with(|s| s.nbf = t0() + Duration::days(10));
    let err = e.mgr.activate(&e.token(|_| {})).unwrap_err();
    assert!(err.to_string().contains("not valid until 2026-10-10"), "{err}");
}

#[test]
fn expired_license_locks_the_application_with_the_required_message_even_offline() {
    let e = Env::with(|s| s.exp = Some(t0() + Duration::days(5)));
    e.activate();
    e.advance(6);
    let s = e.mgr.status();
    assert_eq!(s.state, S::Expired);
    assert!(!s.allowed);
    assert_eq!(s.message, "License expired. Please enter a valid activation code.");
}

#[test]
fn revoked_license_locks_after_the_next_successful_online_validation_only() {
    let e = Env::new();
    e.activate();
    e.srv.lock().unwrap().status = "revoked".into();
    // completely offline: the app cannot know – it keeps working (documented limitation)
    e.srv.lock().unwrap().offline = true;
    e.advance(2);
    let s = e.mgr.check();
    assert!(s.allowed, "revocation cannot reach an offline computer");
    assert!(s.offline_note.is_some());
    // reconnect → validation delivers the signed 'revoked' receipt → locked
    e.srv.lock().unwrap().offline = false;
    let s = e.mgr.check();
    assert_eq!(s.state, S::Revoked);
    assert!(!s.allowed);
    // and stays locked across restarts / offline
    e.srv.lock().unwrap().offline = true;
    assert_eq!(e.mgr.status().state, S::Revoked);
}

#[test]
fn suspended_and_reinstated() {
    let e = Env::new();
    e.activate();
    e.srv.lock().unwrap().status = "suspended".into();
    assert_eq!(e.mgr.check().state, S::Suspended);
    e.srv.lock().unwrap().status = "active".into();
    let s = e.mgr.check();
    assert_eq!(s.state, S::Active);
    assert!(s.allowed);
}

#[test]
fn wrong_machine_specific_binding_and_copied_license_file() {
    // token issued for machine "other"
    let other = machine("other");
    let e = Env::new();
    let tok = e.token(|p| p["bind"] = json!({"mode": "specific", "fp": other.fp, "parts": other.parts}));
    let err = e.mgr.activate(&tok).unwrap_err();
    assert!(err.to_string().contains("different computer"), "{err}");
    // license activated on PC A, cache copied to PC B
    let a = Env::build(machine("A"), |_| {});
    a.activate();
    let copied = std::fs::read(a.dir.path().join("license.dat")).unwrap();
    let b = Env::build(machine("B"), |_| {});
    std::fs::write(b.dir.path().join("license.dat"), copied).unwrap();
    let s = b.mgr.status();
    assert_eq!(s.state, S::WrongMachine);
    assert!(!s.allowed);
    assert_eq!(s.machine_status, "mismatch");
}

#[test]
fn hardware_upgrade_is_tolerated() {
    let e = Env::build(machine("old"), |_| {});
    e.activate();
    // one of five components replaced (e.g. new motherboard + same CPU/disk/OS)
    let mut raw: Vec<(&str, String)> = vec![("a", "old1".into()), ("b", "old2".into()), ("c", "old3".into()), ("d", "old4".into()), ("e", "NEW".into())];
    let upgraded = Machine::from_raw(&raw);
    assert_ne!(upgraded.fp, e.machine.fp);
    assert!(upgraded.matches(&e.machine.fp, &e.machine.parts));
    raw[3].1 = "NEW2".into(); // two components replaced: 3 of 5 = 60 % still matches
    assert!(Machine::from_raw(&raw).matches(&e.machine.fp, &e.machine.parts));
    raw[2].1 = "NEW3".into(); // three replaced: no longer the same machine
    assert!(!Machine::from_raw(&raw).matches(&e.machine.fp, &e.machine.parts));
}

#[test]
fn maximum_activations_error_is_reported() {
    let e = Env::with(|s| s.reject = Some(("max_activations".into(), "Maximum number of activations (1) reached.".into())));
    let err = e.mgr.activate(&e.token(|_| {})).unwrap_err();
    assert_eq!(err.code(), "max_activations");
    assert!(err.to_string().contains("Maximum number of activations"));
    assert_eq!(e.mgr.status().state, S::Unlicensed);
}

#[test]
fn offline_grace_period_warning_then_lock() {
    let e = Env::new(); // interval 7 days, grace 14 days
    e.activate();
    e.srv.lock().unwrap().offline = true;
    e.advance(6);
    assert_eq!(e.mgr.status().state, S::Active);
    e.advance(2); // day 8: past the 7-day check → warning, still allowed
    let s = e.mgr.status();
    assert_eq!(s.state, S::Warning);
    assert!(s.allowed);
    assert!(s.message.contains("overdue"));
    e.advance(12); // day 20: still inside 7 + 14
    assert_eq!(e.mgr.status().state, S::Warning);
    e.advance(2); // day 22: grace exhausted
    let s = e.mgr.status();
    assert_eq!(s.state, S::ValidationOverdue);
    assert!(!s.allowed);
    // reconnecting restores access
    e.srv.lock().unwrap().offline = false;
    let s = e.mgr.check();
    assert_eq!(s.state, S::Active);
    assert!(s.allowed);
}

#[test]
fn server_unavailable_keeps_working_and_explains() {
    let e = Env::new();
    e.activate();
    e.srv.lock().unwrap().offline = true;
    e.advance(1);
    let s = e.mgr.check();
    assert!(s.allowed);
    assert_eq!(s.state, S::Active);
    assert!(s.offline_note.unwrap().contains("Could not reach the licensing service"));
    // a server-side error (5xx / rate limit) is treated the same way – never as a revocation
    e.srv.lock().unwrap().offline = false;
    e.srv.lock().unwrap().reject = Some(("server_error".into(), "boom".into()));
    let s = e.mgr.check();
    assert!(s.allowed);
    assert!(s.offline_note.is_some());
}

#[test]
fn renewal_and_extension_arrive_through_validation_without_a_new_code() {
    let e = Env::with(|s| s.exp = Some(t0() + Duration::days(30)));
    e.activate();
    e.advance(28);
    e.srv.lock().unwrap().offline = true;
    assert!(e.mgr.status().state != S::Expired);
    e.srv.lock().unwrap().offline = false;
    e.srv.lock().unwrap().exp = Some(t0() + Duration::days(400)); // owner renewed – no rebuild, no new code
    let s = e.mgr.check();
    assert_eq!(s.state, S::Active);
    assert_eq!(s.days_remaining, Some(372));
    e.advance(40); // beyond the ORIGINAL 30-day expiry
    e.srv.lock().unwrap().offline = true;
    let _ = e.mgr.status();
    e.srv.lock().unwrap().offline = false;
    assert!(e.mgr.check().allowed);
}

#[test]
fn perpetual_license() {
    let e = Env::with(|s| s.exp = None);
    let s = e.mgr.activate(&e.token(|p| p["exp"] = Value::Null)).unwrap();
    assert!(s.perpetual);
    assert_eq!(s.days_remaining, None);
    e.advance(3650);
    e.srv.lock().unwrap().offline = false;
    assert!(e.mgr.check().allowed);
}

#[test]
fn deactivation_releases_the_slot_and_removes_the_local_license() {
    let e = Env::new();
    e.activate();
    let s = e.mgr.deactivate(false).unwrap();
    assert_eq!(s.state, S::Unlicensed);
    assert!(e.calls.lock().unwrap().contains(&"/v1/deactivate".to_string()));
    assert!(!e.dir.path().join("license.dat").exists());
    // offline: refuses unless the user chooses local-only removal
    e.activate();
    e.srv.lock().unwrap().offline = true;
    assert!(matches!(e.mgr.deactivate(false), Err(LicenseError::Network(_))));
    assert_eq!(e.mgr.status().state, S::Active);
    assert_eq!(e.mgr.deactivate(true).unwrap().state, S::Unlicensed);
}

#[test]
fn owner_deactivating_a_machine_locks_it_on_the_next_check() {
    let e = Env::new();
    e.activate();
    e.srv.lock().unwrap().reject = Some(("not_activated".into(), "This computer is not activated".into()));
    let s = e.mgr.check();
    assert_eq!(s.state, S::Deactivated);
    assert!(!s.allowed);
}

#[test]
fn clock_rollback_cannot_extend_an_expired_or_stale_license() {
    let e = Env::with(|s| s.exp = Some(t0() + Duration::days(10)));
    e.activate();
    e.advance(12);
    assert_eq!(e.mgr.status().state, S::Expired); // records last_seen = day 12
    *e.now.lock().unwrap() = t0() + Duration::days(1); // user winds the clock back
    assert_eq!(e.mgr.status().state, S::Expired);
}

#[test]
fn key_rotation_old_licenses_keep_working_when_a_new_key_is_added() {
    let old = Signing::new("k1", 7);
    let new = Signing::new("k2", 8);
    let both = ring(&[&old, &new]);
    let p = json!({"v":1,"lid":"CPA-2026-000009","product":"Chiller Plant Analyzer","iat":iso(t0()),"nbf":iso(t0()),"exp":null,"maxAct":1,"bind":{"mode":"none"}});
    assert!(both.open::<Value>("CPA1", &old.seal("CPA1", p.clone())).is_ok());
    assert!(both.open::<Value>("CPA1", &new.seal("CPA1", p.clone())).is_ok());
    // an app build that only knows k1 rejects k2 licences with a clear message
    assert_eq!(ring(&[&old]).open::<Value>("CPA1", &new.seal("CPA1", p)).unwrap_err(), LicenseError::UnknownKey("k2".into()));
}

#[test]
fn local_cache_is_encrypted_and_tamper_evident() {
    let e = Env::new();
    e.activate();
    let path = e.dir.path().join("license.dat");
    let blob = std::fs::read(&path).unwrap();
    let text = String::from_utf8_lossy(&blob).to_string();
    assert!(!text.contains("CPA-2026-000001") && !text.contains("CPA1."), "cache must not be plain text");
    let mut bad = blob.clone();
    let n = bad.len() - 5;
    bad[n] ^= 0xff;
    std::fs::write(&path, bad).unwrap();
    let s = e.mgr.status();
    assert_eq!(s.state, S::Invalid);
    assert!(!s.allowed);
}

#[test]
fn replayed_server_response_is_rejected() {
    // A server response captured earlier (different nonce) must not be accepted for a new request.
    struct Replay(String);
    impl Transport for Replay {
        fn post(&self, _: &str, _: &Value) -> Result<Value, LicenseError> { Ok(json!({"receipt": self.0})) }
    }
    let e = Env::new();
    let tok = e.token(|_| {});
    let old_receipt = e.key.seal("CPR1", json!({"v":1,"lid":"CPA-2026-000001","status":"active","exp":null,"nbf":iso(t0()),"fp":e.machine.fp,"parts":e.machine.parts,"validatedAt":iso(t0()),"checkIntervalDays":7,"graceDays":14,"activations":1,"maxAct":1,"features":{},"nonce":"old-nonce"}));
    let mgr = LicenseManager::with_parts(
        LicenseStore::new(e.dir.path().join("x.dat"), Box::new(PortableBox)), ring(&[&e.key]), e.machine.clone(), Box::new(Replay(old_receipt)), "1.0.0".into(), Box::new(t0),
    );
    assert!(mgr.activate(&tok).unwrap_err().to_string().contains("not fresh"));
}

// ---------------------------------------------------------------- offline licenses
fn offline_token(e: &Env, m: &Machine, edit: impl FnOnce(&mut Value)) -> String {
    let mut p = json!({
        "v": 1, "lid": "CPA-2026-000777", "product": "Chiller Plant Analyzer", "customer": "Owner", "company": "", "iat": iso(t0()), "nbf": iso(t0()),
        "exp": null, "maxAct": 1, "bind": {"mode": "specific", "fp": m.fp, "parts": m.parts}, "features": {"excelExport": true}, "off": 1,
    });
    edit(&mut p);
    e.key.seal("CPA1", p)
}

#[test]
fn offline_license_activates_without_any_network_call_and_never_needs_validation() {
    let e = Env::new();
    e.srv.lock().unwrap().offline = true; // the licensing service is unreachable throughout
    let s = e.mgr.activate(&offline_token(&e, &e.machine.clone(), |_| {})).unwrap();
    assert_eq!(s.state, S::Active);
    assert!(s.allowed && s.offline_license && s.perpetual);
    assert!(e.calls.lock().unwrap().is_empty(), "offline licenses must not contact the service");
    e.advance(3000); // years later: no validation, no grace policy
    assert_eq!(e.mgr.status().state, S::Active);
    assert_eq!(e.mgr.check().state, S::Active);
    assert!(e.calls.lock().unwrap().is_empty());
    assert_eq!(e.mgr.deactivate(false).unwrap().state, S::Unlicensed);
    assert!(e.calls.lock().unwrap().is_empty());
}

#[test]
fn offline_license_still_enforces_signature_machine_and_expiry() {
    let e = Env::new();
    // wrong machine
    let other = machine("someone-else");
    let err = e.mgr.activate(&offline_token(&e, &other, |_| {})).unwrap_err();
    assert!(err.to_string().contains("different computer"), "{err}");
    // forged (unsigned edit)
    let tok = offline_token(&e, &e.machine.clone(), |_| {});
    let mut parts: Vec<String> = tok.split('.').map(String::from).collect();
    let mut payload: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(&parts[1]).unwrap()).unwrap();
    payload["bind"] = json!({"mode": "none"});
    parts[1] = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap());
    assert_eq!(e.mgr.activate(&parts.join(".")).unwrap_err(), LicenseError::BadSignature);
    // expiry is taken from the signed code
    let short = offline_token(&e, &e.machine.clone(), |p| p["exp"] = json!(iso(t0() + Duration::days(10))));
    assert_eq!(e.mgr.activate(&short).unwrap().days_remaining, Some(10));
    e.advance(11);
    let s = e.mgr.status();
    assert_eq!(s.state, S::Expired);
    assert!(!s.allowed);
    // cache copied to another PC is refused
    let b = Env::build(machine("B"), |_| {});
    std::fs::copy(e.dir.path().join("license.dat"), b.dir.path().join("license.dat")).unwrap();
    assert_eq!(b.mgr.status().state, S::WrongMachine);
}
