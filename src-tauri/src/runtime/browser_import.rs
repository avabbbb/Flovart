use chrono::Utc;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

use super::{RuntimeContractError, RuntimeError};

const PROTOCOL_VERSION: &str = "1";
const IMAGE_CAPABILITY: &str = "browser.import.image";
const MAX_IMPORT_BYTES: u64 = 64 * 1024 * 1024;
pub const BROWSER_IMPORT_CHUNK_BYTES: usize = 256 * 1024;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS browser_extension_pairings (
  extension_origin TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  protocol_version TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_import_destination (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  active_project_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_import_transfers (
  id TEXT PRIMARY KEY,
  extension_origin TEXT NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  expected_bytes INTEGER NOT NULL,
  expected_sha256 TEXT NOT NULL,
  received_bytes INTEGER NOT NULL DEFAULT 0,
  next_sequence INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  source_page_url TEXT,
  source_title TEXT,
  natural_width INTEGER,
  natural_height INTEGER,
  staging_relpath TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('receiving', 'committed', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(extension_origin, request_id)
);

CREATE TABLE IF NOT EXISTS browser_imports (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL UNIQUE,
  extension_origin TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  source_url TEXT,
  source_page_url TEXT,
  source_title TEXT,
  natural_width INTEGER,
  natural_height INTEGER,
  artifact_relpath TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'consumed')),
  destination_project_id TEXT,
  node_id TEXT,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_browser_imports_status_created
  ON browser_imports(status, created_at);
"#;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserImportBegin {
    pub request_id: String,
    pub kind: String,
    pub name: String,
    pub mime_type: String,
    pub byte_size: u64,
    pub sha256: String,
    pub source_url: Option<String>,
    pub source_page_url: Option<String>,
    pub source_title: Option<String>,
    pub natural_width: Option<u32>,
    pub natural_height: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserImportPairing {
    pub extension_origin: String,
    pub status: String,
    pub protocol_version: String,
    pub capabilities: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserImportTransfer {
    pub transfer_id: String,
    pub chunk_bytes: usize,
    pub received_bytes: u64,
    pub next_sequence: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserImportChunkAck {
    pub transfer_id: String,
    pub received_bytes: u64,
    pub next_sequence: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserImportReceipt {
    pub import_id: String,
    pub artifact_id: String,
    pub content_hash: String,
    pub kind: String,
    pub name: String,
    pub mime_type: String,
    pub byte_size: u64,
    pub source_url: Option<String>,
    pub source_page_url: Option<String>,
    pub source_title: Option<String>,
    pub natural_width: Option<u32>,
    pub natural_height: Option<u32>,
    pub status: String,
    pub destination_project_id: Option<String>,
    pub node_id: Option<String>,
    pub created_at: i64,
    pub consumed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserImportArtifactPayload {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

pub struct BrowserImportStore {
    connection: Mutex<Connection>,
    artifact_root: PathBuf,
    ephemeral_root: Option<PathBuf>,
}

impl BrowserImportStore {
    pub fn in_memory() -> Result<Self, RuntimeContractError> {
        let artifact_root =
            std::env::temp_dir().join(format!("flovart-browser-import-runtime-{}", Uuid::now_v7()));
        fs::create_dir_all(artifact_root.join("browser-import").join(".staging"))?;
        let connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        connection.execute_batch(SCHEMA)?;
        Ok(Self {
            connection: Mutex::new(connection),
            artifact_root: artifact_root.clone(),
            ephemeral_root: Some(artifact_root),
        })
    }

    pub fn open(database_path: &Path, artifact_root: &Path) -> Result<Self, RuntimeContractError> {
        fs::create_dir_all(artifact_root.join("browser-import").join(".staging"))?;
        let connection = Connection::open(database_path)?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        connection.execute_batch(SCHEMA)?;
        Ok(Self {
            connection: Mutex::new(connection),
            artifact_root: artifact_root.to_path_buf(),
            ephemeral_root: None,
        })
    }

    pub fn request_pairing(
        &self,
        extension_origin: &str,
        protocol_version: &str,
        capabilities: &[String],
    ) -> Result<BrowserImportPairing, RuntimeError> {
        validate_extension_origin(extension_origin)?;
        if protocol_version != PROTOCOL_VERSION {
            return Err(RuntimeError::new(
                "PROTOCOL_MISMATCH",
                format!("Browser bridge protocol {protocol_version} is not supported"),
            ));
        }
        let mut capabilities = capabilities.to_vec();
        capabilities.sort();
        capabilities.dedup();
        if capabilities != [IMAGE_CAPABILITY.to_owned()] {
            return Err(RuntimeError::new(
                "PERMISSION_DENIED",
                "Browser bridge requested unsupported capabilities",
            ));
        }
        let now = Utc::now().timestamp_millis();
        let capabilities_json = serde_json::to_string(&capabilities)
            .map_err(|error| RuntimeError::new("INVALID_ARGUMENT", error.to_string()))?;
        let connection = self.connection.lock();
        connection
            .execute(
                "INSERT INTO browser_extension_pairings(
                    extension_origin, status, protocol_version, capabilities_json, created_at, updated_at
                 ) VALUES(?1, 'pending', ?2, ?3, ?4, ?4)
                 ON CONFLICT(extension_origin) DO UPDATE SET
                    protocol_version = excluded.protocol_version,
                    capabilities_json = excluded.capabilities_json,
                    updated_at = excluded.updated_at",
                params![extension_origin, protocol_version, capabilities_json, now],
            )
            .map_err(database_error)?;
        pairing_by_origin(&connection, extension_origin)
    }

    pub fn pairing_status(
        &self,
        extension_origin: &str,
    ) -> Result<Option<BrowserImportPairing>, RuntimeError> {
        validate_extension_origin(extension_origin)?;
        let connection = self.connection.lock();
        pairing_by_origin_optional(&connection, extension_origin)
    }

    pub fn list_pending_pairings(&self) -> Result<Vec<BrowserImportPairing>, RuntimeError> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT extension_origin, status, protocol_version, capabilities_json, created_at, updated_at
                 FROM browser_extension_pairings WHERE status = 'pending' ORDER BY created_at",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map([], pairing_from_row)
            .map_err(database_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(database_error)
    }

    pub fn approve_pairing(&self, extension_origin: &str) -> Result<(), RuntimeError> {
        self.set_pairing_status(extension_origin, "approved")
    }

    pub fn reject_pairing(&self, extension_origin: &str) -> Result<(), RuntimeError> {
        self.set_pairing_status(extension_origin, "rejected")
    }

    fn set_pairing_status(&self, extension_origin: &str, status: &str) -> Result<(), RuntimeError> {
        validate_extension_origin(extension_origin)?;
        let connection = self.connection.lock();
        let changed = connection
            .execute(
                "UPDATE browser_extension_pairings SET status = ?2, updated_at = ?3
                 WHERE extension_origin = ?1",
                params![extension_origin, status, Utc::now().timestamp_millis()],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(RuntimeError::new(
                "NOT_FOUND",
                "Browser pairing was not found",
            ));
        }
        Ok(())
    }

    pub fn set_active_project(&self, project_id: Option<&str>) -> Result<(), RuntimeError> {
        let project_id = project_id.map(str::trim).filter(|value| !value.is_empty());
        let connection = self.connection.lock();
        connection
            .execute(
                "INSERT INTO browser_import_destination(singleton, active_project_id, updated_at)
                 VALUES(1, ?1, ?2)
                 ON CONFLICT(singleton) DO UPDATE SET
                    active_project_id = excluded.active_project_id,
                    updated_at = excluded.updated_at",
                params![project_id, Utc::now().timestamp_millis()],
            )
            .map_err(database_error)?;
        Ok(())
    }

    pub fn begin_import(
        &self,
        extension_origin: &str,
        begin: BrowserImportBegin,
    ) -> Result<BrowserImportTransfer, RuntimeError> {
        self.require_approved_pairing(extension_origin)?;
        validate_begin(&begin)?;
        let connection = self.connection.lock();
        if let Some(existing) = connection
            .query_row(
                "SELECT id, received_bytes, next_sequence FROM browser_import_transfers
                 WHERE extension_origin = ?1 AND request_id = ?2",
                params![extension_origin, begin.request_id],
                |row| {
                    Ok(BrowserImportTransfer {
                        transfer_id: row.get(0)?,
                        chunk_bytes: BROWSER_IMPORT_CHUNK_BYTES,
                        received_bytes: row.get::<_, i64>(1)? as u64,
                        next_sequence: row.get::<_, i64>(2)? as u32,
                    })
                },
            )
            .optional()
            .map_err(database_error)?
        {
            return Ok(existing);
        }

        let transfer_id = format!("browser-transfer-{}", Uuid::now_v7());
        let staging_relpath = format!("browser-import/.staging/{transfer_id}.part");
        let staging_path = self.artifact_root.join(Path::new(&staging_relpath));
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&staging_path)
            .map_err(io_error)?;
        let now = Utc::now().timestamp_millis();
        if let Err(error) = connection.execute(
            "INSERT INTO browser_import_transfers(
                id, extension_origin, request_id, kind, name, mime_type,
                expected_bytes, expected_sha256, source_url, source_page_url, source_title,
                natural_width, natural_height, staging_relpath, status, created_at, updated_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'receiving', ?15, ?15)",
            params![
                transfer_id,
                extension_origin,
                begin.request_id,
                begin.kind,
                begin.name,
                begin.mime_type,
                begin.byte_size as i64,
                begin.sha256,
                begin.source_url,
                begin.source_page_url,
                begin.source_title,
                begin.natural_width.map(i64::from),
                begin.natural_height.map(i64::from),
                staging_relpath,
                now,
            ],
        ) {
            let _ = fs::remove_file(staging_path);
            return Err(database_error(error));
        }
        Ok(BrowserImportTransfer {
            transfer_id,
            chunk_bytes: BROWSER_IMPORT_CHUNK_BYTES,
            received_bytes: 0,
            next_sequence: 0,
        })
    }

    pub fn append_chunk(
        &self,
        extension_origin: &str,
        transfer_id: &str,
        sequence: u32,
        bytes: &[u8],
    ) -> Result<BrowserImportChunkAck, RuntimeError> {
        self.require_approved_pairing(extension_origin)?;
        if bytes.is_empty() || bytes.len() > BROWSER_IMPORT_CHUNK_BYTES {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                format!("Import chunks must contain 1 to {BROWSER_IMPORT_CHUNK_BYTES} bytes"),
            ));
        }
        let connection = self.connection.lock();
        let state = connection
            .query_row(
                "SELECT extension_origin, expected_bytes, received_bytes, next_sequence, staging_relpath, status
                 FROM browser_import_transfers WHERE id = ?1",
                params![transfer_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)? as u64,
                        row.get::<_, i64>(2)? as u64,
                        row.get::<_, i64>(3)? as u32,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()
            .map_err(database_error)?
            .ok_or_else(|| RuntimeError::new("NOT_FOUND", "Browser import transfer was not found"))?;
        if state.0 != extension_origin {
            return Err(RuntimeError::new(
                "PERMISSION_DENIED",
                "Transfer caller does not match",
            ));
        }
        if state.5 != "receiving" {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                "Transfer is not receiving bytes",
            ));
        }
        if sequence != state.3 {
            return Err(RuntimeError::new(
                "CHUNK_SEQUENCE_MISMATCH",
                format!("Expected chunk {}, received {sequence}", state.3),
            ));
        }
        let received_bytes = state.2 + bytes.len() as u64;
        if received_bytes > state.1 {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                "Import bytes exceed the declared byte size",
            ));
        }
        let staging_path = checked_join(&self.artifact_root, &state.4)?;
        let mut file = OpenOptions::new()
            .append(true)
            .open(staging_path)
            .map_err(io_error)?;
        file.write_all(bytes).map_err(io_error)?;
        let next_sequence = sequence + 1;
        connection
            .execute(
                "UPDATE browser_import_transfers
                 SET received_bytes = ?2, next_sequence = ?3, updated_at = ?4 WHERE id = ?1",
                params![
                    transfer_id,
                    received_bytes as i64,
                    next_sequence as i64,
                    Utc::now().timestamp_millis()
                ],
            )
            .map_err(database_error)?;
        Ok(BrowserImportChunkAck {
            transfer_id: transfer_id.to_owned(),
            received_bytes,
            next_sequence,
        })
    }

    pub fn commit_import(
        &self,
        extension_origin: &str,
        transfer_id: &str,
    ) -> Result<BrowserImportReceipt, RuntimeError> {
        self.require_approved_pairing(extension_origin)?;
        let connection = self.connection.lock();
        if let Some(receipt) = receipt_by_transfer_optional(&connection, transfer_id)? {
            if receipt_extension_origin(&connection, &receipt.import_id)? != extension_origin {
                return Err(RuntimeError::new(
                    "PERMISSION_DENIED",
                    "Transfer caller does not match",
                ));
            }
            return Ok(receipt);
        }
        let transfer = connection
            .query_row(
                "SELECT extension_origin, kind, name, mime_type, expected_bytes, expected_sha256,
                        received_bytes, source_url, source_page_url, source_title,
                        natural_width, natural_height, staging_relpath, status
                 FROM browser_import_transfers WHERE id = ?1",
                params![transfer_id],
                |row| {
                    Ok(TransferCommitState {
                        extension_origin: row.get(0)?,
                        kind: row.get(1)?,
                        name: row.get(2)?,
                        mime_type: row.get(3)?,
                        expected_bytes: row.get::<_, i64>(4)? as u64,
                        expected_sha256: row.get(5)?,
                        received_bytes: row.get::<_, i64>(6)? as u64,
                        source_url: row.get(7)?,
                        source_page_url: row.get(8)?,
                        source_title: row.get(9)?,
                        natural_width: row.get::<_, Option<i64>>(10)?.map(|value| value as u32),
                        natural_height: row.get::<_, Option<i64>>(11)?.map(|value| value as u32),
                        staging_relpath: row.get(12)?,
                        status: row.get(13)?,
                    })
                },
            )
            .optional()
            .map_err(database_error)?
            .ok_or_else(|| {
                RuntimeError::new("NOT_FOUND", "Browser import transfer was not found")
            })?;
        if transfer.extension_origin != extension_origin {
            return Err(RuntimeError::new(
                "PERMISSION_DENIED",
                "Transfer caller does not match",
            ));
        }
        if transfer.status != "receiving" {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                "Transfer cannot be committed",
            ));
        }
        if transfer.received_bytes != transfer.expected_bytes {
            return Err(RuntimeError::new(
                "BYTE_SIZE_MISMATCH",
                format!(
                    "Expected {} bytes, received {}",
                    transfer.expected_bytes, transfer.received_bytes
                ),
            ));
        }
        let staging_path = checked_join(&self.artifact_root, &transfer.staging_relpath)?;
        let actual_sha256 = hash_file(&staging_path)?;
        if actual_sha256 != transfer.expected_sha256 {
            fail_transfer(&connection, transfer_id, &staging_path)?;
            return Err(RuntimeError::new(
                "CONTENT_HASH_MISMATCH",
                "Imported bytes do not match the declared SHA-256",
            ));
        }
        if !image_signature_matches(&staging_path, &transfer.mime_type)? {
            fail_transfer(&connection, transfer_id, &staging_path)?;
            return Err(RuntimeError::new(
                "MIME_MISMATCH",
                "Imported bytes do not match the declared image MIME type",
            ));
        }

        let extension = extension_for_mime(&transfer.mime_type);
        let artifact_relpath = format!(
            "browser-import/sha256/{}/{}.{}",
            &actual_sha256[..2],
            actual_sha256,
            extension
        );
        let artifact_path = checked_join(&self.artifact_root, &artifact_relpath)?;
        let parent = artifact_path.parent().ok_or_else(|| {
            RuntimeError::new("RUNTIME_UNAVAILABLE", "Artifact path has no parent")
        })?;
        fs::create_dir_all(parent).map_err(io_error)?;
        if artifact_path.exists() {
            if hash_file(&artifact_path)? != actual_sha256 {
                return Err(RuntimeError::new(
                    "RUNTIME_UNAVAILABLE",
                    "Existing content-addressed artifact is corrupted",
                ));
            }
            fs::remove_file(&staging_path).map_err(io_error)?;
        } else {
            fs::rename(&staging_path, &artifact_path).map_err(io_error)?;
        }

        let destination_project_id: Option<String> = connection
            .query_row(
                "SELECT active_project_id FROM browser_import_destination WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(database_error)?
            .flatten();
        let import_id = format!("browser-import-{}", Uuid::now_v7());
        let artifact_id = format!("sha256:{actual_sha256}");
        let now = Utc::now().timestamp_millis();
        let transaction = connection.unchecked_transaction().map_err(database_error)?;
        transaction
            .execute(
                "INSERT INTO browser_imports(
                    id, transfer_id, extension_origin, artifact_id, content_hash, kind, name, mime_type,
                    byte_size, source_url, source_page_url, source_title, natural_width, natural_height,
                    artifact_relpath, status, destination_project_id, created_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'pending', ?16, ?17)",
                params![
                    import_id,
                    transfer_id,
                    extension_origin,
                    artifact_id,
                    actual_sha256,
                    transfer.kind,
                    transfer.name,
                    transfer.mime_type,
                    transfer.expected_bytes as i64,
                    transfer.source_url,
                    transfer.source_page_url,
                    transfer.source_title,
                    transfer.natural_width.map(i64::from),
                    transfer.natural_height.map(i64::from),
                    artifact_relpath,
                    destination_project_id,
                    now,
                ],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "UPDATE browser_import_transfers SET status = 'committed', updated_at = ?2 WHERE id = ?1",
                params![transfer_id, now],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        receipt_by_id(&connection, &import_id)
    }

    pub fn list_pending(&self) -> Result<Vec<BrowserImportReceipt>, RuntimeError> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(&format!(
                "{} WHERE status = 'pending' ORDER BY created_at",
                RECEIPT_SELECT
            ))
            .map_err(database_error)?;
        let rows = statement
            .query_map([], receipt_from_row)
            .map_err(database_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(database_error)
    }

    pub fn route_to_project(
        &self,
        import_id: &str,
        project_id: &str,
    ) -> Result<BrowserImportReceipt, RuntimeError> {
        if project_id.trim().is_empty() {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                "Workflow project ID is required",
            ));
        }
        let connection = self.connection.lock();
        let changed = connection
            .execute(
                "UPDATE browser_imports SET destination_project_id = ?2
                 WHERE id = ?1 AND status = 'pending'",
                params![import_id, project_id],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(RuntimeError::new(
                "NOT_FOUND",
                "Pending browser import was not found",
            ));
        }
        receipt_by_id(&connection, import_id)
    }

    pub fn mark_consumed(
        &self,
        import_id: &str,
        project_id: &str,
        node_id: &str,
    ) -> Result<BrowserImportReceipt, RuntimeError> {
        if project_id.trim().is_empty() || node_id.trim().is_empty() {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                "Workflow project and node IDs are required",
            ));
        }
        let connection = self.connection.lock();
        if let Some(existing) = receipt_by_id_optional(&connection, import_id)? {
            if existing.status == "consumed" {
                if existing.destination_project_id.as_deref() == Some(project_id)
                    && existing.node_id.as_deref() == Some(node_id)
                {
                    return Ok(existing);
                }
                return Err(RuntimeError::new(
                    "IDEMPOTENCY_CONFLICT",
                    "Browser import was consumed by a different Workflow node",
                ));
            }
        } else {
            return Err(RuntimeError::new(
                "NOT_FOUND",
                "Browser import was not found",
            ));
        }
        let now = Utc::now().timestamp_millis();
        connection
            .execute(
                "UPDATE browser_imports
                 SET status = 'consumed', destination_project_id = ?2, node_id = ?3, consumed_at = ?4
                 WHERE id = ?1 AND status = 'pending'",
                params![import_id, project_id, node_id, now],
            )
            .map_err(database_error)?;
        receipt_by_id(&connection, import_id)
    }

    pub fn read_artifact(&self, import_id: &str) -> Result<Vec<u8>, RuntimeError> {
        let connection = self.connection.lock();
        let relpath: String = connection
            .query_row(
                "SELECT artifact_relpath FROM browser_imports WHERE id = ?1",
                params![import_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or_else(|| RuntimeError::new("NOT_FOUND", "Browser import was not found"))?;
        drop(connection);
        let canonical_root = fs::canonicalize(&self.artifact_root).map_err(io_error)?;
        let path =
            fs::canonicalize(checked_join(&self.artifact_root, &relpath)?).map_err(io_error)?;
        if !path.starts_with(canonical_root) {
            return Err(RuntimeError::new(
                "RUNTIME_UNAVAILABLE",
                "Browser import artifact is outside the artifact root",
            ));
        }
        fs::read(path).map_err(io_error)
    }

    pub fn read_artifact_payload(
        &self,
        import_id: &str,
    ) -> Result<BrowserImportArtifactPayload, RuntimeError> {
        let connection = self.connection.lock();
        let mime_type: String = connection
            .query_row(
                "SELECT mime_type FROM browser_imports WHERE id = ?1",
                params![import_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or_else(|| RuntimeError::new("NOT_FOUND", "Browser import was not found"))?;
        drop(connection);
        Ok(BrowserImportArtifactPayload {
            mime_type,
            bytes: self.read_artifact(import_id)?,
        })
    }

    fn require_approved_pairing(&self, extension_origin: &str) -> Result<(), RuntimeError> {
        validate_extension_origin(extension_origin)?;
        let connection = self.connection.lock();
        let pairing = pairing_by_origin_optional(&connection, extension_origin)?;
        match pairing.as_ref().map(|pairing| pairing.status.as_str()) {
            Some("approved")
                if pairing.as_ref().is_some_and(|pairing| {
                    pairing.protocol_version == PROTOCOL_VERSION
                        && pairing.capabilities == [IMAGE_CAPABILITY.to_owned()]
                }) =>
            {
                Ok(())
            }
            Some("rejected") => Err(RuntimeError::new(
                "PAIRING_REJECTED",
                "Desktop rejected this browser extension pairing",
            )),
            _ => Err(RuntimeError::new(
                "PAIRING_REQUIRED",
                "Approve this browser extension in Flovart Desktop",
            )),
        }
    }
}

impl Drop for BrowserImportStore {
    fn drop(&mut self) {
        if let Some(root) = self.ephemeral_root.as_ref() {
            let _ = fs::remove_dir_all(root);
        }
    }
}

#[derive(Debug)]
struct TransferCommitState {
    extension_origin: String,
    kind: String,
    name: String,
    mime_type: String,
    expected_bytes: u64,
    expected_sha256: String,
    received_bytes: u64,
    source_url: Option<String>,
    source_page_url: Option<String>,
    source_title: Option<String>,
    natural_width: Option<u32>,
    natural_height: Option<u32>,
    staging_relpath: String,
    status: String,
}

const RECEIPT_SELECT: &str =
    "SELECT id, artifact_id, content_hash, kind, name, mime_type, byte_size,
            source_url, source_page_url, source_title, natural_width, natural_height,
            status, destination_project_id, node_id, created_at, consumed_at
     FROM browser_imports";

fn receipt_from_row(row: &Row<'_>) -> rusqlite::Result<BrowserImportReceipt> {
    Ok(BrowserImportReceipt {
        import_id: row.get(0)?,
        artifact_id: row.get(1)?,
        content_hash: row.get(2)?,
        kind: row.get(3)?,
        name: row.get(4)?,
        mime_type: row.get(5)?,
        byte_size: row.get::<_, i64>(6)? as u64,
        source_url: row.get(7)?,
        source_page_url: row.get(8)?,
        source_title: row.get(9)?,
        natural_width: row.get::<_, Option<i64>>(10)?.map(|value| value as u32),
        natural_height: row.get::<_, Option<i64>>(11)?.map(|value| value as u32),
        status: row.get(12)?,
        destination_project_id: row.get(13)?,
        node_id: row.get(14)?,
        created_at: row.get(15)?,
        consumed_at: row.get(16)?,
    })
}

fn receipt_by_id(
    connection: &Connection,
    import_id: &str,
) -> Result<BrowserImportReceipt, RuntimeError> {
    receipt_by_id_optional(connection, import_id)?
        .ok_or_else(|| RuntimeError::new("NOT_FOUND", "Browser import was not found"))
}

fn receipt_by_id_optional(
    connection: &Connection,
    import_id: &str,
) -> Result<Option<BrowserImportReceipt>, RuntimeError> {
    connection
        .query_row(
            &format!("{RECEIPT_SELECT} WHERE id = ?1"),
            params![import_id],
            receipt_from_row,
        )
        .optional()
        .map_err(database_error)
}

fn receipt_by_transfer_optional(
    connection: &Connection,
    transfer_id: &str,
) -> Result<Option<BrowserImportReceipt>, RuntimeError> {
    connection
        .query_row(
            &format!("{RECEIPT_SELECT} WHERE transfer_id = ?1"),
            params![transfer_id],
            receipt_from_row,
        )
        .optional()
        .map_err(database_error)
}

fn receipt_extension_origin(
    connection: &Connection,
    import_id: &str,
) -> Result<String, RuntimeError> {
    connection
        .query_row(
            "SELECT extension_origin FROM browser_imports WHERE id = ?1",
            params![import_id],
            |row| row.get(0),
        )
        .map_err(database_error)
}

fn pairing_from_row(row: &Row<'_>) -> rusqlite::Result<BrowserImportPairing> {
    let capabilities_json: String = row.get(3)?;
    let capabilities = serde_json::from_str(&capabilities_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            capabilities_json.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    Ok(BrowserImportPairing {
        extension_origin: row.get(0)?,
        status: row.get(1)?,
        protocol_version: row.get(2)?,
        capabilities,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn pairing_by_origin(
    connection: &Connection,
    extension_origin: &str,
) -> Result<BrowserImportPairing, RuntimeError> {
    pairing_by_origin_optional(connection, extension_origin)?
        .ok_or_else(|| RuntimeError::new("NOT_FOUND", "Browser pairing was not found"))
}

fn pairing_by_origin_optional(
    connection: &Connection,
    extension_origin: &str,
) -> Result<Option<BrowserImportPairing>, RuntimeError> {
    connection
        .query_row(
            "SELECT extension_origin, status, protocol_version, capabilities_json, created_at, updated_at
             FROM browser_extension_pairings WHERE extension_origin = ?1",
            params![extension_origin],
            pairing_from_row,
        )
        .optional()
        .map_err(database_error)
}

fn validate_extension_origin(origin: &str) -> Result<(), RuntimeError> {
    let id = origin
        .strip_prefix("chrome-extension://")
        .and_then(|value| value.strip_suffix('/'))
        .filter(|value| {
            value.len() == 32 && value.bytes().all(|byte| (b'a'..=b'p').contains(&byte))
        });
    if id.is_none() {
        return Err(RuntimeError::new(
            "PERMISSION_DENIED",
            "Native caller is not an exact Chromium extension origin",
        ));
    }
    Ok(())
}

fn validate_begin(begin: &BrowserImportBegin) -> Result<(), RuntimeError> {
    if begin.request_id.trim().is_empty() || begin.request_id.len() > 128 {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            "Import request ID is invalid",
        ));
    }
    if begin.kind != "image" {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            "Browser Import V1 accepts images only",
        ));
    }
    if begin.name.trim().is_empty() || begin.name.len() > 512 {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            "Import name is invalid",
        ));
    }
    if !matches!(
        begin.mime_type.as_str(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif"
    ) {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            "Browser Import V1 does not accept this image MIME type",
        ));
    }
    if begin.byte_size == 0 || begin.byte_size > MAX_IMPORT_BYTES {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            format!("Import byte size must be between 1 and {MAX_IMPORT_BYTES}"),
        ));
    }
    if begin.sha256.len() != 64
        || !begin
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            "Import SHA-256 is invalid",
        ));
    }
    if begin
        .natural_width
        .is_some_and(|value| value == 0 || value > 100_000)
        || begin
            .natural_height
            .is_some_and(|value| value == 0 || value > 100_000)
    {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            "Image dimensions are invalid",
        ));
    }
    for value in [
        begin.source_url.as_deref(),
        begin.source_page_url.as_deref(),
        begin.source_title.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if value.len() > 4096 {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                "Import provenance is too long",
            ));
        }
    }
    Ok(())
}

fn checked_join(root: &Path, relpath: &str) -> Result<PathBuf, RuntimeError> {
    let relative = Path::new(relpath);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(RuntimeError::new(
            "RUNTIME_UNAVAILABLE",
            "Artifact path is invalid",
        ));
    }
    Ok(root.join(relative))
}

fn hash_file(path: &Path) -> Result<String, RuntimeError> {
    let mut file = fs::File::open(path).map_err(io_error)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn image_signature_matches(path: &Path, mime_type: &str) -> Result<bool, RuntimeError> {
    let mut file = fs::File::open(path).map_err(io_error)?;
    let mut header = [0_u8; 32];
    let read = file.read(&mut header).map_err(io_error)?;
    let header = &header[..read];
    Ok(match mime_type {
        "image/png" => header.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => header.starts_with(b"\xff\xd8\xff"),
        "image/gif" => header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a"),
        "image/webp" => {
            header.starts_with(b"RIFF") && header.get(8..12) == Some(b"WEBP".as_slice())
        }
        "image/avif" => {
            header.get(4..8) == Some(b"ftyp".as_slice())
                && header
                    .get(8..12)
                    .is_some_and(|brand| brand == b"avif" || brand == b"avis")
        }
        _ => false,
    })
}

fn fail_transfer(
    connection: &Connection,
    transfer_id: &str,
    staging_path: &Path,
) -> Result<(), RuntimeError> {
    connection
        .execute(
            "UPDATE browser_import_transfers SET status = 'failed', updated_at = ?2 WHERE id = ?1",
            params![transfer_id, Utc::now().timestamp_millis()],
        )
        .map_err(database_error)?;
    let _ = fs::remove_file(staging_path);
    Ok(())
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/avif" => "avif",
        _ => "png",
    }
}

fn database_error(error: rusqlite::Error) -> RuntimeError {
    RuntimeError::new(
        "RUNTIME_UNAVAILABLE",
        format!("Browser import database failed: {error}"),
    )
}

fn io_error(error: std::io::Error) -> RuntimeError {
    RuntimeError::new(
        "RUNTIME_UNAVAILABLE",
        format!("Browser import storage failed: {error}"),
    )
}
