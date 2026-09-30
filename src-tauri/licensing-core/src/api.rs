use crate::error::LicenseError;
use serde_json::Value;
use std::time::Duration;

/// Abstraction over the HTTPS calls so the policy code can be tested without a network.
pub trait Transport: Send + Sync {
    fn post(&self, path: &str, body: &Value) -> Result<Value, LicenseError>;
}

pub struct HttpTransport {
    base: String,
    agent: ureq::Agent,
}

impl HttpTransport {
    /// `allow_insecure_localhost` permits plain HTTP to 127.0.0.1/localhost for development and tests only.
    pub fn new(base: &str, allow_insecure_localhost: bool) -> Result<Self, LicenseError> {
        let base = base.trim_end_matches('/').to_string();
        let local = base.starts_with("http://127.0.0.1") || base.starts_with("http://localhost");
        if !(base.starts_with("https://") || (allow_insecure_localhost && local)) {
            return Err(LicenseError::Invalid("The licensing service URL must use HTTPS.".into()));
        }
        let builder = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).user_agent("ChillerPlantAnalyzer-License/1");
        #[cfg(windows)]
        let builder = {
            let tls = native_tls::TlsConnector::new().map_err(|e| LicenseError::Network(e.to_string()))?;
            builder.tls_connector(std::sync::Arc::new(tls))
        };
        Ok(Self { base, agent: builder.build() })
    }
}

impl Transport for HttpTransport {
    fn post(&self, path: &str, body: &Value) -> Result<Value, LicenseError> {
        match self.agent.post(&format!("{}{}", self.base, path)).send_json(body) {
            Ok(r) => r.into_json::<Value>().map_err(|e| LicenseError::Network(format!("unreadable response: {e}"))),
            Err(ureq::Error::Status(code, resp)) => {
                let v: Value = resp.into_json().unwrap_or(Value::Null);
                Err(LicenseError::Server {
                    code: v.get("error").and_then(Value::as_str).unwrap_or(if code >= 500 { "server_error" } else { "http_error" }).to_string(),
                    message: v.get("message").and_then(Value::as_str).unwrap_or("The licensing service rejected the request.").to_string(),
                })
            }
            Err(ureq::Error::Transport(t)) => Err(LicenseError::Network(t.to_string())),
        }
    }
}
