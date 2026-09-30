use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// A hashed, non-reversible machine identity built from several independent characteristics.
/// Only hashes ever leave the machine. Two identities are the "same machine" when the combined hash is
/// equal or at least 60 % of the components match, so replacing a disk or motherboard does not lock
/// a legitimate customer out (and the owner can authorise replacements explicitly).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Machine {
    pub fp: String,
    pub parts: Vec<String>,
}

pub const MATCH_RATIO: f64 = 0.6;

fn sha_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

impl Machine {
    /// Build from named raw components (name, value). Values are salted with the component name.
    pub fn from_raw(raw: &[(&str, String)]) -> Self {
        let parts: Vec<String> = raw.iter().map(|(n, v)| sha_hex(&format!("cpa-fp-v1|{n}|{}", v.trim().to_lowercase()))).collect();
        let fp = sha_hex(&parts.join("|"));
        Self { fp, parts }
    }

    pub fn current() -> Self {
        Self::from_raw(&platform::collect())
    }

    pub fn matches(&self, other_fp: &str, other_parts: &[String]) -> bool {
        if !other_fp.is_empty() && self.fp == other_fp {
            return true;
        }
        if self.parts.is_empty() || other_parts.is_empty() {
            return false;
        }
        let overlap = self.parts.iter().filter(|p| other_parts.contains(p)).count();
        overlap as f64 >= (MATCH_RATIO * self.parts.len().max(other_parts.len()) as f64).ceil()
    }

    /// Text shown on the License page and pasted into the License Manager for machine-specific licenses.
    pub fn machine_id(&self) -> String {
        format!("MID1.{}", URL_SAFE_NO_PAD.encode(serde_json::to_vec(self).expect("serialisable")))
    }
}

#[cfg(windows)]
mod platform {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};

    fn reg(path: &str, name: &str) -> String {
        RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path).and_then(|k| k.get_value::<String, _>(name)).unwrap_or_default()
    }
    pub fn collect() -> Vec<(&'static str, String)> {
        let bios = r"HARDWARE\DESCRIPTION\System\BIOS";
        vec![
            ("machine-guid", reg(r"SOFTWARE\Microsoft\Cryptography", "MachineGuid")),
            ("computer-name", std::env::var("COMPUTERNAME").unwrap_or_default()),
            ("cpu", reg(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString")),
            ("bios", format!("{}|{}|{}", reg(bios, "BIOSVendor"), reg(bios, "SystemManufacturer"), reg(bios, "SystemProductName"))),
            ("board", format!("{}|{}", reg(bios, "BaseBoardManufacturer"), reg(bios, "BaseBoardProduct"))),
        ]
    }
}

#[cfg(not(windows))]
mod platform {
    // Development / CI only (the shipped product is Windows).
    fn read(p: &str) -> String {
        std::fs::read_to_string(p).unwrap_or_default()
    }
    pub fn collect() -> Vec<(&'static str, String)> {
        let cpu = read("/proc/cpuinfo").lines().find(|l| l.starts_with("model name")).unwrap_or("").to_string();
        vec![
            ("machine-guid", read("/etc/machine-id")),
            ("computer-name", read("/etc/hostname")),
            ("cpu", cpu),
            ("bios", read("/sys/class/dmi/id/bios_vendor")),
            ("board", read("/sys/class/dmi/id/board_name")),
        ]
    }
}
