use crate::error::LicenseError;
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{de::DeserializeOwned, Deserialize};

/// Public keys only. New keys can be appended (key rotation) without breaking existing licenses:
/// every envelope names the key that signed it (`kid`).
#[derive(Debug, Clone)]
pub struct KeyRing {
    keys: Vec<(String, VerifyingKey)>,
}

#[derive(Deserialize)]
struct KeyFile {
    keys: Vec<KeyEntry>,
}
#[derive(Deserialize)]
struct KeyEntry {
    kid: String,
    alg: String,
    public: String,
    #[serde(default)]
    dev: bool,
    #[serde(default)]
    retired: bool,
}

impl KeyRing {
    /// The keyring compiled into the application. Development keys (`"dev": true`) are honoured in
    /// debug builds only, so a release build never trusts the committed test key.
    pub fn embedded() -> Self {
        let mut ring = Self::from_json(include_str!("../keys/public-keys.json"), false).expect("embedded keyring is valid");
        // The throw-away development key exists only in debug builds; release binaries do not contain it.
        #[cfg(debug_assertions)]
        ring.keys.extend(Self::from_json(include_str!("../keys/dev-keys.json"), true).expect("dev keyring is valid").keys);
        ring
    }

    pub fn from_json(json: &str, allow_dev: bool) -> Result<Self, LicenseError> {
        let f: KeyFile = serde_json::from_str(json).map_err(|e| LicenseError::Invalid(format!("keyring: {e}")))?;
        let mut keys = Vec::new();
        for e in f.keys {
            if e.alg != "ed25519" || (e.dev && !allow_dev) || e.retired {
                continue;
            }
            let raw = STANDARD.decode(e.public.trim()).map_err(|e| LicenseError::Invalid(format!("keyring: {e}")))?;
            let arr: [u8; 32] = raw.try_into().map_err(|_| LicenseError::Invalid("keyring: key must be 32 bytes".into()))?;
            let vk = VerifyingKey::from_bytes(&arr).map_err(|e| LicenseError::Invalid(format!("keyring: {e}")))?;
            keys.push((e.kid, vk));
        }
        Ok(Self { keys })
    }

    pub fn kids(&self) -> Vec<&str> {
        self.keys.iter().map(|(k, _)| k.as_str()).collect()
    }

    /// Verify an envelope `<prefix>.<payload b64url>.<signature b64url>`; the signature covers
    /// `"<prefix>.<payload b64url>"`. Returns the decoded payload only if the signature is valid.
    pub fn open<T: DeserializeOwned>(&self, prefix: &str, token: &str) -> Result<T, LicenseError> {
        let cleaned: String = token.chars().filter(|c| !c.is_whitespace()).collect();
        let parts: Vec<&str> = cleaned.split('.').collect();
        if parts.len() != 3 || parts[0] != prefix {
            return Err(LicenseError::Malformed);
        }
        let payload_bytes = URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| LicenseError::Malformed)?;
        let sig_bytes = URL_SAFE_NO_PAD.decode(parts[2]).map_err(|_| LicenseError::Malformed)?;
        #[derive(Deserialize)]
        struct Kid {
            kid: String,
        }
        let kid: Kid = serde_json::from_slice(&payload_bytes).map_err(|_| LicenseError::Malformed)?;
        let (_, key) = self
            .keys
            .iter()
            .find(|(k, _)| *k == kid.kid)
            .ok_or_else(|| LicenseError::UnknownKey(kid.kid.clone()))?;
        let sig_arr: [u8; 64] = sig_bytes.try_into().map_err(|_| LicenseError::BadSignature)?;
        let sig = Signature::from_bytes(&sig_arr);
        let msg = format!("{}.{}", parts[0], parts[1]);
        key.verify(msg.as_bytes(), &sig).map_err(|_| LicenseError::BadSignature)?;
        serde_json::from_slice(&payload_bytes).map_err(|_| LicenseError::Malformed)
    }
}
