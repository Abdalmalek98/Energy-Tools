use crate::error::LicenseError;
use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Encrypts the local license cache. On Windows this is DPAPI (bound to the user's profile); elsewhere
/// (developer machines, CI) an AES-256-GCM box with a fixed application key is used – NOT a security
/// boundary, it only keeps the file from being casually edited.
pub trait SecretBox: Send + Sync {
    fn seal(&self, data: &[u8]) -> Result<Vec<u8>, LicenseError>;
    fn open(&self, blob: &[u8]) -> Result<Vec<u8>, LicenseError>;
}

const ENTROPY: &[u8] = b"ChillerPlantAnalyzer/license/v1";

pub struct PortableBox;
impl PortableBox {
    fn cipher() -> Aes256Gcm {
        let key = Sha256::digest([b"cpa-portable-box-v1".as_slice(), ENTROPY].concat());
        Aes256Gcm::new_from_slice(&key).expect("32-byte key")
    }
}
impl SecretBox for PortableBox {
    fn seal(&self, data: &[u8]) -> Result<Vec<u8>, LicenseError> {
        use rand_core::RngCore;
        let mut nonce = [0u8; 12];
        rand_core::OsRng.fill_bytes(&mut nonce);
        let ct = Self::cipher().encrypt(Nonce::from_slice(&nonce), data).map_err(|e| LicenseError::Storage(e.to_string()))?;
        Ok([nonce.to_vec(), ct].concat())
    }
    fn open(&self, blob: &[u8]) -> Result<Vec<u8>, LicenseError> {
        if blob.len() < 13 {
            return Err(LicenseError::Storage("license cache is corrupted".into()));
        }
        Self::cipher()
            .decrypt(Nonce::from_slice(&blob[..12]), &blob[12..])
            .map_err(|_| LicenseError::Storage("license cache is corrupted or was modified".into()))
    }
}

#[cfg(windows)]
pub struct Dpapi;
#[cfg(windows)]
impl SecretBox for Dpapi {
    fn seal(&self, data: &[u8]) -> Result<Vec<u8>, LicenseError> {
        use windows::Win32::{Foundation::{LocalFree, HLOCAL}, Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB}};
        unsafe {
            let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
            let entropy = CRYPT_INTEGER_BLOB { cbData: ENTROPY.len() as u32, pbData: ENTROPY.as_ptr() as *mut u8 };
            let mut out = CRYPT_INTEGER_BLOB::default();
            CryptProtectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).map_err(|e| LicenseError::Storage(format!("DPAPI: {e}")))?;
            let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            let _ = LocalFree(HLOCAL(out.pbData as *mut _));
            Ok(v)
        }
    }
    fn open(&self, blob: &[u8]) -> Result<Vec<u8>, LicenseError> {
        use windows::Win32::{Foundation::{LocalFree, HLOCAL}, Security::Cryptography::{CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB}};
        unsafe {
            let input = CRYPT_INTEGER_BLOB { cbData: blob.len() as u32, pbData: blob.as_ptr() as *mut u8 };
            let entropy = CRYPT_INTEGER_BLOB { cbData: ENTROPY.len() as u32, pbData: ENTROPY.as_ptr() as *mut u8 };
            let mut out = CRYPT_INTEGER_BLOB::default();
            CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
                .map_err(|_| LicenseError::Storage("license cache cannot be decrypted (different Windows user, or corrupted)".into()))?;
            let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            let _ = LocalFree(HLOCAL(out.pbData as *mut _));
            Ok(v)
        }
    }
}

pub fn default_box() -> Box<dyn SecretBox> {
    #[cfg(windows)]
    {
        Box::new(Dpapi)
    }
    #[cfg(not(windows))]
    {
        Box::new(PortableBox)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredLicense {
    pub token: String,
    pub receipt: Option<String>,
    pub activated_at: String,
    /// Latest time this installation has observed – protects against clock roll-back.
    pub last_seen: String,
    /// Set when the service told us this machine is no longer authorised.
    pub lock: Option<String>,
}

pub struct LicenseStore {
    path: PathBuf,
    boxed: Box<dyn SecretBox>,
}

impl LicenseStore {
    pub fn new(path: impl AsRef<Path>, boxed: Box<dyn SecretBox>) -> Self {
        Self { path: path.as_ref().to_path_buf(), boxed }
    }
    pub fn load(&self) -> Result<Option<StoredLicense>, LicenseError> {
        match std::fs::read(&self.path) {
            Ok(blob) => {
                let plain = self.boxed.open(&blob)?;
                serde_json::from_slice(&plain).map(Some).map_err(|e| LicenseError::Storage(e.to_string()))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(LicenseError::Storage(e.to_string())),
        }
    }
    pub fn save(&self, s: &StoredLicense) -> Result<(), LicenseError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| LicenseError::Storage(e.to_string()))?;
        }
        let blob = self.boxed.seal(&serde_json::to_vec(s).map_err(|e| LicenseError::Storage(e.to_string()))?)?;
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, blob).map_err(|e| LicenseError::Storage(e.to_string()))?;
        std::fs::rename(&tmp, &self.path).map_err(|e| LicenseError::Storage(e.to_string()))
    }
    pub fn clear(&self) -> Result<(), LicenseError> {
        match std::fs::remove_file(&self.path) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(LicenseError::Storage(e.to_string())),
        }
    }
}
