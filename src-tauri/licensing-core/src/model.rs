use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub mode: String, // none | first | specific
    #[serde(default)]
    pub fp: Option<String>,
    #[serde(default)]
    pub parts: Vec<String>,
}

/// Signed activation code payload (`CPA1`). Status is deliberately NOT part of it: it lives on the server.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPayload {
    pub v: u32,
    pub kid: String,
    pub lid: String,
    pub product: String,
    #[serde(default)]
    pub customer: String,
    #[serde(default)]
    pub company: String,
    pub iat: String,
    pub nbf: String,
    pub exp: Option<String>,
    pub max_act: u32,
    pub bind: Binding,
    #[serde(default)]
    pub features: BTreeMap<String, bool>,
    /// 1 = self-contained offline license: verified locally, never contacts the licensing service.
    #[serde(default)]
    pub off: u8,
}

/// Signed server receipt (`CPR1`): the authoritative licence state at `validated_at` for one machine.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptPayload {
    pub v: u32,
    pub kid: String,
    pub lid: String,
    pub status: String, // active | suspended | revoked | expired
    pub exp: Option<String>,
    #[serde(default)]
    pub nbf: Option<String>,
    pub fp: String,
    #[serde(default)]
    pub parts: Vec<String>,
    pub validated_at: String,
    pub check_interval_days: i64,
    pub grace_days: i64,
    #[serde(default)]
    pub activations: u32,
    #[serde(default)]
    pub max_act: u32,
    #[serde(default)]
    pub features: BTreeMap<String, bool>,
    #[serde(default)]
    pub nonce: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LicenseState {
    /// No license installed.
    Unlicensed,
    Active,
    /// Usable, but the periodic online validation is overdue (inside the offline grace period).
    Warning,
    Expired,
    Revoked,
    Suspended,
    NotYetValid,
    /// Offline grace period exhausted – connect to the internet to validate.
    ValidationOverdue,
    WrongMachine,
    /// The licensing service no longer recognises this computer (deactivated by the owner).
    Deactivated,
    Invalid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub state: LicenseState,
    pub allowed: bool,
    pub message: String,
    pub license_id: Option<String>,
    pub customer: Option<String>,
    pub company: Option<String>,
    pub product: Option<String>,
    pub activated_at: Option<String>,
    pub expires_at: Option<String>,
    pub perpetual: bool,
    pub days_remaining: Option<i64>,
    /// notBound | bound | mismatch | unknown
    pub machine_status: String,
    pub machine_id: String,
    pub last_validation: Option<String>,
    pub next_validation_due: Option<String>,
    pub grace_ends_at: Option<String>,
    pub features: BTreeMap<String, bool>,
    pub max_activations: Option<u32>,
    pub activations: Option<u32>,
    pub key_id: Option<String>,
    /// Set when the last online check could not reach the server.
    pub offline_note: Option<String>,
    /// True for offline licenses (no online validation, cannot be revoked remotely).
    pub offline_license: bool,
}

impl LicenseStatus {
    pub fn empty(state: LicenseState, message: impl Into<String>, machine_id: String) -> Self {
        Self {
            state,
            allowed: false,
            message: message.into(),
            license_id: None,
            customer: None,
            company: None,
            product: None,
            activated_at: None,
            expires_at: None,
            perpetual: false,
            days_remaining: None,
            machine_status: "unknown".into(),
            machine_id,
            last_validation: None,
            next_validation_due: None,
            grace_ends_at: None,
            features: BTreeMap::new(),
            max_activations: None,
            activations: None,
            key_id: None,
            offline_note: None,
            offline_license: false,
        }
    }
}
