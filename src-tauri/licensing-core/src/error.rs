use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum LicenseError {
    #[error("The activation code is malformed. Please copy the complete code.")]
    Malformed,
    #[error("This activation code was signed with an unknown key ({0}). Please update the application.")]
    UnknownKey(String),
    #[error("The activation code has an invalid signature.")]
    BadSignature,
    #[error("This activation code is for a different product.")]
    WrongProduct,
    /// Error reported by the licensing service (`code` is machine readable).
    #[error("{message}")]
    Server { code: String, message: String },
    #[error("Cannot reach the licensing service: {0}")]
    Network(String),
    #[error("{0}")]
    Invalid(String),
    #[error("Local license storage error: {0}")]
    Storage(String),
}

impl LicenseError {
    pub fn code(&self) -> String {
        match self {
            Self::Malformed => "malformed".into(),
            Self::UnknownKey(_) => "unknown_key".into(),
            Self::BadSignature => "bad_signature".into(),
            Self::WrongProduct => "wrong_product".into(),
            Self::Server { code, .. } => code.clone(),
            Self::Network(_) => "network".into(),
            Self::Invalid(_) => "invalid".into(),
            Self::Storage(_) => "storage".into(),
        }
    }
}
