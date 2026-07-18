use flovart_lib::runtime::ProductionRuntime;
use serde_json::json;
use uuid::{Uuid, Version};

#[test]
fn runtime_status_comes_from_the_canonical_v1_contract() {
    let runtime = ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime contract");
    let status = runtime.status();

    assert_eq!(status.protocol_version, "1");
    assert!(status.runtime_instance_id.starts_with("runtime_"));
    assert_eq!(status.registry_hash, runtime.registry().registry_hash);
    assert_eq!(status.authority, "desktop-runtime");
    assert_eq!(status.state, "ready");
    assert_eq!(
        runtime.registry().registry_hash,
        "40607136450f6bf4551873901ab53561fbcf773e500603bac7fa327fd5c17658"
    );
    assert!(runtime.registry().commands.contains_key("runtime.status"));
    assert!(!runtime.registry().commands.contains_key("workflow.run"));
}

#[test]
fn runtime_execute_dispatches_only_available_canonical_commands() {
    let runtime = ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime contract");
    let envelope = |command: &str, args: serde_json::Value| {
        json!({
            "protocolVersion": "1",
            "commandId": ProductionRuntime::new_id("cmd"),
            "command": command,
            "args": args,
            "actor": { "kind": "cli", "instanceId": "cli_test" }
        })
    };

    let list = runtime
        .execute(&envelope("command.list", json!({})))
        .expect("command list");
    assert_eq!(list["registryHash"], runtime.registry().registry_hash);
    assert_eq!(
        list["commands"]["runtime.status"]["availability"],
        "available"
    );

    let schema = runtime
        .execute(&envelope(
            "command.schema",
            json!({ "command": "generate.video" }),
        ))
        .expect("command schema");
    assert_eq!(schema["command"], "generate.video");
    assert_eq!(schema["schema"]["availability"], "legacy-only");

    assert_eq!(
        runtime
            .execute(&envelope("help", json!({})))
            .expect_err("legacy command must not dispatch")
            .code,
        "RUNTIME_UNAVAILABLE"
    );
}

#[test]
fn runtime_ids_and_payload_hashes_are_canonical() {
    let first = json!({"b": 2, "a": 1});
    let reordered = json!({"a": 1, "b": 2});

    assert_eq!(
        ProductionRuntime::hash_payload(&first).expect("canonical hash"),
        ProductionRuntime::hash_payload(&reordered).expect("canonical hash")
    );
    assert_eq!(
        ProductionRuntime::hash_payload(&first).expect("canonical hash"),
        "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"
    );

    let id = ProductionRuntime::new_id("cmd");
    let uuid = Uuid::parse_str(id.strip_prefix("cmd_").expect("command prefix")).expect("uuid");
    assert_eq!(uuid.get_version(), Some(Version::SortRand));
}

#[test]
fn runtime_rejects_invalid_protocol_and_unknown_commands() {
    let runtime = ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime contract");
    let base = json!({
        "protocolVersion": "1",
        "commandId": "cmd_test",
        "command": "runtime.status",
        "args": {},
        "actor": { "kind": "cli", "instanceId": "cli_local" }
    });

    let mut unknown_field = base.clone();
    unknown_field["leaked"] = json!(true);
    assert_eq!(
        runtime
            .validate_envelope(&unknown_field)
            .expect_err("unknown field")
            .code,
        "INVALID_ARGUMENT"
    );

    let mut protocol_mismatch = base.clone();
    protocol_mismatch["protocolVersion"] = json!("2");
    assert_eq!(
        runtime
            .validate_envelope(&protocol_mismatch)
            .expect_err("protocol mismatch")
            .code,
        "PROTOCOL_MISMATCH"
    );

    let mut unknown_command = base;
    unknown_command["command"] = json!("workflow.run");
    assert_eq!(
        runtime
            .validate_envelope(&unknown_command)
            .expect_err("unknown command")
            .code,
        "UNKNOWN_COMMAND"
    );
}
