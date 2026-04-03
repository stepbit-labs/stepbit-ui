use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use parking_lot::Mutex;
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::sync::broadcast;
use uuid::Uuid;

const STEPBIT_MARKER_PREFIX: &[u8] = b"\x1b]633;P;";
const STEPBIT_MARKER_SUFFIX: u8 = b'\x07';

#[derive(Debug, thiserror::Error)]
pub enum TerminalError {
    #[error("invalid working directory")]
    InvalidWorkingDirectory,
    #[error("failed to start shell: {0}")]
    Spawn(String),
    #[error("terminal session not found")]
    SessionNotFound,
    #[error("terminal session token mismatch")]
    InvalidSessionToken,
    #[error("failed to write to shell: {0}")]
    Input(String),
    #[error("failed to resize shell: {0}")]
    Resize(String),
    #[error("failed to terminate shell: {0}")]
    Terminate(String),
}

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
    shell_api_base_url: String,
}

pub struct TerminalSession {
    pub id: String,
    pub initial_cwd: String,
    pub shell_api_base_url: String,
    token: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
    output: Mutex<Vec<u8>>,
    current_cwd: Mutex<String>,
    pending_workspace_event: Mutex<Option<TerminalWorkspaceEvent>>,
    broadcaster: broadcast::Sender<TerminalRealtimeEvent>,
    is_closed: AtomicBool,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionRecord {
    pub id: String,
    pub cwd: String,
    pub session_token: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWorkspaceEvent {
    pub workspace_id: String,
    pub workspace_name: String,
    pub root_path: String,
    pub indexing_started: bool,
    pub already_registered: bool,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputChunk {
    pub cursor: usize,
    pub output: String,
    pub cwd: String,
    pub workspace_event: Option<TerminalWorkspaceEvent>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRealtimeEvent {
    pub output: String,
    pub cwd: String,
    pub workspace_event: Option<TerminalWorkspaceEvent>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TerminalMarkerUpdate {
    pub cwd: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TerminalOutputProcessor {
    tail: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessedTerminalOutput {
    pub display: Vec<u8>,
    pub update: TerminalMarkerUpdate,
}

impl TerminalManager {
    pub fn new(shell_api_base_url: String) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            shell_api_base_url: shell_api_base_url.trim_end_matches('/').to_string(),
        }
    }

    pub async fn create_session(
        &self,
        cwd: Option<String>,
    ) -> Result<TerminalSessionRecord, TerminalError> {
        let cwd = cwd.unwrap_or_else(default_terminal_cwd);
        let cwd_path = Path::new(&cwd);
        if !cwd_path.exists() || !cwd_path.is_dir() {
            return Err(TerminalError::InvalidWorkingDirectory);
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 40,
                cols: 140,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| TerminalError::Spawn(error.to_string()))?;

        let mut command = CommandBuilder::new("/bin/zsh");
        command.cwd(cwd_path);
        command.env("TERM", "xterm-256color");
        command.arg("-i");

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| TerminalError::Spawn(error.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|error| TerminalError::Spawn(error.to_string()))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| TerminalError::Spawn(error.to_string()))?;

        let session = Arc::new(TerminalSession {
            id: format!("term-{}", Uuid::new_v4()),
            initial_cwd: cwd.clone(),
            shell_api_base_url: self.shell_api_base_url.clone(),
            token: Uuid::new_v4().to_string(),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            output: Mutex::new(Vec::new()),
            current_cwd: Mutex::new(cwd.clone()),
            pending_workspace_event: Mutex::new(None),
            broadcaster: broadcast::channel(256).0,
            is_closed: AtomicBool::new(false),
        });

        spawn_reader(reader, session.clone());
        session.bootstrap_shell()?;

        self.sessions
            .lock()
            .insert(session.id.clone(), session.clone());

        Ok(TerminalSessionRecord {
            id: session.id.clone(),
            cwd,
            session_token: session.token.clone(),
        })
    }

    pub fn authorize_session_token(&self, session_id: &str, token: &str) -> bool {
        self.sessions
            .lock()
            .get(session_id)
            .map(|session| !session.is_closed.load(Ordering::Relaxed) && session.token == token)
            .unwrap_or(false)
    }

    pub fn record_workspace_loaded(
        &self,
        session_id: &str,
        event: TerminalWorkspaceEvent,
    ) -> Result<(), TerminalError> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or(TerminalError::SessionNotFound)?;
        *session.pending_workspace_event.lock() = Some(event.clone());
        let _ = session.broadcaster.send(TerminalRealtimeEvent {
            output: String::new(),
            cwd: session.current_cwd.lock().clone(),
            workspace_event: Some(event),
        });
        Ok(())
    }

    pub fn subscribe(
        &self,
        session_id: &str,
        token: &str,
    ) -> Result<broadcast::Receiver<TerminalRealtimeEvent>, TerminalError> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or(TerminalError::SessionNotFound)?;

        if session.token != token || session.is_closed.load(Ordering::Relaxed) {
            return Err(TerminalError::InvalidSessionToken);
        }

        Ok(session.broadcaster.subscribe())
    }

    pub fn read_output(
        &self,
        session_id: &str,
        cursor: usize,
    ) -> Result<TerminalOutputChunk, TerminalError> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or(TerminalError::SessionNotFound)?;
        let output = session.output.lock();
        let bounded_cursor = cursor.min(output.len());
        let cwd = session.current_cwd.lock().clone();
        let workspace_event = session.pending_workspace_event.lock().take();
        Ok(TerminalOutputChunk {
            cursor: output.len(),
            output: String::from_utf8_lossy(&output[bounded_cursor..]).to_string(),
            cwd,
            workspace_event,
        })
    }

    pub async fn send_input(&self, session_id: &str, input: &str) -> Result<(), TerminalError> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or(TerminalError::SessionNotFound)?;
        session.write_to_shell(input.as_bytes())
    }

    pub async fn interrupt(&self, session_id: &str) -> Result<(), TerminalError> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or(TerminalError::SessionNotFound)?;
        session.write_to_shell(&[3])
    }

    pub async fn close_session(&self, session_id: &str) -> Result<(), TerminalError> {
        let session = self
            .sessions
            .lock()
            .remove(session_id)
            .ok_or(TerminalError::SessionNotFound)?;
        session.is_closed.store(true, Ordering::Relaxed);
        let mut child = session.child.lock();
        child
            .kill()
            .map_err(|error| TerminalError::Terminate(error.to_string()))?;
        Ok(())
    }

    pub async fn resize_session(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), TerminalError> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or(TerminalError::SessionNotFound)?;

        let master = session.master.lock();
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| TerminalError::Resize(error.to_string()))
    }

    #[cfg(test)]
    pub fn debug_token(&self, session_id: &str) -> Option<String> {
        self.sessions
            .lock()
            .get(session_id)
            .map(|session| session.token.clone())
    }
}

impl TerminalSession {
    fn bootstrap_shell(&self) -> Result<(), TerminalError> {
        let script = build_shell_bootstrap_script(
            &self.id,
            &self.token,
            &self.shell_api_base_url,
        );
        self.write_to_shell(script.as_bytes())
    }

    fn write_to_shell(&self, bytes: &[u8]) -> Result<(), TerminalError> {
        let mut writer = self.writer.lock();
        writer
            .write_all(bytes)
            .map_err(|error| TerminalError::Input(error.to_string()))?;
        writer
            .flush()
            .map_err(|error| TerminalError::Input(error.to_string()))
    }
}

impl TerminalOutputProcessor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn process_chunk(&mut self, chunk: &[u8]) -> ProcessedTerminalOutput {
        let mut data = std::mem::take(&mut self.tail);
        data.extend_from_slice(chunk);

        let mut display = Vec::with_capacity(data.len());
        let mut update = TerminalMarkerUpdate::default();
        let mut index = 0;

        while index < data.len() {
            if let Some(relative_start) = find_marker_start(&data[index..]) {
                let start = index + relative_start;
                display.extend_from_slice(&data[index..start]);

                match find_marker_end(&data[start..]) {
                    Some(relative_end) => {
                        let marker_end = start + relative_end;
                        if let Some(marker) = parse_marker_payload(
                            &data[start + STEPBIT_MARKER_PREFIX.len()..marker_end],
                        ) {
                            if let Some(cwd) = marker.cwd {
                                update.cwd = Some(cwd);
                            }
                        } else {
                            display.extend_from_slice(&data[start..=marker_end]);
                        }
                        index = marker_end + 1;
                    }
                    None => {
                        self.tail.extend_from_slice(&data[start..]);
                        index = data.len();
                    }
                }
            } else {
                display.extend_from_slice(&data[index..]);
                index = data.len();
            }
        }

        ProcessedTerminalOutput { display, update }
    }
}

pub fn build_shell_bootstrap_script(session_id: &str, token: &str, api_base_url: &str) -> String {
    format!(
        concat!(
            "export STEPBIT_TERMINAL_SESSION_ID='{session_id}'\r",
            "export STEPBIT_TERMINAL_TOKEN='{token}'\r",
            "export STEPBIT_TERMINAL_API_BASE='{api_base_url}'\r",
            "export PS1='%~ %# '\r",
            "autoload -Uz add-zsh-hook >/dev/null 2>&1\r",
            "__stepbit_emit_cwd() {{ local __stepbit_cwd; __stepbit_cwd=$(printf '%s' \"$PWD\" | /usr/bin/base64 | tr -d '\\n'); printf '\\033]633;P;Cwd=%s\\a' \"$__stepbit_cwd\"; }}\r",
            "__stepbit_resolve_path() {{ local target=\"$1\"; local resolved; if [[ -z \"$target\" || \"$target\" == \".\" ]]; then resolved=\"$PWD\"; else resolved=\"$target\"; fi; if [[ \"$resolved\" != /* ]]; then resolved=\"$PWD/$resolved\"; fi; builtin cd \"$resolved\" >/dev/null 2>&1 && pwd -P; }}\r",
            "stepbit() {{ local target=\"${{1:-.}}\"; local resolved; resolved=$(__stepbit_resolve_path \"$target\") || {{ print -u2 -- \"stepbit: path not found: $target\"; return 1; }}; local response; response=$(curl -fsS -X POST \"$STEPBIT_TERMINAL_API_BASE/api/terminal/sessions/$STEPBIT_TERMINAL_SESSION_ID/workspace-load\" -H \"x-stepbit-terminal-token: $STEPBIT_TERMINAL_TOKEN\" -H 'content-type: application/json' -d \"{{\\\"path\\\":\\\"$resolved\\\"}}\") || {{ print -u2 -- \"stepbit: failed to load workspace\"; return 1; }}; local workspace_id=\"\" workspace_name=\"\" workspace_root=\"\" indexing_started=\"0\" already_registered=\"0\"; while IFS='=' read -r key value; do case \"$key\" in WORKSPACE_ID) workspace_id=\"$value\" ;; WORKSPACE_NAME) workspace_name=\"$value\" ;; WORKSPACE_ROOT) workspace_root=\"$value\" ;; INDEXING_STARTED) indexing_started=\"$value\" ;; ALREADY_REGISTERED) already_registered=\"$value\" ;; esac; done <<< \"$response\"; if [[ -z \"$workspace_name\" ]]; then workspace_name=\"workspace\"; fi; if [[ \"$already_registered\" == \"1\" ]]; then print -- \"[stepbit] switched to $workspace_name ($workspace_root)\"; else print -- \"[stepbit] loaded $workspace_name ($workspace_root)\"; fi; if [[ \"$indexing_started\" == \"1\" ]]; then print -- \"[stepbit] indexing started in background\"; fi; }}\r",
            "workspace() {{ if [[ \"$1\" == \"load\" || -z \"$1\" ]]; then shift 2>/dev/null || true; stepbit \"${{1:-.}}\"; else print -u2 -- 'usage: workspace load [path]'; return 1; fi; }}\r",
            "add-zsh-hook precmd __stepbit_emit_cwd\r",
            "add-zsh-hook chpwd __stepbit_emit_cwd\r",
            "__stepbit_emit_cwd\r"
        ),
        session_id = escape_single_quotes(session_id),
        token = escape_single_quotes(token),
        api_base_url = escape_single_quotes(api_base_url),
    )
    .replace("\\r", "\r")
}

fn default_terminal_cwd() -> String {
    std::env::current_dir()
        .ok()
        .map(|path| path.display().to_string())
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| ".".to_string())
}

fn escape_single_quotes(value: &str) -> String {
    value.replace('\'', "'\\''")
}

fn spawn_reader(mut reader: Box<dyn Read + Send>, session: Arc<TerminalSession>) {
    thread::spawn(move || {
        let mut processor = TerminalOutputProcessor::new();
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let processed = processor.process_chunk(&buffer[..read]);
                    if let Some(cwd) = processed.update.cwd {
                        *session.current_cwd.lock() = cwd;
                    }
                    if !processed.display.is_empty() {
                        session.output.lock().extend_from_slice(&processed.display);
                        let output = String::from_utf8_lossy(&processed.display).to_string();
                        let _ = session.broadcaster.send(TerminalRealtimeEvent {
                            output,
                            cwd: session.current_cwd.lock().clone(),
                            workspace_event: None,
                        });
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn find_marker_start(bytes: &[u8]) -> Option<usize> {
    bytes
        .windows(STEPBIT_MARKER_PREFIX.len())
        .position(|window| window == STEPBIT_MARKER_PREFIX)
}

fn find_marker_end(bytes: &[u8]) -> Option<usize> {
    bytes.iter().position(|byte| *byte == STEPBIT_MARKER_SUFFIX)
}

fn parse_marker_payload(bytes: &[u8]) -> Option<TerminalMarkerUpdate> {
    let text = String::from_utf8(bytes.to_vec()).ok()?;
    let encoded = text.strip_prefix("Cwd=")?;
    let cwd = STANDARD.decode(encoded).ok()?;
    Some(TerminalMarkerUpdate {
        cwd: String::from_utf8(cwd).ok(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_bootstrap_contains_stepbit_function_and_session_vars() {
        let script = build_shell_bootstrap_script("term-1", "token-1", "http://127.0.0.1:8080");
        assert!(script.contains("STEPBIT_TERMINAL_SESSION_ID='term-1'"));
        assert!(script.contains("STEPBIT_TERMINAL_TOKEN='token-1'"));
        assert!(script.contains("stepbit()"));
        assert!(script.contains("workspace()"));
        assert!(script.contains("/api/terminal/sessions/$STEPBIT_TERMINAL_SESSION_ID/workspace-load"));
    }

    #[test]
    fn terminal_output_processor_strips_cwd_markers() {
        let mut processor = TerminalOutputProcessor::new();
        let encoded = STANDARD.encode("/tmp/repo");
        let input = format!("hello\x1b]633;P;Cwd={encoded}\x07world");
        let processed = processor.process_chunk(input.as_bytes());

        assert_eq!(String::from_utf8(processed.display).unwrap(), "helloworld");
        assert_eq!(processed.update.cwd.as_deref(), Some("/tmp/repo"));
    }

    #[test]
    fn terminal_output_processor_handles_split_markers() {
        let mut processor = TerminalOutputProcessor::new();
        let encoded = STANDARD.encode("/tmp/repo");
        let first = format!("prompt\x1b]633;P;Cwd={}", &encoded[..4]);
        let second = format!("{}\x07next", &encoded[4..]);

        let processed_first = processor.process_chunk(first.as_bytes());
        assert_eq!(String::from_utf8(processed_first.display).unwrap(), "prompt");
        assert_eq!(processed_first.update.cwd, None);

        let processed_second = processor.process_chunk(second.as_bytes());
        assert_eq!(String::from_utf8(processed_second.display).unwrap(), "next");
        assert_eq!(processed_second.update.cwd.as_deref(), Some("/tmp/repo"));
    }
}
