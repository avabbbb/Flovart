//! Agent 视频流水线 trace 的 Runtime 读取面（docs/design/16-agent-video-pipeline.md §4.2 / §12）。
//!
//! 表由 migration 5（`tools/flovart/contracts/runtime/migrations/0005_agent_pipeline.sql`）建立；
//! Node pipeline 边界（`tools/flovart/pipeline/`）是唯一写入方，命令边界自动记 Step。
//! Runtime 只读：`pipeline.run.get` 返回与 Node `Pipeline.trace()` 相同形状的 JSON，
//! 让桌面端 / 控制面在不加载 Node 的情况下也能显示同一条 trace。

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

use super::RuntimeError;

fn unavailable(error: rusqlite::Error) -> RuntimeError {
    RuntimeError::new(
        "RUNTIME_UNAVAILABLE",
        format!("Pipeline trace store failed: {error}"),
    )
}

fn parse_json(text: Option<String>, fallback: Value) -> Value {
    text.and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(fallback)
}

fn run_from_row(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>("id")?,
        "projectId": row.get::<_, String>("project_id")?,
        "title": row.get::<_, String>("title")?,
        "status": row.get::<_, String>("status")?,
        "brief": parse_json(row.get("brief_json")?, json!({})),
        "briefArtifactId": row.get::<_, Option<String>>("brief_artifact_id")?,
        "budget": parse_json(row.get("budget_json")?, json!({})),
        "reference": parse_json(row.get("reference_json")?, Value::Null),
        "blocker": parse_json(row.get("blocker_json")?, Value::Null),
        "headVersion": row.get::<_, i64>("head_version")?,
        "createdBy": row.get::<_, String>("created_by")?,
        "createdAt": row.get::<_, i64>("created_at")?,
        "updatedAt": row.get::<_, i64>("updated_at")?,
    }))
}

fn locked_clip_ids(spec: &Value) -> Vec<Value> {
    let mut ids = Vec::new();
    if let Some(tracks) = spec.get("tracks").and_then(Value::as_object) {
        for clips in tracks.values() {
            for clip in clips.as_array().into_iter().flatten() {
                if clip.get("locked").and_then(Value::as_bool) == Some(true) {
                    if let Some(id) = clip.get("id") {
                        ids.push(id.clone());
                    }
                }
            }
        }
    }
    ids
}

/// 读取一条 run 的 trace。`since` 只过滤 Step（seq > since），其余部分总是完整返回。
pub fn read_trace(connection: &Connection, run_id: &str, since: i64) -> Result<Value, RuntimeError> {
    let run = connection
        .query_row(
            "SELECT * FROM pipeline_runs WHERE id = ?1",
            [run_id],
            run_from_row,
        )
        .optional()
        .map_err(unavailable)?
        .ok_or_else(|| RuntimeError::new("RUN_NOT_FOUND", format!("Pipeline run not found: {run_id}")))?;

    let mut statement = connection
        .prepare(
            "SELECT id, seq, tool, caller, status, mutation_id, attempts, artifact_ids_json,
                    cost_micros, error_json, started_at, finished_at
               FROM run_steps WHERE run_id = ?1 AND seq > ?2 ORDER BY seq",
        )
        .map_err(unavailable)?;
    let steps: Vec<Value> = statement
        .query_map(params![run_id, since], |row| {
            let mut step = Map::new();
            step.insert("seq".into(), json!(row.get::<_, i64>(1)?));
            step.insert("stepId".into(), json!(row.get::<_, String>(0)?));
            step.insert("tool".into(), json!(row.get::<_, String>(2)?));
            step.insert("caller".into(), json!(row.get::<_, String>(3)?));
            step.insert("status".into(), json!(row.get::<_, String>(4)?));
            step.insert("mutationId".into(), json!(row.get::<_, Option<String>>(5)?));
            step.insert("attempts".into(), json!(row.get::<_, i64>(6)?));
            step.insert("artifactIds".into(), parse_json(row.get(7)?, json!([])));
            step.insert("costMicros".into(), json!(row.get::<_, i64>(8)?));
            let error = parse_json(row.get(9)?, Value::Null);
            if !error.is_null() {
                step.insert(
                    "error".into(),
                    json!({ "code": error.get("code"), "message": error.get("message") }),
                );
            }
            step.insert("startedAt".into(), json!(row.get::<_, i64>(10)?));
            step.insert("finishedAt".into(), json!(row.get::<_, Option<i64>>(11)?));
            Ok(Value::Object(step))
        })
        .map_err(unavailable)?
        .collect::<Result<_, _>>()
        .map_err(unavailable)?;

    let mut statement = connection
        .prepare(
            "SELECT r.id, r.version, r.preset, r.at_sec, r.engine, r.artifact_id, r.probe_json,
                    IFNULL(a.rejected, 0)
               FROM pipeline_renders r
               LEFT JOIN pipeline_artifacts a ON a.id = r.artifact_id
              WHERE r.run_id = ?1 ORDER BY r.created_at",
        )
        .map_err(unavailable)?;
    let renders: Vec<(i64, Value)> = statement
        .query_map([run_id], |row| {
            let probe = parse_json(row.get(6)?, Value::Null);
            Ok((
                row.get::<_, i64>(1)?,
                json!({
                    "renderId": row.get::<_, String>(0)?,
                    "preset": row.get::<_, String>(2)?,
                    "atSec": row.get::<_, Option<f64>>(3)?,
                    "engine": row.get::<_, String>(4)?,
                    "artifactId": row.get::<_, String>(5)?,
                    "rejected": row.get::<_, i64>(7)? != 0,
                    "issues": probe.get("issues").cloned().unwrap_or_else(|| json!([])),
                }),
            ))
        })
        .map_err(unavailable)?
        .collect::<Result<_, _>>()
        .map_err(unavailable)?;

    let mut statement = connection
        .prepare(
            "SELECT id, round, version, reviewer, caller, verdict, findings_json,
                    fixed_by_version, step_id, created_at
               FROM review_rounds WHERE run_id = ?1 ORDER BY round",
        )
        .map_err(unavailable)?;
    let rounds: Vec<Value> = statement
        .query_map([run_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "round": row.get::<_, i64>(1)?,
                "version": row.get::<_, i64>(2)?,
                "reviewer": row.get::<_, String>(3)?,
                "caller": row.get::<_, String>(4)?,
                "verdict": row.get::<_, String>(5)?,
                "findings": parse_json(row.get(6)?, json!([])),
                "fixedByVersion": row.get::<_, Option<i64>>(7)?,
                "stepId": row.get::<_, Option<String>>(8)?,
                "createdAt": row.get::<_, i64>(9)?,
            }))
        })
        .map_err(unavailable)?
        .collect::<Result<_, _>>()
        .map_err(unavailable)?;

    let mut statement = connection
        .prepare(
            "SELECT version, parent_version, spec_json, spec_sha256, diff_json, step_id
               FROM pipeline_spec_versions WHERE run_id = ?1 ORDER BY version",
        )
        .map_err(unavailable)?;
    let versions: Vec<Value> = statement
        .query_map([run_id], |row| {
            let version = row.get::<_, i64>(0)?;
            let spec = parse_json(row.get(2)?, json!({}));
            Ok(json!({
                "version": version,
                "parentVersion": row.get::<_, Option<i64>>(1)?,
                "specSha256": row.get::<_, String>(3)?,
                "durationMs": spec.pointer("/output/durationMs").cloned().unwrap_or(Value::Null),
                "locked": locked_clip_ids(&spec),
                "diff": parse_json(row.get(4)?, json!({})),
                "stepId": row.get::<_, Option<String>>(5)?,
            }))
        })
        .map_err(unavailable)?
        .collect::<Result<_, _>>()
        .map_err(unavailable)?;
    let versions: Vec<Value> = versions
        .into_iter()
        .map(|mut version| {
            let number = version["version"].as_i64().unwrap_or_default();
            version["renders"] = Value::Array(
                renders
                    .iter()
                    .filter(|(render_version, _)| *render_version == number)
                    .map(|(_, render)| render.clone())
                    .collect(),
            );
            version["reviews"] = Value::Array(
                rounds
                    .iter()
                    .filter(|round| round["version"].as_i64() == Some(number))
                    .map(|round| round["round"].clone())
                    .collect(),
            );
            version
        })
        .collect();

    let mut totals: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    let mut statement = connection
        .prepare(
            "SELECT entry_kind, IFNULL(SUM(amount_micros), 0), IFNULL(SUM(tasks), 0)
               FROM pipeline_usage_ledger WHERE run_id = ?1 GROUP BY entry_kind",
        )
        .map_err(unavailable)?;
    for entry in statement
        .query_map([run_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        })
        .map_err(unavailable)?
    {
        let (kind, amount, tasks) = entry.map_err(unavailable)?;
        totals.insert(kind, (amount, tasks));
    }
    let total = |kind: &str| totals.get(kind).copied().unwrap_or((0, 0));
    let (_, reserve_tasks) = total("reserve");
    let (confirm_amount, confirm_tasks) = total("confirm");
    let (_, release_tasks) = total("release");
    let budget = &run["budget"];
    let mut spend = json!({
        "confirmedMicros": confirm_amount,
        "confirmedTasks": confirm_tasks,
        "pendingTasks": (reserve_tasks - confirm_tasks - release_tasks).max(0),
        "maxTasks": budget.get("maxTasks").cloned().unwrap_or(Value::Null),
        "maxRounds": budget.get("maxRounds").cloned().unwrap_or(Value::Null),
    });
    if let Some(max_cost) = budget.get("maxCostMicros") {
        spend["maxCostMicros"] = max_cost.clone();
    }

    let mut statement = connection
        .prepare(
            "SELECT kind, COUNT(*) FROM pipeline_artifacts WHERE run_id = ?1
              GROUP BY kind ORDER BY MIN(created_at)",
        )
        .map_err(unavailable)?;
    let artifacts: Vec<Value> = statement
        .query_map([run_id], |row| {
            Ok(json!({ "kind": row.get::<_, String>(0)?, "count": row.get::<_, i64>(1)? }))
        })
        .map_err(unavailable)?
        .collect::<Result<_, _>>()
        .map_err(unavailable)?;

    // 只有 running / unknown_submit 算未完成；失败的 Step 是已记录的结果，不是恢复点。
    let resume_from = connection
        .query_row(
            "SELECT seq, id, tool, status, mutation_id FROM run_steps
              WHERE run_id = ?1 AND status IN ('running', 'unknown_submit')
              ORDER BY seq LIMIT 1",
            [run_id],
            |row| {
                Ok(json!({
                    "seq": row.get::<_, i64>(0)?,
                    "stepId": row.get::<_, String>(1)?,
                    "tool": row.get::<_, String>(2)?,
                    "status": row.get::<_, String>(3)?,
                    "mutationId": row.get::<_, Option<String>>(4)?,
                }))
            },
        )
        .optional()
        .map_err(unavailable)?;

    let blocker = run["blocker"].clone();
    Ok(json!({
        "run": run,
        "steps": steps,
        "versions": versions,
        "rounds": rounds,
        "spend": spend,
        "artifacts": artifacts,
        "blocker": blocker,
        "resumeFrom": resume_from,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str =
        include_str!("../../../tools/flovart/contracts/runtime/migrations/0005_agent_pipeline.sql");

    fn seeded() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection
            .execute(
                "INSERT INTO pipeline_runs(id, project_id, title, status, brief_json, budget_json,
                     head_version, created_by, created_at, updated_at)
                 VALUES('run_1', 'proj', 'Demo', 'active', '{}', '{\"maxTasks\":3,\"maxRounds\":2}',
                     0, 'agent', 1, 1)",
                [],
            )
            .unwrap();
        for (seq, tool, status) in [(1, "pipeline.run.start", "succeeded"), (2, "audio.tts", "failed")] {
            connection
                .execute(
                    "INSERT INTO run_steps(id, run_id, seq, tool, caller, args_digest, args_json,
                         status, started_at, error_json)
                     VALUES(?1, 'run_1', ?2, ?3, 'agent', 'd', '{}', ?4, ?2, ?5)",
                    params![
                        format!("step_{seq}"),
                        seq,
                        tool,
                        status,
                        (status == "failed").then_some("{\"code\":\"PROVIDER_FAILED\",\"message\":\"x\"}")
                    ],
                )
                .unwrap();
        }
        connection
    }

    #[test]
    fn reads_trace_with_node_shape() {
        let connection = seeded();
        let trace = read_trace(&connection, "run_1", 0).unwrap();
        assert_eq!(trace["run"]["id"], "run_1");
        assert_eq!(trace["steps"].as_array().unwrap().len(), 2);
        assert_eq!(trace["spend"]["maxTasks"], 3);
        let since = read_trace(&connection, "run_1", 1).unwrap();
        assert_eq!(since["steps"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn missing_run_is_not_found() {
        let connection = seeded();
        let error = read_trace(&connection, "nope", 0).unwrap_err();
        assert!(format!("{error:?}").contains("RUN_NOT_FOUND"));
    }

    /// 跨语言一致性：`FLOVART_PIPELINE_PARITY_DB` + `FLOVART_PIPELINE_PARITY_EXPECTED`
    /// （Node `Pipeline.trace()` 的 JSON 输出，含 runId）由 `npm run e2e:pipeline:parity` 提供。
    #[test]
    #[ignore]
    fn matches_node_trace_for_real_run() {
        let db = std::env::var("FLOVART_PIPELINE_PARITY_DB").expect("FLOVART_PIPELINE_PARITY_DB");
        let expected_path =
            std::env::var("FLOVART_PIPELINE_PARITY_EXPECTED").expect("FLOVART_PIPELINE_PARITY_EXPECTED");
        let expected: Value =
            serde_json::from_str(&std::fs::read_to_string(expected_path).unwrap()).unwrap();
        let run_id = expected["run"]["id"].as_str().unwrap();
        let connection = Connection::open(db).unwrap();
        let actual = read_trace(&connection, run_id, 0).unwrap();
        assert_eq!(actual, expected);
    }
}
