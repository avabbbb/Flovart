//! 统一错误类型，自动序列化成 Tauri command 错误返回。

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum FlovartError {
    #[error("keyring error: {0}")]
    Keyring(String),
    #[error("sqlite error: {0}")]
    Sqlite(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("http server error: {0}")]
    Http(String),
    #[error("{0}")]
    Other(String),
}

impl FlovartError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Keyring(_) => "KEYRING",
            Self::Sqlite(_) => "SQLITE",
            Self::Io(_) => "IO",
            Self::NotFound(_) => "NOT_FOUND",
            Self::InvalidInput(_) => "BAD_REQUEST",
            Self::Http(_) => "HTTP",
            Self::Other(_) => "INTERNAL",
        }
    }
}

impl Serialize for FlovartError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("FlovartError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

impl From<keyring::Error> for FlovartError {
    fn from(e: keyring::Error) -> Self {
        FlovartError::Keyring(e.to_string())
    }
}

impl From<rusqlite::Error> for FlovartError {
    fn from(e: rusqlite::Error) -> Self {
        FlovartError::Sqlite(e.to_string())
    }
}

impl From<std::io::Error> for FlovartError {
    fn from(e: std::io::Error) -> Self {
        FlovartError::Io(e.to_string())
    }
}

pub type FlovartResult<T> = Result<T, FlovartError>;
