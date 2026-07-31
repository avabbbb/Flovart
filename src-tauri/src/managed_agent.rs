use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use url::Url;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAgentConnection {
    pub state: String,
    pub url: String,
    pub token: String,
    pub managed: bool,
}

#[derive(Debug, Deserialize)]
struct ManagedAgentConfig {
    url: String,
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedAgentProbe {
    ok: bool,
    url: String,
    has_token: bool,
}

#[derive(Clone, Debug)]
pub struct ManagedAgentLaunch {
    pub program: PathBuf,
    pub args: Vec<PathBuf>,
    pub cwd: PathBuf,
}

#[derive(Clone, Debug)]
pub struct ManagedAgentLaunchOptions {
    pub node: Option<PathBuf>,
    pub entrypoint: Option<PathBuf>,
    pub home_dir: PathBuf,
    pub development_entrypoint: Option<PathBuf>,
}

pub fn parse_managed_agent_connection(
    bytes: &[u8],
    managed: bool,
) -> Result<ManagedAgentConnection, String> {
    let config: ManagedAgentConfig =
        serde_json::from_slice(bytes).map_err(|error| format!("parse Agent config: {error}"))?;
    let endpoint = Url::parse(&config.url).map_err(|error| format!("parse Agent URL: {error}"))?;
    let loopback = matches!(endpoint.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if endpoint.scheme() != "http" || !loopback {
        return Err("Managed Agent must use a loopback HTTP endpoint.".to_owned());
    }
    if config.token.trim().is_empty() {
        return Err("Managed Agent config is missing its local token.".to_owned());
    }
    Ok(ManagedAgentConnection {
        state: "ready".to_owned(),
        url: endpoint.origin().ascii_serialization(),
        token: config.token,
        managed,
    })
}

pub fn plan_managed_agent_launch(
    options: ManagedAgentLaunchOptions,
) -> Result<ManagedAgentLaunch, String> {
    let program = options.node.unwrap_or_else(|| PathBuf::from("node"));
    if let Some(entrypoint) = options.entrypoint {
        let cwd = entrypoint
            .parent()
            .ok_or_else(|| "Managed Agent entrypoint has no parent directory.".to_owned())?
            .to_path_buf();
        return Ok(ManagedAgentLaunch {
            program,
            args: vec![entrypoint],
            cwd,
        });
    }

    if let Some(launch) = toolkit_launch(&options.home_dir, program.clone())? {
        return Ok(launch);
    }
    if let Some(entrypoint) = options
        .development_entrypoint
        .filter(|entrypoint| entrypoint.is_file())
    {
        let cwd = entrypoint
            .parent()
            .ok_or_else(|| "Development Agent entrypoint has no parent directory.".to_owned())?
            .to_path_buf();
        return Ok(ManagedAgentLaunch {
            program,
            args: vec![entrypoint],
            cwd,
        });
    }
    Err(
        "Managed Agent Toolkit is not installed and no development entrypoint is available."
            .to_owned(),
    )
}

fn toolkit_launch(home_dir: &Path, node: PathBuf) -> Result<Option<ManagedAgentLaunch>, String> {
    let current_path = home_dir.join(".flovart/toolkit/current.json");
    if !current_path.is_file() {
        return Ok(None);
    }
    let current: serde_json::Value = serde_json::from_slice(
        &fs::read(&current_path).map_err(|error| format!("read Agent Toolkit state: {error}"))?,
    )
    .map_err(|error| format!("parse Agent Toolkit state: {error}"))?;
    let bundle_dir = current
        .get("bundleDir")
        .and_then(serde_json::Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| "Agent Toolkit state is missing bundleDir.".to_owned())?;
    let bundle_path = bundle_dir.join("bundle.json");
    let bundle: serde_json::Value = serde_json::from_slice(
        &fs::read(&bundle_path).map_err(|error| format!("read Agent Toolkit bundle: {error}"))?,
    )
    .map_err(|error| format!("parse Agent Toolkit bundle: {error}"))?;
    let entry = bundle
        .pointer("/entrypoints/agent")
        .ok_or_else(|| "Agent Toolkit bundle is missing its Agent entrypoint.".to_owned())?;
    if entry.get("command").and_then(serde_json::Value::as_str) != Some("$NODE") {
        return Err("Agent Toolkit must use its verified Node entrypoint.".to_owned());
    }
    let args = entry
        .get("args")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Agent Toolkit entrypoint is missing args.".to_owned())?
        .iter()
        .map(|value| {
            let raw = value
                .as_str()
                .ok_or_else(|| "Agent Toolkit entrypoint contains a non-string arg.".to_owned())?;
            resolve_bundle_path(&bundle_dir, raw)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if args.is_empty() || !args[0].is_file() {
        return Err("Agent Toolkit entrypoint does not exist.".to_owned());
    }
    Ok(Some(ManagedAgentLaunch {
        program: node,
        args,
        cwd: bundle_dir,
    }))
}

fn resolve_bundle_path(bundle_dir: &Path, raw: &str) -> Result<PathBuf, String> {
    let normalized = raw.replace('\\', "/");
    let relative = normalized
        .strip_prefix("{bundle}/")
        .ok_or_else(|| "Agent Toolkit args must be bundle-relative.".to_owned())?;
    if relative.split('/').any(|part| part == "..") {
        return Err("Agent Toolkit entrypoint escapes its bundle.".to_owned());
    }
    Ok(bundle_dir.join(relative))
}

pub struct ManagedAgentHost {
    launch: Result<ManagedAgentLaunch, String>,
    config_path: PathBuf,
    child: Mutex<Option<Child>>,
    shutting_down: AtomicBool,
}

impl ManagedAgentHost {
    pub fn from_environment() -> Self {
        let home_dir = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let config_path = std::env::var_os("FLOVART_AGENT_CONFIG")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir.join(".flovart/agent.json"));
        let development_entrypoint = if cfg!(debug_assertions) {
            Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agent/index.js"))
        } else {
            None
        };
        let launch = plan_managed_agent_launch(ManagedAgentLaunchOptions {
            node: std::env::var_os("FLOVART_NODE").map(PathBuf::from),
            entrypoint: std::env::var_os("FLOVART_MANAGED_AGENT_ENTRY").map(PathBuf::from),
            home_dir,
            development_entrypoint,
        });
        Self {
            launch,
            config_path,
            child: Mutex::new(None),
            shutting_down: AtomicBool::new(false),
        }
    }

    pub fn ensure_connection(&self) -> Result<ManagedAgentConnection, String> {
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("Managed Agent is shutting down.".to_owned());
        }
        let managed = self
            .child
            .lock()
            .as_mut()
            .is_some_and(|process| process.try_wait().ok().flatten().is_none());
        if let Ok(connection) = self.read_ready_connection(managed) {
            return Ok(connection);
        }
        {
            let mut child = self.child.lock();
            let alive = child
                .as_mut()
                .map(|process| process.try_wait().ok().flatten().is_none())
                .unwrap_or(false);
            if !alive {
                *child = None;
                if self.shutting_down.load(Ordering::Acquire) {
                    return Err("Managed Agent is shutting down.".to_owned());
                }
                let launch = self.launch.as_ref().map_err(Clone::clone)?;
                if !launch
                    .args
                    .first()
                    .is_some_and(|entrypoint| entrypoint.is_file())
                {
                    return Err("Managed Agent entrypoint does not exist.".to_owned());
                }
                let mut command = Command::new(&launch.program);
                command
                    .args(&launch.args)
                    .current_dir(&launch.cwd)
                    .env("FLOVART_AGENT_CONFIG", &self.config_path)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    command.creation_flags(0x08000000);
                }
                *child = Some(
                    command
                        .spawn()
                        .map_err(|error| format!("start Managed Agent: {error}"))?,
                );
            }
        }

        for _ in 0..40 {
            if let Ok(connection) = self.read_ready_connection(true) {
                return Ok(connection);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("Managed Agent did not become ready within 4 seconds.".to_owned())
    }

    pub fn shutdown(&self) -> bool {
        self.shutting_down.store(true, Ordering::Release);
        let Some(mut child) = self.child.lock().take() else {
            return false;
        };
        let _ = child.kill();
        let _ = child.wait();
        true
    }

    fn read_ready_connection(&self, managed: bool) -> Result<ManagedAgentConnection, String> {
        let connection = parse_managed_agent_connection(
            &fs::read(&self.config_path)
                .map_err(|error| format!("read Managed Agent config: {error}"))?,
            managed,
        )?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .map_err(|error| format!("build Managed Agent health client: {error}"))?;
        let response = client
            .get(format!("{}/config", connection.url))
            .send()
            .map_err(|error| format!("probe Managed Agent: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Managed Agent health probe returned {}.",
                response.status()
            ));
        }
        let probe: ManagedAgentProbe = response
            .json()
            .map_err(|error| format!("parse Managed Agent health probe: {error}"))?;
        if !probe.ok || !probe.has_token || probe.url != connection.url {
            return Err(
                "Managed Agent health probe did not match its discovery config.".to_owned(),
            );
        }
        Ok(connection)
    }
}

impl Drop for ManagedAgentHost {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_is_idempotent_and_blocks_future_startup() {
        let child = Command::new("node")
            .args(["-e", "setInterval(() => {}, 1000)"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start test child");
        let host = ManagedAgentHost {
            launch: Err("test launch must not run".to_owned()),
            config_path: PathBuf::from("unused-agent-config.json"),
            child: Mutex::new(Some(child)),
            shutting_down: AtomicBool::new(false),
        };

        assert!(host.shutdown());
        assert!(!host.shutdown());
        assert_eq!(
            host.ensure_connection().unwrap_err(),
            "Managed Agent is shutting down."
        );
    }
}

#[tauri::command]
pub async fn managed_agent_connection(
    host: tauri::State<'_, Arc<ManagedAgentHost>>,
) -> Result<ManagedAgentConnection, String> {
    log::info!("WebUI requested the Managed Agent loopback connection.");
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.ensure_connection())
        .await
        .map_err(|error| format!("join Managed Agent startup: {error}"))?
}
