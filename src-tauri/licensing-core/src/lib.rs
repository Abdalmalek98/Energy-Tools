//! Client-side licensing for Chiller Plant Analyzer.
//!
//! * Contains ONLY public verification keys – never a signing key, never admin credentials.
//! * Licenses and server receipts are Ed25519-signed envelopes (`CPA1.` / `CPR1.`), verified here.
//! * The signed license state is kept in a protected local file (Windows DPAPI on Windows).
//! * Nothing but licensing metadata (license id, hashed machine fingerprint, app version, nonce)
//!   is ever sent to the licensing service. Engineering data never leaves the machine.

pub mod api;
pub mod error;
pub mod fingerprint;
pub mod keyring;
pub mod manager;
pub mod model;
pub mod policy;
pub mod store;

pub use error::LicenseError;
pub use manager::{LicenseManager, ManagerConfig};
pub use model::{LicenseState, LicenseStatus};

pub const PRODUCT_NAME: &str = "Chiller Plant Analyzer";
