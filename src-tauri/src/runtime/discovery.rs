use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use super::{ProductionRuntime, RuntimeContractError};

pub const DISCOVERY_SCHEMA_VERSION: &str = "1";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscoveryRecord {
    pub schema_version: String,
    pub protocol_version: String,
    pub runtime_instance_id: String,
    pub runtime_version: String,
    pub registry_hash: String,
    pub pid: u32,
    pub port: u16,
    pub started_at: String,
    pub token: String,
}

impl DiscoveryRecord {
    pub(super) fn new(runtime: &ProductionRuntime, port: u16, token: String) -> Self {
        let status = runtime.status();
        Self {
            schema_version: DISCOVERY_SCHEMA_VERSION.to_owned(),
            protocol_version: status.protocol_version,
            runtime_instance_id: status.runtime_instance_id,
            runtime_version: status.runtime_version,
            registry_hash: status.registry_hash,
            pid: std::process::id(),
            port,
            started_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            token,
        }
    }
}

pub fn default_discovery_path() -> Result<PathBuf, RuntimeContractError> {
    if let Some(path) = std::env::var_os("FLOVART_RUNTIME_DISCOVERY") {
        return Ok(PathBuf::from(path));
    }
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| RuntimeContractError::Security("LOCALAPPDATA is not set".to_owned()))?;
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library").join("Application Support"))
        .ok_or_else(|| RuntimeContractError::Security("HOME is not set".to_owned()))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local").join("share"))
        })
        .ok_or_else(|| {
            RuntimeContractError::Security("XDG_RUNTIME_DIR and HOME are not set".to_owned())
        })?;
    Ok(base.join("Flovart").join("runtime").join("control-v1.json"))
}

pub(super) fn write_discovery(
    path: &Path,
    record: &DiscoveryRecord,
) -> Result<(), RuntimeContractError> {
    let parent = path
        .parent()
        .ok_or_else(|| RuntimeContractError::Security("discovery path has no parent".to_owned()))?;
    fs::create_dir_all(parent)?;
    secure_path(parent, true)?;

    let temporary = parent.join(format!(".control-{}.tmp", record.runtime_instance_id));
    let bytes = serde_json::to_vec(record)?;
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    secure_path(&temporary, false)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(&temporary, path)?;
    Ok(())
}

pub(super) fn remove_if_owned(path: &Path, runtime_instance_id: &str) {
    let owned = fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<DiscoveryRecord>(&bytes).ok())
        .is_some_and(|record| record.runtime_instance_id == runtime_instance_id);
    if owned {
        let _ = fs::remove_file(path);
    }
}

#[cfg(unix)]
fn secure_path(path: &Path, directory: bool) -> Result<(), RuntimeContractError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(
        path,
        fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
    )?;
    Ok(())
}

#[cfg(windows)]
fn secure_path(path: &Path, directory: bool) -> Result<(), RuntimeContractError> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::{GetLastError, LocalFree},
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
            },
            SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
            PSECURITY_DESCRIPTOR,
        },
    };

    let sid = current_process_sid()?;
    let sddl = if directory {
        format!("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;{sid})")
    } else {
        format!("D:P(A;;FA;;;SY)(A;;FA;;;{sid})")
    };
    let wide_sddl: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
    let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide_sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            ptr::null_mut(),
        )
    };
    if converted == 0 {
        return Err(RuntimeContractError::Security(format!(
            "create owner-only DACL: Windows error {}",
            unsafe { GetLastError() }
        )));
    }
    let applied = unsafe {
        SetFileSecurityW(
            wide_path.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        )
    };
    let error = if applied == 0 {
        Some(unsafe { GetLastError() })
    } else {
        None
    };
    unsafe {
        LocalFree(descriptor);
    }
    error.map_or(Ok(()), |code| {
        Err(RuntimeContractError::Security(format!(
            "apply owner-only DACL: Windows error {code}"
        )))
    })
}

#[cfg(windows)]
fn current_process_sid() -> Result<String, RuntimeContractError> {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, LocalFree, HANDLE},
        Security::{
            Authorization::ConvertSidToStringSidW, GetTokenInformation, TokenUser, TOKEN_QUERY,
            TOKEN_USER,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };

    let mut token: HANDLE = ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(RuntimeContractError::Security(format!(
            "open current process token: Windows error {}",
            unsafe { GetLastError() }
        )));
    }
    let result = (|| {
        let mut length = 0;
        unsafe {
            GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut length);
        }
        if length == 0 {
            return Err(RuntimeContractError::Security(format!(
                "size current process token: Windows error {}",
                unsafe { GetLastError() }
            )));
        }
        let mut buffer = vec![0u8; length as usize];
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                length,
                &mut length,
            )
        } == 0
        {
            return Err(RuntimeContractError::Security(format!(
                "read current process token: Windows error {}",
                unsafe { GetLastError() }
            )));
        }
        let user = unsafe { &*(buffer.as_ptr().cast::<TOKEN_USER>()) };
        let mut string_sid = ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut string_sid) } == 0 {
            return Err(RuntimeContractError::Security(format!(
                "format current process SID: Windows error {}",
                unsafe { GetLastError() }
            )));
        }
        let mut string_length = 0;
        while unsafe { *string_sid.add(string_length) } != 0 {
            string_length += 1;
        }
        let sid =
            String::from_utf16(unsafe { std::slice::from_raw_parts(string_sid, string_length) })
                .map_err(|error| RuntimeContractError::Security(error.to_string()));
        unsafe {
            LocalFree(string_sid.cast());
        }
        sid
    })();
    unsafe {
        CloseHandle(token);
    }
    result
}
