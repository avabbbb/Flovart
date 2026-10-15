use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
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

/// How the managed agent process will be started. `BundledSidecar` is the
/// self-contained binary shipped inside the installer (no system Node
/// required); the other sources are JavaScript entrypoints run via `node`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManagedAgentLaunchSource {
    ExplicitEntrypoint,
    BundledSidecar,
    Toolkit,
    Development,
}

#[derive(Clone, Debug)]
pub struct ManagedAgentLaunch {
    pub program: PathBuf,
    pub args: Vec<PathBuf>,
    pub cwd: PathBuf,
    pub source: ManagedAgentLaunchSource,
}

impl ManagedAgentLaunch {
    /// On-disk file that must exist before the launch can possibly work: the
    /// sidecar binary itself for bundled launches, the script entrypoint for
    /// every Node-based source.
    fn required_file(&self) -> &Path {
        match self.source {
            ManagedAgentLaunchSource::BundledSidecar => self.program.as_path(),
            _ => self
                .args
                .first()
                .map_or(self.program.as_path(), PathBuf::as_path),
        }
    }
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

/// Plan a launch without a bundled sidecar. Kept as the stable public entry
/// used by the contract tests and by callers that only have Node-based
/// sources; the real application path goes through
/// [`plan_managed_agent_launch_with_sidecar`].
///
/// Precedence here: explicit entrypoint → installed Toolkit → development
/// entrypoint.
pub fn plan_managed_agent_launch(
    options: ManagedAgentLaunchOptions,
) -> Result<ManagedAgentLaunch, String> {
    plan_launch(options, None)
}

/// Plan a launch preferring the bundled self-contained sidecar when one is
/// present next to the running executable (or via `FLOVART_MANAGED_AGENT_BIN`).
///
/// Precedence: explicit `FLOVART_MANAGED_AGENT_ENTRY` → bundled sidecar →
/// installed Toolkit → development entrypoint → error.
pub fn plan_managed_agent_launch_with_sidecar(
    options: ManagedAgentLaunchOptions,
    sidecar: Option<PathBuf>,
) -> Result<ManagedAgentLaunch, String> {
    plan_launch(options, sidecar.filter(|path| path.is_file()))
}

fn plan_launch(
    options: ManagedAgentLaunchOptions,
    sidecar: Option<PathBuf>,
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
            source: ManagedAgentLaunchSource::ExplicitEntrypoint,
        });
    }

    if let Some(sidecar) = sidecar {
        let cwd = sidecar
            .parent()
            .ok_or_else(|| "Managed Agent sidecar has no parent directory.".to_owned())?
            .to_path_buf();
        return Ok(ManagedAgentLaunch {
            program: sidecar,
            args: Vec::new(),
            cwd,
            source: ManagedAgentLaunchSource::BundledSidecar,
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
            source: ManagedAgentLaunchSource::Development,
        });
    }
    Err(
        "Managed Agent is unavailable: no bundled sidecar, no installed Toolkit, and no development entrypoint."
            .to_owned(),
    )
}

pub fn bundled_sidecar_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("FLOVART_MANAGED_AGENT_BIN").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    let triple = target_triple();
    // Tauri externalBin emits `flovart-agent-<triple>[.exe]` next to the app
    // executable; the plain name covers repackaged or dev-copied layouts.
    let mut candidates: Vec<String> = Vec::new();
    for suffix in ["", ".exe"] {
        candidates.push(format!("flovart-agent-{triple}{suffix}"));
    }
    for suffix in ["", ".exe"] {
        candidates.push(format!("flovart-agent{suffix}"));
    }
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
        }
    }
    if let Some(dir) = tauri_resource_dir() {
        if !roots.iter().any(|root| root == &dir) {
            roots.push(dir);
        }
    }
    for dir in roots {
        for name in &candidates {
            let path = dir.join(name);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn target_triple() -> String {
    // Matches the Rust target triples the CI sidecar matrix builds. Fall back
    // to a constructed `arch-vendor-os` name for anything outside the matrix.
    if cfg!(target_os = "windows") {
        if cfg!(target_arch = "x86_64") {
            return "x86_64-pc-windows-msvc".to_owned();
        }
        if cfg!(target_arch = "aarch64") {
            return "aarch64-pc-windows-msvc".to_owned();
        }
    }
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "x86_64") {
            return "x86_64-apple-darwin".to_owned();
        }
        if cfg!(target_arch = "aarch64") {
            return "aarch64-apple-darwin".to_owned();
        }
    }
    if cfg!(target_os = "linux") {
        if cfg!(target_arch = "x86_64") {
            return "x86_64-unknown-linux-gnu".to_owned();
        }
        if cfg!(target_arch = "aarch64") {
            return "aarch64-unknown-linux-gnu".to_owned();
        }
    }
    format!("{}-unknown-{}", std::env::consts::ARCH, std::env::consts::OS)
}
/// Resolve the conventional Tauri resource location relative to the running
/// executable without needing an `AppHandle` (the host is constructed during
/// `setup`, before state is managed). Tauri v2 places `externalBin` payloads
/// next to the executable on Windows/Linux and inside `Contents/Resources`
/// on macOS.
fn tauri_resource_dir() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    if cfg!(target_os = "macos") {
        Some(exe_dir.join("../Resources"))
    } else {
        Some(exe_dir)
    }
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
        source: ManagedAgentLaunchSource::Toolkit,
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
    log_path: PathBuf,
    lock_path: PathBuf,
    project_dir: Option<PathBuf>,
    child: Mutex<Option<Child>>,
    shutting_down: AtomicBool,
    /// Earliest time a respawn is allowed after an unexpected exit. Bounded
    /// crash recovery: a dead child is restarted, but not faster than this.
    next_respawn_at: Mutex<Option<Instant>>,
}

const RESPAWN_BACKOFF: Duration = Duration::from_secs(2);

impl ManagedAgentHost {
    pub fn from_environment() -> Self {
        let home_dir = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let agent_dir = std::env::var_os("FLOVART_AGENT_CONFIG")
            .map(PathBuf::from)
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .filter(|dir| !dir.as_os_str().is_empty())
            .unwrap_or_else(|| home_dir.join(".flovart"));
        let config_path = std::env::var_os("FLOVART_AGENT_CONFIG")
            .map(PathBuf::from)
            .unwrap_or_else(|| agent_dir.join("agent.json"));
        let log_path = agent_dir.join("managed-agent.log");
        let lock_path = agent_dir.join("managed-agent.lock");
        let project_dir = std::env::var_os("FLOVART_PROJECT_DIR").map(PathBuf::from);
        // The desktop bundle is also built directly from this source checkout during
        // local release verification. Keep the checked-out Agent as a safe fallback
        // when a versioned Toolkit has not been installed yet; installed builds still
        // prefer the bundled sidecar and Toolkit entrypoints above.
        let source_entrypoint = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agent/index.js");
        let development_entrypoint = source_entrypoint.is_file().then_some(source_entrypoint);
        let launch = plan_managed_agent_launch_with_sidecar(
            ManagedAgentLaunchOptions {
                node: std::env::var_os("FLOVART_NODE").map(PathBuf::from),
                entrypoint: std::env::var_os("FLOVART_MANAGED_AGENT_ENTRY").map(PathBuf::from),
                home_dir,
                development_entrypoint,
            },
            bundled_sidecar_path(),
        );
        Self {
            launch,
            config_path,
            log_path,
            lock_path,
            project_dir,
            child: Mutex::new(None),
            shutting_down: AtomicBool::new(false),
            next_respawn_at: Mutex::new(None),
        }
    }

    pub fn ensure_connection(&self) -> Result<ManagedAgentConnection, String> {
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("Managed Agent is shutting down.".to_owned());
        }
        // Fast path: a live child whose config already probes healthy. `managed`
        // stays honest — a foreign agent answering our config reports
        // `managed: false`.
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
                // The slot held a dead (or never-spawned) child: controlled
                // crash recovery — clear it, observe the respawn backoff, then
                // start exactly one replacement while the lock is held so a
                // concurrent caller cannot race a second spawn.
                *child = None;
                if self.shutting_down.load(Ordering::Acquire) {
                    return Err("Managed Agent is shutting down.".to_owned());
                }
                self.claim_ownership()?;
                if let Some(wait) = self.respawn_wait() {
                    drop(child);
                    std::thread::sleep(wait);
                    return self.ensure_connection();
                }
                *child = Some(self.spawn_agent()?);
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

    /// Remaining respawn backoff after an unexpected exit, if any. First
    /// launch and post-shutdown restarts are not delayed; a crashed child
    /// must wait out `RESPAWN_BACKOFF` so a crash-looping agent cannot spin.
    fn respawn_wait(&self) -> Option<Duration> {
        let mut next = self.next_respawn_at.lock();
        match *next {
            Some(deadline) if deadline > Instant::now() => Some(deadline - Instant::now()),
            _ => {
                *next = Some(Instant::now() + RESPAWN_BACKOFF);
                None
            }
        }
    }

    /// Spawn the managed agent process. Called with the child slot cleared and
    /// the mutex held; returns the running `Child` on success.
    fn spawn_agent(&self) -> Result<Child, String> {
        let launch = self.launch.as_ref().map_err(Clone::clone)?;
        if !launch.required_file().is_file() {
            return Err(format!(
                "Managed Agent launch target does not exist: {}",
                launch.required_file().display()
            ));
        }
        let mut command = Command::new(&launch.program);
        command
            .args(&launch.args)
            .current_dir(&launch.cwd)
            .env("FLOVART_AGENT_CONFIG", &self.config_path)
            .stdin(Stdio::null());
        // Route the child's output to a per-profile log instead of the void so
        // a failing agent leaves evidence; append so restarts keep history.
        match self.open_log() {
            Ok(log) => {
                let stderr_log = log
                    .try_clone()
                    .map_err(|error| format!("clone Managed Agent log handle: {error}"))?;
                command.stdout(Stdio::from(log)).stderr(Stdio::from(stderr_log));
            }
            Err(error) => {
                log::warn!("Managed Agent log unavailable ({error}); output discarded.");
                command.stdout(Stdio::null()).stderr(Stdio::null());
            }
        }
        if let Some(project_dir) = &self.project_dir {
            command.env("FLOVART_PROJECT_DIR", project_dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let child = command
            .spawn()
            .map_err(|error| format!("start Managed Agent: {error}"))?;
        log::info!(
            "Managed Agent spawned via {:?} (pid {}).",
            launch.source,
            child.id()
        );
        Ok(child)
    }

    fn open_log(&self) -> std::io::Result<fs::File> {
        if let Some(dir) = self.log_path.parent() {
            fs::create_dir_all(dir)?;
        }
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
    }

    /// Best-effort cross-process duplicate guard. A marker file records the
    /// owning pid; a live foreign pid means another Flovart instance already
    /// runs the agent and we must not spawn a second runtime. Single-instance
    /// already covers the common case — this is the belt for side-channel
    /// launches (second binary, dev exe beside installed exe).
    fn claim_ownership(&self) -> Result<(), String> {
        let marker = self.lock_path.clone();
        if marker.is_file() {
            if let Ok(raw) = fs::read_to_string(&marker) {
                if let Ok(pid) = raw.trim().parse::<u32>() {
                    if pid != std::process::id() && pid_alive(pid) {
                        return Err(format!(
                            "Managed Agent is already owned by another Flovart process (pid {pid})."
                        ));
                    }
                }
            }
        }
        if let Some(dir) = marker.parent() {
            fs::create_dir_all(dir)
                .map_err(|error| format!("create Managed Agent lock dir: {error}"))?;
        }
        fs::write(&marker, std::process::id().to_string())
            .map_err(|error| format!("write Managed Agent lock: {error}"))
    }

    fn release_ownership(&self) {
        if let Ok(raw) = fs::read_to_string(&self.lock_path) {
            if raw.trim().parse::<u32>().ok() == Some(std::process::id()) {
                let _ = fs::remove_file(&self.lock_path);
            }
        }
    }

    pub fn shutdown(&self) -> bool {
        self.shutting_down.store(true, Ordering::Release);
        let Some(mut child) = self.child.lock().take() else {
            self.release_ownership();
            return false;
        };
        let _ = child.kill();
        let _ = child.wait();
        self.release_ownership();
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

/// Is a process with this pid currently alive? Windows uses `OpenProcess`
/// (already a dependency); other platforms fall back to `kill(pid, 0)`.
#[cfg(windows)]
fn pid_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: pid is a valid process id; the returned handle is closed
    // immediately. A null handle means the process is gone or inaccessible.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return false;
    }
    unsafe {
        CloseHandle(handle);
    }
    true
}

#[cfg(not(windows))]
fn pid_alive(pid: u32) -> bool {
    // No libc dependency: `kill -0 <pid>` is a pure existence probe.
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

impl Drop for ManagedAgentHost {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(home: &Path) -> ManagedAgentLaunchOptions {
        ManagedAgentLaunchOptions {
            node: None,
            entrypoint: None,
            home_dir: home.to_path_buf(),
            development_entrypoint: None,
        }
    }

    #[test]
    fn launch_precedence_prefers_sidecar_then_toolkit_then_dev() {
        // A temp home with an installed Toolkit stub and a dev entrypoint on
        // disk; the sidecar must still win.
        let dir = std::env::temp_dir().join(format!("flovart-launch-{}", std::process::id()));
        let bundle_dir = dir.join("toolkit-bundle");
        fs::create_dir_all(&bundle_dir).unwrap();
        let toolkit_state = dir.join(".flovart/toolkit");
        fs::create_dir_all(&toolkit_state).unwrap();
        let entry_script = bundle_dir.join("agent.js");
        fs::write(&entry_script, "// stub").unwrap();
        fs::write(
            toolkit_state.join("current.json"),
            format!(r#"{{"bundleDir":{}}}"#, serde_json::to_string(&bundle_dir).unwrap()),
        )
        .unwrap();
        fs::write(
            bundle_dir.join("bundle.json"),
            r#"{"entrypoints":{"agent":{"command":"$NODE","args":["{bundle}/agent.js"]}}}"#,
        )
        .unwrap();
        let dev_entry = dir.join("dev-agent.js");
        fs::write(&dev_entry, "// dev stub").unwrap();

        let mut opts = options(&dir);
        opts.development_entrypoint = Some(dev_entry.clone());
        let sidecar = dir.join("flovart-agent.exe");
        fs::write(&sidecar, b"MZ").unwrap();

        // Sidecar present → BundledSidecar, program=exe, no args.
        let launch =
            plan_managed_agent_launch_with_sidecar(opts.clone(), Some(sidecar.clone())).unwrap();
        assert_eq!(launch.source, ManagedAgentLaunchSource::BundledSidecar);
        assert_eq!(launch.program, sidecar);
        assert!(launch.args.is_empty());

        // No sidecar → Toolkit wins over dev.
        let launch = plan_managed_agent_launch_with_sidecar(opts.clone(), None).unwrap();
        assert_eq!(launch.source, ManagedAgentLaunchSource::Toolkit);
        assert_eq!(launch.args.first(), Some(&entry_script));

        // Neither → dev fallback.
        let mut opts_no_toolkit = options(&dir.join("empty-home"));
        opts_no_toolkit.development_entrypoint = Some(dev_entry.clone());
        let launch = plan_managed_agent_launch_with_sidecar(opts_no_toolkit, None).unwrap();
        assert_eq!(launch.source, ManagedAgentLaunchSource::Development);

        // Explicit env entrypoint beats everything, including the sidecar.
        let mut opts_explicit = options(&dir);
        let explicit = dir.join("explicit.js");
        fs::write(&explicit, "// explicit").unwrap();
        opts_explicit.entrypoint = Some(explicit.clone());
        let launch =
            plan_managed_agent_launch_with_sidecar(opts_explicit, Some(sidecar.clone())).unwrap();
        assert_eq!(launch.source, ManagedAgentLaunchSource::ExplicitEntrypoint);
        assert_eq!(launch.args, vec![explicit]);

        let _ = fs::remove_dir_all(&dir);
    }

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
            log_path: PathBuf::from("unused-managed-agent.log"),
            lock_path: PathBuf::from("unused-managed-agent.lock"),
            project_dir: None,
            child: Mutex::new(Some(child)),
            shutting_down: AtomicBool::new(false),
            next_respawn_at: Mutex::new(None),
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
