use crate::fingerprint::Machine;
use crate::keyring::KeyRing;
use crate::model::{LicenseState as S, LicenseStatus, ReceiptPayload, TokenPayload};
use crate::store::StoredLicense;
use crate::PRODUCT_NAME;
use chrono::{DateTime, Duration, Utc};

fn parse(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}
fn iso(d: DateTime<Utc>) -> String {
    d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Pure licence evaluation: given what is stored locally, the public keyring, this machine and the
/// current time, decide whether analysis is allowed. Signatures are re-verified on every call, so
/// editing the (decrypted) cache cannot change the outcome.
///
/// Remote revocation cannot reach a computer that never talks to the service: a revoked/suspended state is
/// only learned at the next successful online validation. Until then the offline policy (check interval +
/// grace period) is what bounds unlicensed use.
pub fn evaluate(stored: Option<&StoredLicense>, ring: &KeyRing, machine: &Machine, now: DateTime<Utc>) -> LicenseStatus {
    let mid = machine.machine_id();
    let Some(st) = stored else {
        return LicenseStatus::empty(S::Unlicensed, "No license is installed. Enter an activation code to activate Chiller Plant Analyzer.", mid);
    };
    let tok: TokenPayload = match ring.open("CPA1", &st.token) {
        Ok(t) => t,
        Err(e) => return LicenseStatus::empty(S::Invalid, format!("The stored license is not valid: {e}"), mid),
    };
    let mut s = LicenseStatus::empty(S::Invalid, "", mid);
    s.license_id = Some(tok.lid.clone());
    s.customer = Some(tok.customer.clone());
    s.company = Some(tok.company.clone());
    s.product = Some(tok.product.clone());
    s.activated_at = Some(st.activated_at.clone());
    s.features = tok.features.clone();
    s.max_activations = Some(tok.max_act);
    s.key_id = Some(tok.kid.clone());
    s.machine_status = match tok.bind.mode.as_str() {
        "none" => "notBound",
        _ => "bound",
    }
    .into();

    if tok.product != PRODUCT_NAME {
        s.message = format!("This license is for \"{}\", not {PRODUCT_NAME}.", tok.product);
        return s;
    }
    // specific-machine licences carry the machine they were issued for
    if tok.bind.mode == "specific" && !machine.matches(tok.bind.fp.as_deref().unwrap_or(""), &tok.bind.parts) {
        s.state = S::WrongMachine;
        s.machine_status = "mismatch".into();
        s.message = "This license is bound to a different computer.".into();
        return s;
    }
    if tok.off == 1 {
        // Offline license: the signed code is the whole entitlement (dates + machine binding checked above).
        s.offline_license = true;
        let (Some(nbf), Some(act)) = (parse(&tok.nbf), parse(&st.activated_at)) else {
            s.message = "The stored license has unreadable dates.".into();
            return s;
        };
        let eff = now.max(parse(&st.last_seen).unwrap_or(act)).max(act);
        let exp: Option<DateTime<Utc>> = tok.exp.as_deref().and_then(parse);
        s.perpetual = tok.exp.is_none();
        s.expires_at = tok.exp.clone();
        s.days_remaining = exp.map(|e| ((e - eff).num_seconds() as f64 / 86400.0).ceil() as i64);
        if nbf > eff {
            s.state = S::NotYetValid;
            s.message = format!("This license is not valid until {}.", nbf.format("%Y-%m-%d"));
        } else if exp.map(|e| e <= eff).unwrap_or(false) {
            s.state = S::Expired;
            s.days_remaining = Some(0);
            s.message = "License expired. Please enter a valid activation code.".into();
        } else {
            s.state = S::Active;
            s.allowed = true;
            s.message = "Offline license is valid (no online validation required).".into();
        }
        return s;
    }
    let Some(rc_str) = st.receipt.as_deref() else {
        s.state = S::Unlicensed;
        s.message = "This installation has not been activated online yet. Please activate again.".into();
        return s;
    };
    let rc: ReceiptPayload = match ring.open::<ReceiptPayload>("CPR1", rc_str) {
        Ok(r) if r.lid == tok.lid => r,
        _ => {
            s.message = "The stored activation record is not valid. Please activate again.".into();
            return s;
        }
    };
    if !machine.matches(&rc.fp, &rc.parts) {
        s.state = S::WrongMachine;
        s.machine_status = "mismatch".into();
        s.message = "This license was activated on a different computer.".into();
        return s;
    }
    s.activations = Some(rc.activations);
    s.max_activations = Some(rc.max_act.max(tok.max_act));
    s.features = rc.features.clone();

    let (Some(validated), Some(nbf)) = (parse(&rc.validated_at), parse(&tok.nbf)) else {
        s.message = "The stored license has unreadable dates. Please activate again.".into();
        return s;
    };
    // Never trust a clock that runs behind what we have already observed.
    let last_seen = parse(&st.last_seen).unwrap_or(validated);
    let eff = now.max(last_seen).max(validated);
    s.last_validation = Some(rc.validated_at.clone());
    let exp: Option<DateTime<Utc>> = rc.exp.as_deref().and_then(parse);
    s.perpetual = rc.exp.is_none();
    s.expires_at = rc.exp.clone();
    s.days_remaining = exp.map(|e| ((e - eff).num_seconds() as f64 / 86400.0).ceil() as i64);
    let due = validated + Duration::days(rc.check_interval_days);
    let grace_end = due + Duration::days(rc.grace_days);
    s.next_validation_due = Some(iso(due));
    s.grace_ends_at = Some(iso(grace_end));

    if let Some(reason) = &st.lock {
        s.state = S::Deactivated;
        s.message = format!("The licensing service no longer authorises this computer ({reason}). Please activate again or contact support.");
        return s;
    }
    match rc.status.as_str() {
        "revoked" => {
            s.state = S::Revoked;
            s.message = "This license has been revoked. Please contact support.".into();
            return s;
        }
        "suspended" => {
            s.state = S::Suspended;
            s.message = "This license is suspended. Please contact support.".into();
            return s;
        }
        _ => {}
    }
    if nbf > eff {
        s.state = S::NotYetValid;
        s.message = format!("This license is not valid until {}.", nbf.format("%Y-%m-%d"));
        return s;
    }
    if rc.status == "expired" || exp.map(|e| e <= eff).unwrap_or(false) {
        s.state = S::Expired;
        s.days_remaining = Some(0);
        s.message = "License expired. Please enter a valid activation code.".into();
        return s;
    }
    if eff > grace_end {
        s.state = S::ValidationOverdue;
        s.message = format!(
            "The license has not been validated online for {} days (limit {} days). Connect to the internet and choose \"Check License\".",
            (eff - validated).num_days(),
            rc.check_interval_days + rc.grace_days
        );
        return s;
    }
    s.allowed = true;
    if eff > due {
        s.state = S::Warning;
        s.message = format!(
            "License validation is overdue. Connect to the internet before {} to keep using the application.",
            grace_end.format("%Y-%m-%d")
        );
    } else {
        s.state = S::Active;
        s.message = "License is valid.".into();
    }
    s
}
