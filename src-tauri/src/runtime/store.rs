use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

use super::{
    events::{RuntimeEntityRef, RuntimeEvent, RuntimeEventPage},
    tasks::{RuntimeTask, RuntimeTaskPage, TaskLinks, TaskReceipt},
    RuntimeContractError, RuntimeError,
};

const MIGRATION_0001: &str = include_str!("migrations/0001_runtime_ledger.sql");

pub struct RuntimeStore {
    connection: Mutex<Connection>,
}

pub struct ClaimedTask {
    pub id: String,
    pub kind: String,
    pub args: Value,
    pub progress: Option<Value>,
}

impl RuntimeStore {
    pub fn in_memory() -> Result<Self, RuntimeContractError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    pub fn open(path: &Path) -> Result<Self, RuntimeContractError> {
        Self::from_connection(Connection::open(path)?)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, RuntimeContractError> {
        connection.busy_timeout(Duration::from_millis(250))?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS runtime_migrations (
               version INTEGER PRIMARY KEY,
               applied_at INTEGER NOT NULL
             );",
        )?;
        let applied = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM runtime_migrations WHERE version = 1)",
            [],
            |row| row.get::<_, bool>(0),
        )?;
        if !applied {
            let migration = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            migration.execute_batch(MIGRATION_0001)?;
            migration.execute(
                "INSERT INTO runtime_migrations(version, applied_at) VALUES(1, ?1)",
                [chrono::Utc::now().timestamp_millis()],
            )?;
            migration.commit()?;
        }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn submit_delay(
        &self,
        command_id: &str,
        actor_kind: &str,
        actor_instance_id: &str,
        idempotency_key: &str,
        payload_hash: &str,
        args: &Value,
    ) -> Result<TaskReceipt, RuntimeError> {
        self.submit_task(
            command_id,
            actor_kind,
            actor_instance_id,
            idempotency_key,
            payload_hash,
            "runtime.test.delay",
            args,
            100,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn submit_video(
        &self,
        command_id: &str,
        actor_kind: &str,
        actor_instance_id: &str,
        idempotency_key: &str,
        payload_hash: &str,
        args: &Value,
    ) -> Result<TaskReceipt, RuntimeError> {
        self.submit_task(
            command_id,
            actor_kind,
            actor_instance_id,
            idempotency_key,
            payload_hash,
            "generate.video",
            args,
            2_000,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn submit_task(
        &self,
        command_id: &str,
        actor_kind: &str,
        actor_instance_id: &str,
        idempotency_key: &str,
        payload_hash: &str,
        command_name: &str,
        args: &Value,
        poll_interval_ms: u64,
    ) -> Result<TaskReceipt, RuntimeError> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_unavailable)?;

        let existing = transaction
            .query_row(
                "SELECT payload_hash, receipt_json
                   FROM command_receipts
                  WHERE actor_kind = ?1
                    AND actor_instance_id = ?2
                    AND idempotency_key = ?3",
                params![actor_kind, actor_instance_id, idempotency_key],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(store_unavailable)?;
        if let Some((existing_hash, receipt_json)) = existing {
            if existing_hash != payload_hash {
                return Err(RuntimeError {
                    code: "IDEMPOTENCY_CONFLICT".to_owned(),
                    message: "Idempotency key was already used with a different payload."
                        .to_owned(),
                    retryable: false,
                    details: Some(json!({
                        "existingPayloadHash": existing_hash,
                        "receivedPayloadHash": payload_hash,
                    })),
                    action_url: None,
                });
            }
            return serde_json::from_str(&receipt_json).map_err(store_unavailable);
        }

        let task_id = super::ProductionRuntime::new_id("task");
        let now = chrono::Utc::now().timestamp_millis();
        transaction
            .execute(
                "INSERT INTO runtime_tasks(
                    id, command_id, kind, status, args_json, created_at, updated_at
                 ) VALUES(?1, ?2, ?3, 'queued', ?4, ?5, ?5)",
                params![task_id, command_id, command_name, args.to_string(), now],
            )
            .map_err(store_unavailable)?;
        transaction
            .execute(
                "INSERT INTO runtime_events(
                    event_version, task_id, event_type, payload_json, created_at
                 ) VALUES('1', ?1, 'task.queued', ?2, ?3)",
                params![task_id, json!({ "status": "queued" }).to_string(), now],
            )
            .map_err(store_unavailable)?;
        let event_id = transaction.last_insert_rowid();
        let receipt = TaskReceipt {
            kind: "task".to_owned(),
            command_id: command_id.to_owned(),
            task_id: task_id.clone(),
            status: "queued".to_owned(),
            poll_interval_ms,
            event_id,
            links: TaskLinks {
                task: format!("/v1/tasks/{task_id}"),
                events: format!("/v1/events?taskId={task_id}"),
            },
        };
        transaction
            .execute(
                "INSERT INTO command_receipts(
                    command_id, actor_kind, actor_instance_id, idempotency_key,
                    command_name, payload_hash, task_id, receipt_json, created_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    command_id,
                    actor_kind,
                    actor_instance_id,
                    idempotency_key,
                    command_name,
                    payload_hash,
                    task_id,
                    serde_json::to_string(&receipt).map_err(store_unavailable)?,
                    now
                ],
            )
            .map_err(store_unavailable)?;
        transaction.commit().map_err(store_unavailable)?;
        Ok(receipt)
    }

    pub fn list_provider_credentials(
        &self,
        provider: Option<&str>,
    ) -> Result<Vec<Value>, RuntimeError> {
        let connection = self.connection.lock();
        let has_kv = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kv')",
                [],
                |row| row.get::<_, bool>(0),
            )
            .map_err(store_unavailable)?;
        if !has_kv {
            return Ok(Vec::new());
        }
        let prefix = provider
            .map(|provider| format!("keyring:meta:{provider}:"))
            .unwrap_or_else(|| "keyring:meta:".to_owned());
        let mut statement = connection
            .prepare(
                "SELECT key, value
                   FROM kv
                  WHERE key LIKE ?1
                  ORDER BY updated_at DESC",
            )
            .map_err(store_unavailable)?;
        let rows = statement
            .query_map([format!("{prefix}%")], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(store_unavailable)?;
        let mut credentials = Vec::new();
        for row in rows {
            let (key, value) = row.map_err(store_unavailable)?;
            let Some(account) = key.strip_prefix("keyring:meta:") else {
                continue;
            };
            let Some((provider, credential_id)) = account.split_once(':') else {
                continue;
            };
            let metadata = serde_json::from_str::<Value>(&value).unwrap_or(Value::Null);
            credentials.push(json!({
                "provider": provider,
                "credentialId": credential_id,
                "label": metadata.get("label").and_then(Value::as_str),
                "updatedAt": metadata.get("updated_at").and_then(Value::as_i64).unwrap_or_default(),
                "available": true
            }));
        }
        Ok(credentials)
    }

    pub fn default_credential_id(&self, provider: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self
            .list_provider_credentials(Some(provider))?
            .into_iter()
            .find_map(|credential| {
                credential
                    .get("credentialId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }))
    }

    pub fn get_task(&self, task_id: &str) -> Result<RuntimeTask, RuntimeError> {
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT id, command_id, kind, status, progress_json, lease_owner,
                        lease_expires_at, cancel_requested_at, result_json, error_json,
                        created_at, updated_at
                   FROM runtime_tasks
                  WHERE id = ?1",
                [task_id],
                task_from_row,
            )
            .optional()
            .map_err(store_unavailable)?
            .ok_or_else(|| {
                RuntimeError::new("TASK_NOT_FOUND", format!("Task not found: {task_id}"))
            })
    }

    pub fn list_tasks(
        &self,
        status: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<RuntimeTaskPage, RuntimeError> {
        let connection = self.connection.lock();
        if let Some(cursor) = cursor {
            let exists = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM runtime_tasks WHERE id = ?1)",
                    [cursor],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(store_unavailable)?;
            if !exists {
                return Err(RuntimeError::new(
                    "INVALID_ARGUMENT",
                    "task.list cursor is invalid",
                ));
            }
        }
        let mut statement = connection
            .prepare(
                "SELECT id, command_id, kind, status, progress_json, lease_owner,
                        lease_expires_at, cancel_requested_at, result_json, error_json,
                        created_at, updated_at
                   FROM runtime_tasks
                  WHERE (?1 IS NULL OR status = ?1)
                    AND (
                      ?2 IS NULL
                      OR created_at < (SELECT created_at FROM runtime_tasks WHERE id = ?2)
                      OR (
                        created_at = (SELECT created_at FROM runtime_tasks WHERE id = ?2)
                        AND id < ?2
                      )
                    )
                  ORDER BY created_at DESC, id DESC
                  LIMIT ?3",
            )
            .map_err(store_unavailable)?;
        let rows = statement
            .query_map(params![status, cursor, limit + 1], task_from_row)
            .map_err(store_unavailable)?;
        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row.map_err(store_unavailable)?);
        }
        let has_more = tasks.len() > limit as usize;
        tasks.truncate(limit as usize);
        let next_cursor = has_more
            .then(|| tasks.last().map(|task| task.id.clone()))
            .flatten();
        Ok(RuntimeTaskPage { tasks, next_cursor })
    }

    pub fn claim_next_task(
        &self,
        worker_id: &str,
        lease_ms: i64,
    ) -> Result<Option<ClaimedTask>, RuntimeError> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_unavailable)?;
        let now = chrono::Utc::now().timestamp_millis();
        let candidate = transaction
            .query_row(
                "SELECT id, kind, args_json, progress_json
                   FROM runtime_tasks
                  WHERE status = 'queued'
                     OR (status = 'working' AND lease_expires_at <= ?1)
                  ORDER BY created_at, id
                  LIMIT 1",
                [now],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(store_unavailable)?;
        let Some((task_id, kind, args_json, progress_json)) = candidate else {
            transaction.commit().map_err(store_unavailable)?;
            return Ok(None);
        };
        let lease_expires_at = now + lease_ms;
        let claimed = transaction
            .execute(
                "UPDATE runtime_tasks
                    SET status = 'working',
                        lease_owner = ?2,
                        lease_expires_at = ?3,
                        updated_at = ?1
                  WHERE id = ?4
                    AND (
                      status = 'queued'
                      OR (status = 'working' AND lease_expires_at <= ?1)
                    )",
                params![now, worker_id, lease_expires_at, task_id],
            )
            .map_err(store_unavailable)?;
        if claimed == 0 {
            transaction.commit().map_err(store_unavailable)?;
            return Ok(None);
        }
        transaction
            .execute(
                "INSERT INTO runtime_events(
                    event_version, task_id, event_type, payload_json, created_at
                 ) VALUES('1', ?1, 'task.working', ?2, ?3)",
                params![task_id, json!({ "status": "working" }).to_string(), now],
            )
            .map_err(store_unavailable)?;
        transaction.commit().map_err(store_unavailable)?;
        Ok(Some(ClaimedTask {
            id: task_id,
            kind,
            args: serde_json::from_str(&args_json).map_err(store_unavailable)?,
            progress: progress_json.and_then(|value| serde_json::from_str(&value).ok()),
        }))
    }

    pub fn update_progress(
        &self,
        task_id: &str,
        worker_id: &str,
        progress: &Value,
    ) -> Result<bool, RuntimeError> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_unavailable)?;
        let now = chrono::Utc::now().timestamp_millis();
        let updated = transaction
            .execute(
                "UPDATE runtime_tasks
                    SET progress_json = ?1, updated_at = ?2
                  WHERE id = ?3 AND status = 'working' AND lease_owner = ?4",
                params![progress.to_string(), now, task_id, worker_id],
            )
            .map_err(store_unavailable)?;
        if updated == 1 {
            transaction
                .execute(
                    "INSERT INTO runtime_events(
                        event_version, task_id, event_type, payload_json, created_at
                     ) VALUES('1', ?1, 'task.progress', ?2, ?3)",
                    params![task_id, progress.to_string(), now],
                )
                .map_err(store_unavailable)?;
        }
        transaction.commit().map_err(store_unavailable)?;
        Ok(updated == 1)
    }

    pub fn fail_task(
        &self,
        task_id: &str,
        worker_id: &str,
        error: &Value,
    ) -> Result<bool, RuntimeError> {
        self.finish_with_error(task_id, worker_id, "failed", "task.failed", error)
    }

    pub fn require_input(
        &self,
        task_id: &str,
        worker_id: &str,
        error: &Value,
    ) -> Result<bool, RuntimeError> {
        self.finish_with_error(
            task_id,
            worker_id,
            "input_required",
            "task.input_required",
            error,
        )
    }

    fn finish_with_error(
        &self,
        task_id: &str,
        worker_id: &str,
        status: &str,
        event_type: &str,
        error: &Value,
    ) -> Result<bool, RuntimeError> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_unavailable)?;
        let now = chrono::Utc::now().timestamp_millis();
        let updated = transaction
            .execute(
                "UPDATE runtime_tasks
                    SET status = ?1,
                        error_json = ?2,
                        lease_owner = NULL,
                        lease_expires_at = NULL,
                        updated_at = ?3
                  WHERE id = ?4 AND status = 'working' AND lease_owner = ?5",
                params![status, error.to_string(), now, task_id, worker_id],
            )
            .map_err(store_unavailable)?;
        if updated == 1 {
            transaction
                .execute(
                    "INSERT INTO runtime_events(
                        event_version, task_id, event_type, payload_json, created_at
                     ) VALUES('1', ?1, ?2, ?3, ?4)",
                    params![
                        task_id,
                        event_type,
                        json!({
                            "status": status,
                            "code": error.get("code").and_then(Value::as_str)
                        })
                        .to_string(),
                        now
                    ],
                )
                .map_err(store_unavailable)?;
        }
        transaction.commit().map_err(store_unavailable)?;
        Ok(updated == 1)
    }

    pub fn renew_lease(
        &self,
        task_id: &str,
        worker_id: &str,
        lease_ms: i64,
    ) -> Result<bool, RuntimeError> {
        let now = chrono::Utc::now().timestamp_millis();
        let connection = self.connection.lock();
        connection
            .execute(
                "UPDATE runtime_tasks
                    SET lease_expires_at = ?1, updated_at = ?2
                  WHERE id = ?3 AND status = 'working' AND lease_owner = ?4",
                params![now + lease_ms, now, task_id, worker_id],
            )
            .map(|updated| updated == 1)
            .map_err(store_unavailable)
    }

    pub fn complete_task(
        &self,
        task_id: &str,
        worker_id: &str,
        result: &Value,
    ) -> Result<bool, RuntimeError> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_unavailable)?;
        let now = chrono::Utc::now().timestamp_millis();
        let completed = transaction
            .execute(
                "UPDATE runtime_tasks
                    SET status = 'completed',
                        result_json = ?1,
                        lease_owner = NULL,
                        lease_expires_at = NULL,
                        updated_at = ?2
                  WHERE id = ?3 AND status = 'working' AND lease_owner = ?4",
                params![result.to_string(), now, task_id, worker_id],
            )
            .map_err(store_unavailable)?;
        if completed == 1 {
            transaction
                .execute(
                    "INSERT INTO runtime_events(
                        event_version, task_id, event_type, payload_json, created_at
                     ) VALUES('1', ?1, 'task.completed', ?2, ?3)",
                    params![task_id, json!({ "status": "completed" }).to_string(), now],
                )
                .map_err(store_unavailable)?;
        }
        transaction.commit().map_err(store_unavailable)?;
        Ok(completed == 1)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn request_cancel(
        &self,
        command_id: &str,
        actor_kind: &str,
        actor_instance_id: &str,
        idempotency_key: &str,
        payload_hash: &str,
        task_id: &str,
        reason: Option<&str>,
    ) -> Result<RuntimeTask, RuntimeError> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_unavailable)?;
        let existing = transaction
            .query_row(
                "SELECT payload_hash, receipt_json
                   FROM command_receipts
                  WHERE actor_kind = ?1
                    AND actor_instance_id = ?2
                    AND idempotency_key = ?3",
                params![actor_kind, actor_instance_id, idempotency_key],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(store_unavailable)?;
        if let Some((existing_hash, receipt_json)) = existing {
            if existing_hash != payload_hash {
                return Err(idempotency_conflict(&existing_hash, payload_hash));
            }
            return serde_json::from_str(&receipt_json).map_err(store_unavailable);
        }

        let now = chrono::Utc::now().timestamp_millis();
        let updated = transaction
            .execute(
                "UPDATE runtime_tasks
                    SET cancel_requested_at = COALESCE(cancel_requested_at, ?1),
                        updated_at = ?1
                  WHERE id = ?2
                    AND status IN ('queued', 'working', 'input_required')",
                params![now, task_id],
            )
            .map_err(store_unavailable)?;
        let task = transaction
            .query_row(
                "SELECT id, command_id, kind, status, progress_json, lease_owner,
                        lease_expires_at, cancel_requested_at, result_json, error_json,
                        created_at, updated_at
                   FROM runtime_tasks
                  WHERE id = ?1",
                [task_id],
                task_from_row,
            )
            .optional()
            .map_err(store_unavailable)?
            .ok_or_else(|| {
                RuntimeError::new("TASK_NOT_FOUND", format!("Task not found: {task_id}"))
            })?;
        if updated == 1 {
            transaction
                .execute(
                    "INSERT INTO runtime_events(
                        event_version, task_id, event_type, payload_json, created_at
                     ) VALUES('1', ?1, 'task.cancel_requested', ?2, ?3)",
                    params![
                        task_id,
                        json!({
                            "status": task.status,
                            "reasonCode": reason.map(|_| "REQUESTED")
                        })
                        .to_string(),
                        now
                    ],
                )
                .map_err(store_unavailable)?;
        }
        transaction
            .execute(
                "INSERT INTO command_receipts(
                    command_id, actor_kind, actor_instance_id, idempotency_key,
                    command_name, payload_hash, task_id, receipt_json, created_at
                 ) VALUES(?1, ?2, ?3, ?4, 'task.cancel', ?5, ?6, ?7, ?8)",
                params![
                    command_id,
                    actor_kind,
                    actor_instance_id,
                    idempotency_key,
                    payload_hash,
                    task_id,
                    serde_json::to_string(&task).map_err(store_unavailable)?,
                    now
                ],
            )
            .map_err(store_unavailable)?;
        transaction.commit().map_err(store_unavailable)?;
        Ok(task)
    }

    pub fn cancellation_requested(
        &self,
        task_id: &str,
        worker_id: &str,
    ) -> Result<bool, RuntimeError> {
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT cancel_requested_at IS NOT NULL
                   FROM runtime_tasks
                  WHERE id = ?1 AND status = 'working' AND lease_owner = ?2",
                params![task_id, worker_id],
                |row| row.get(0),
            )
            .optional()
            .map(|value| value.unwrap_or(false))
            .map_err(store_unavailable)
    }

    pub fn cancel_task(&self, task_id: &str, worker_id: &str) -> Result<bool, RuntimeError> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_unavailable)?;
        let now = chrono::Utc::now().timestamp_millis();
        let cancelled = transaction
            .execute(
                "UPDATE runtime_tasks
                    SET status = 'cancelled',
                        lease_owner = NULL,
                        lease_expires_at = NULL,
                        updated_at = ?1
                  WHERE id = ?2
                    AND status = 'working'
                    AND lease_owner = ?3
                    AND cancel_requested_at IS NOT NULL",
                params![now, task_id, worker_id],
            )
            .map_err(store_unavailable)?;
        if cancelled == 1 {
            transaction
                .execute(
                    "INSERT INTO runtime_events(
                        event_version, task_id, event_type, payload_json, created_at
                     ) VALUES('1', ?1, 'task.cancelled', ?2, ?3)",
                    params![task_id, json!({ "status": "cancelled" }).to_string(), now],
                )
                .map_err(store_unavailable)?;
        }
        transaction.commit().map_err(store_unavailable)?;
        Ok(cancelled == 1)
    }

    pub fn list_events(
        &self,
        after_event_id: i64,
        task_id: Option<&str>,
        limit: u32,
    ) -> Result<RuntimeEventPage, RuntimeError> {
        let connection = self.connection.lock();
        let mut events = Vec::new();
        if let Some(task_id) = task_id {
            let mut statement = connection
                .prepare(
                    "SELECT event_id, event_version, event_type, entity_type, entity_id,
                            task_id, created_at, payload_json
                       FROM runtime_events
                      WHERE event_id > ?1 AND task_id = ?2
                      ORDER BY event_id
                      LIMIT ?3",
                )
                .map_err(store_unavailable)?;
            let rows = statement
                .query_map(params![after_event_id, task_id, limit], event_from_row)
                .map_err(store_unavailable)?;
            for row in rows {
                events.push(row.map_err(store_unavailable)?);
            }
        } else {
            let mut statement = connection
                .prepare(
                    "SELECT event_id, event_version, event_type, entity_type, entity_id,
                            task_id, created_at, payload_json
                       FROM runtime_events
                      WHERE event_id > ?1
                      ORDER BY event_id
                      LIMIT ?2",
                )
                .map_err(store_unavailable)?;
            let rows = statement
                .query_map(params![after_event_id, limit], event_from_row)
                .map_err(store_unavailable)?;
            for row in rows {
                events.push(row.map_err(store_unavailable)?);
            }
        }
        let next_event_id = events
            .last()
            .map(|event| event.event_id)
            .unwrap_or(after_event_id);
        Ok(RuntimeEventPage {
            events,
            next_event_id,
        })
    }
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuntimeTask> {
    Ok(RuntimeTask {
        id: row.get(0)?,
        command_id: row.get(1)?,
        kind: row.get(2)?,
        status: row.get(3)?,
        progress: parse_optional_json(row.get(4)?),
        lease_owner: row.get(5)?,
        lease_expires_at: row.get(6)?,
        cancel_requested_at: row.get(7)?,
        result: parse_optional_json(row.get(8)?),
        error: parse_optional_json(row.get(9)?),
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn parse_optional_json(value: Option<String>) -> Option<Value> {
    value.and_then(|value| serde_json::from_str(&value).ok())
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuntimeEvent> {
    let entity_type: Option<String> = row.get(3)?;
    let entity_id: Option<String> = row.get(4)?;
    let payload: String = row.get(7)?;
    Ok(RuntimeEvent {
        event_id: row.get(0)?,
        event_version: row.get(1)?,
        event_type: row.get(2)?,
        entity: entity_type
            .zip(entity_id)
            .map(|(kind, id)| RuntimeEntityRef { kind, id }),
        task_id: row.get(5)?,
        occurred_at: row.get(6)?,
        data: serde_json::from_str(&payload).unwrap_or(Value::Null),
    })
}

fn store_unavailable(error: impl std::fmt::Display) -> RuntimeError {
    RuntimeError {
        code: "RUNTIME_UNAVAILABLE".to_owned(),
        message: format!("Runtime ledger unavailable: {error}"),
        retryable: true,
        details: None,
        action_url: None,
    }
}

fn idempotency_conflict(existing_hash: &str, received_hash: &str) -> RuntimeError {
    RuntimeError {
        code: "IDEMPOTENCY_CONFLICT".to_owned(),
        message: "Idempotency key was already used with a different payload.".to_owned(),
        retryable: false,
        details: Some(json!({
            "existingPayloadHash": existing_hash,
            "receivedPayloadHash": received_hash,
        })),
        action_url: None,
    }
}
