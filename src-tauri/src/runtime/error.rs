use thiserror::Error;

#[derive(Debug, Error)]
pub enum RuntimeContractError {
    #[error("runtime I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("runtime control server failed: {0}")]
    ControlServer(String),
    #[error("runtime security setup failed: {0}")]
    Security(String),
    #[error("runtime database failed: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("invalid canonical command registry: {0}")]
    InvalidRegistry(#[from] serde_json::Error),
    #[error("invalid runtime contract schema: {0}")]
    InvalidSchema(String),
    #[error("invalid canonical command registry: {0}")]
    InvalidRegistryContract(String),
    #[error("duplicate command in canonical registry: {0}")]
    DuplicateCommand(String),
    #[error("canonical command registry hash mismatch: declared {declared}, computed {computed}")]
    RegistryHashMismatch { declared: String, computed: String },
}
