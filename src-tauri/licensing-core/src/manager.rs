use crate::api::{HttpTransport, Transport};
use crate::error::LicenseError;
use crate::fingerprint::Machine;
use crate::keyring::KeyRing;
use crate::model::{LicenseState, LicenseStatus, ReceiptPayload, TokenPayload};
use crate::policy::evaluate;
use crate::store::{default_box, LicenseStore, StoredLicense};
use crate::PRODUCT_NAME;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Value};
use std::path::PathBuf;

/// Placeholder – override at build time with `CPA_LICENSE_URL=https://licensing.yourcompany.com`.
pub const DEFAULT_LICENSE_URL: &str = match option_env!("CPA_LICENSE_URL") {
    Some(u) => u,
    None => "https://license.example.com",
};

pub struct ManagerConfig {
    pub store_path: PathBuf,
    pub base_url: String,
    pub app_version: String,
}

pub struct LicenseManager {
    store: LicenseStore,
    ring: KeyRing,
    machine: Machine,
    transport: Box<dyn Transport>,
    app_version: String,
    clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
}

fn iso(d: DateTime<Utc>) -> String {
    d.to_rfc3339_opts(SecondsFormat::Secs, true)
}
fn parse(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}
fn nonce() -> String {
    use rand_core::RngCore;
    let mut b = [0u8; 16];
    rand_core::OsRng.fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}

impl LicenseManager {
    pub fn new(cfg: ManagerConfig) -> Result<Self, LicenseError> {
        let base = std::env::var("CPA_LICENSE_URL").ok().filter(|_| cfg!(debug_assertions)).unwrap_or(cfg.base_url);
        Ok(Self::with_parts(
            LicenseStore::new(cfg.store_path, default_box()),
            KeyRing::embedded(),
            Machine::current(),
            Box::new(HttpTransport::new(&base, cfg!(debug_assertions))?),
            cfg.app_version,
            Box::new(Utc::now),
        ))
    }

    /// Full dependency injection (tests, alternative storage).
    pub fn with_parts(
        store: LicenseStore,
        ring: KeyRing,
        machine: Machine,
        transport: Box<dyn Transport>,
        app_version: String,
        clock: Box<dyn Fn() -> DateTime<Utc> + Send + Sync>,
    ) -> Self {
        Self { store, ring, machine, transport, app_version, clock }
    }

    pub fn machine_id(&self) -> String {
        self.machine.machine_id()
    }

    fn now(&self) -> DateTime<Utc> {
        (self.clock)()
    }

    fn machine_json(&self) -> Value {
        json!({ "fp": self.machine.fp, "parts": self.machine.parts })
    }

    /// Current status from local data only (no network). Also advances the clock-rollback watermark.
    pub fn status(&self) -> LicenseStatus {
        match self.store.load() {
            Ok(mut st) => {
                if let Some(s) = st.as_mut() {
                    let now = self.now();
                    if parse(&s.last_seen).map(|l| now > l).unwrap_or(true) {
                        s.last_seen = iso(now);
                        let _ = self.store.save(s);
                    }
                }
                evaluate(st.as_ref(), &self.ring, &self.machine, self.now())
            }
            Err(e) => LicenseStatus::empty(LicenseState::Invalid, format!("{e} – please activate again."), self.machine.machine_id()),
        }
    }

    fn verify_receipt(&self, receipt: &str, lid: &str, expect_nonce: &str) -> Result<ReceiptPayload, LicenseError> {
        let rc: ReceiptPayload = self.ring.open("CPR1", receipt)?;
        if rc.lid != lid {
            return Err(LicenseError::Invalid("The server response belongs to a different license.".into()));
        }
        if rc.nonce.as_deref() != Some(expect_nonce) {
            return Err(LicenseError::Invalid("The server response was not fresh (nonce mismatch).".into()));
        }
        if !self.machine.matches(&rc.fp, &rc.parts) {
            return Err(LicenseError::Invalid("The server response is for a different computer.".into()));
        }
        Ok(rc)
    }

    /// Activate with an activation code. Requires internet (initial activation).
    pub fn activate(&self, code: &str) -> Result<LicenseStatus, LicenseError> {
        let tok: TokenPayload = self.ring.open("CPA1", code)?;
        if tok.product != PRODUCT_NAME {
            return Err(LicenseError::WrongProduct);
        }
        let now = self.now();
        if parse(&tok.nbf).map(|n| n > now).unwrap_or(false) {
            return Err(LicenseError::Invalid(format!("This license is not valid until {}.", &tok.nbf[..10.min(tok.nbf.len())])));
        }
        if tok.bind.mode == "specific" && !self.machine.matches(tok.bind.fp.as_deref().unwrap_or(""), &tok.bind.parts) {
            return Err(LicenseError::Invalid("This activation code is bound to a different computer.".into()));
        }
        let cleaned: String = code.chars().filter(|c| !c.is_whitespace()).collect();
        let n = nonce();
        let resp = self.transport.post(
            "/v1/activate",
            &json!({ "token": cleaned, "machine": self.machine_json(), "appVersion": self.app_version, "nonce": n }),
        )?;
        let receipt = resp.get("receipt").and_then(Value::as_str).ok_or_else(|| LicenseError::Network("unexpected response from the licensing service".into()))?;
        let rc = self.verify_receipt(receipt, &tok.lid, &n)?;
        if rc.status != "active" {
            return Err(LicenseError::Invalid(format!("The license status is \"{}\".", rc.status)));
        }
        self.store.save(&StoredLicense {
            token: cleaned,
            receipt: Some(receipt.to_string()),
            activated_at: iso(now),
            last_seen: iso(now),
            lock: None,
        })?;
        Ok(self.status())
    }

    /// Online validation ("Check License"). If the service is unreachable the local policy (grace period)
    /// decides and `offline_note` explains why the check could not be completed.
    pub fn check(&self) -> LicenseStatus {
        let st = match self.store.load() {
            Ok(Some(s)) => s,
            _ => return self.status(),
        };
        let Ok(tok) = self.ring.open::<TokenPayload>("CPA1", &st.token) else { return self.status() };
        let n = nonce();
        let result = self.transport.post(
            "/v1/validate",
            &json!({ "licenseId": tok.lid, "machine": self.machine_json(), "appVersion": self.app_version, "nonce": n }),
        );
        match result {
            Ok(resp) => {
                let rc = resp.get("receipt").and_then(Value::as_str).map(|r| (r.to_string(), self.verify_receipt(r, &tok.lid, &n)));
                match rc {
                    Some((raw, Ok(_))) => {
                        let mut s = st;
                        s.receipt = Some(raw);
                        s.lock = None;
                        s.last_seen = iso(self.now());
                        let _ = self.store.save(&s);
                        self.status()
                    }
                    _ => self.with_note("The licensing service returned an invalid response.".into()),
                }
            }
            Err(LicenseError::Server { code, .. }) if code == "not_activated" || code == "unknown_license" => {
                let mut s = st;
                s.lock = Some(code);
                let _ = self.store.save(&s);
                self.status()
            }
            Err(e) => self.with_note(match e {
                LicenseError::Network(m) => format!("Could not reach the licensing service ({m}). The offline grace period applies."),
                other => format!("The licensing service could not validate the license ({other}). The offline grace period applies."),
            }),
        }
    }

    fn with_note(&self, note: String) -> LicenseStatus {
        let mut s = self.status();
        s.offline_note = Some(note);
        s
    }

    /// Release this computer's activation slot. With `force_local`, the local license is removed even if the
    /// service cannot be reached (the slot then stays occupied until the owner frees it).
    pub fn deactivate(&self, force_local: bool) -> Result<LicenseStatus, LicenseError> {
        if let Ok(Some(st)) = self.store.load() {
            if let Ok(tok) = self.ring.open::<TokenPayload>("CPA1", &st.token) {
                match self.transport.post("/v1/deactivate", &json!({ "licenseId": tok.lid, "machine": self.machine_json(), "appVersion": self.app_version, "nonce": nonce() })) {
                    Ok(_) => {}
                    Err(LicenseError::Network(m)) if !force_local => {
                        return Err(LicenseError::Network(format!("{m}. Connect to the internet to release the activation, or choose to remove the license locally only.")));
                    }
                    Err(LicenseError::Network(_)) => {}
                    Err(e) => return Err(e),
                }
            }
        }
        self.store.clear()?;
        Ok(self.status())
    }
}
