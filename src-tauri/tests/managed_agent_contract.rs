use flovart_lib::managed_agent::{
    parse_managed_agent_connection, plan_managed_agent_launch, ManagedAgentLaunchOptions,
};
use std::path::PathBuf;

#[test]
fn managed_agent_connection_accepts_only_authenticated_loopback_http() {
    let connection = parse_managed_agent_connection(
        br#"{"url":"http://127.0.0.1:17372","token":"desktop-only-token"}"#,
        true,
    )
    .expect("valid loopback config");
    assert_eq!(connection.url, "http://127.0.0.1:17372");
    assert_eq!(connection.state, "ready");
    assert!(connection.managed);

    let remote = br#"{"url":"https://example.com","token":"desktop-only-token"}"#;
    assert!(parse_managed_agent_connection(remote, false).is_err());
}

#[test]
fn managed_agent_launch_uses_an_explicit_node_entrypoint_without_a_shell() {
    let entrypoint = PathBuf::from("C:/flovart/managed-agent/index.js");
    let launch = plan_managed_agent_launch(ManagedAgentLaunchOptions {
        node: Some(PathBuf::from("C:/Program Files/nodejs/node.exe")),
        entrypoint: Some(entrypoint.clone()),
        home_dir: PathBuf::from("C:/Users/test"),
        development_entrypoint: None,
    })
    .expect("explicit launch plan");

    assert_eq!(
        launch.program,
        PathBuf::from("C:/Program Files/nodejs/node.exe")
    );
    assert_eq!(launch.args, vec![entrypoint]);
    assert_eq!(launch.cwd, PathBuf::from("C:/flovart/managed-agent"));
}
