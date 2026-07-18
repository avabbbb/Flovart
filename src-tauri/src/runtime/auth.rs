use subtle::ConstantTimeEq;

use super::RuntimeContractError;

pub(super) fn generate_token() -> Result<String, RuntimeContractError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| RuntimeContractError::Security(error.to_string()))?;
    Ok(hex::encode(bytes))
}

pub(super) fn is_authorized(header: Option<&str>, expected_token: &str) -> bool {
    header
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|token| bool::from(token.as_bytes().ct_eq(expected_token.as_bytes())))
}
