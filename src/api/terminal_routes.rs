use std::fs;
use std::path::Path;
use std::sync::Arc;

use actix_web::{HttpRequest, delete, get, post, web, HttpResponse, Result as WebResult};
use serde::Deserialize;
use uuid::Uuid;

use crate::memory::{MemoryClient, WorkspaceRegistrationRequest};
use crate::terminal::{TerminalError, TerminalManager, TerminalWorkspaceEvent};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalSessionRequest {
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputRequest {
    pub input: String,
}

#[derive(Debug, Deserialize)]
pub struct TerminalOutputQuery {
    pub cursor: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWorkspaceLoadRequest {
    pub path: String,
    pub index: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, serde::Serialize)]
struct ErrorResponse {
    error: ErrorPayload,
}

#[derive(Debug, serde::Serialize)]
struct ErrorPayload {
    code: String,
    message: String,
}

#[post("/sessions")]
pub async fn create_terminal_session(
    manager: web::Data<Arc<TerminalManager>>,
    req: web::Json<CreateTerminalSessionRequest>,
) -> WebResult<HttpResponse> {
    match manager.create_session(req.cwd.clone()).await {
        Ok(session) => Ok(HttpResponse::Created().json(session)),
        Err(error) => Ok(map_terminal_error(error)),
    }
}

#[post("/sessions/{session_id}/workspace-load")]
pub async fn load_terminal_workspace(
    req: HttpRequest,
    manager: web::Data<Arc<TerminalManager>>,
    memory: web::Data<Option<Arc<MemoryClient>>>,
    session_id: web::Path<String>,
    payload: web::Json<TerminalWorkspaceLoadRequest>,
) -> WebResult<HttpResponse> {
    let Some(client) = memory.get_ref().as_ref().cloned() else {
        return Ok(HttpResponse::ServiceUnavailable().body("ERROR=stepbit-memory is not configured\n"));
    };

    let session_id = session_id.into_inner();
    let Some(token) = req
        .headers()
        .get("x-stepbit-terminal-token")
        .and_then(|value| value.to_str().ok())
    else {
        return Ok(map_terminal_error(TerminalError::InvalidSessionToken));
    };

    if !manager.authorize_session_token(&session_id, token) {
        return Ok(map_terminal_error(TerminalError::InvalidSessionToken));
    }

    let root_path = match normalize_workspace_root_for_terminal(&payload.path) {
        Ok(path) => path,
        Err(response) => return Ok(response),
    };

    let workspaces = match client.list_workspaces().await {
        Ok(workspaces) => workspaces,
        Err(error) => return Ok(map_memory_error_plain(error)),
    };

    let existing = workspaces
        .into_iter()
        .find(|workspace| workspace_root_matches(&workspace.root_path, &root_path));

    let (workspace, already_registered) = if let Some(workspace) = existing {
        (workspace, true)
    } else {
        let registration = WorkspaceRegistrationRequest {
            id: format!("workspace-{}", Uuid::new_v4()),
            name: derive_workspace_name(&root_path),
            root_path: root_path.clone(),
            vcs_branch: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        match client.register_workspace(&registration).await {
            Ok(workspace) => (workspace, false),
            Err(error) => return Ok(map_memory_error_plain(error)),
        }
    };

    let should_index = payload.index.unwrap_or(false);
    if should_index {
        let workspace_id = workspace.id.clone();
        let client_for_index = client.clone();
        tokio::spawn(async move {
            let _ = client_for_index.index_workspace(&workspace_id).await;
        });
    }

    let manager_ref = manager.get_ref().clone();
    let _ = manager_ref.record_workspace_loaded(
        &session_id,
        TerminalWorkspaceEvent {
            workspace_id: workspace.id.clone(),
            workspace_name: workspace.name.clone(),
            root_path: workspace.root_path.clone(),
            indexing_started: should_index,
            already_registered,
        },
    );

    Ok(HttpResponse::Ok()
        .content_type("text/plain; charset=utf-8")
        .body(format!(
            "WORKSPACE_ID={}\nWORKSPACE_NAME={}\nWORKSPACE_ROOT={}\nINDEXING_STARTED={}\nALREADY_REGISTERED={}\n",
            workspace.id,
            workspace.name,
            workspace.root_path,
            if should_index { 1 } else { 0 },
            if already_registered { 1 } else { 0 }
        )))
}

#[get("/sessions/{session_id}/output")]
pub async fn read_terminal_output(
    manager: web::Data<Arc<TerminalManager>>,
    session_id: web::Path<String>,
    query: web::Query<TerminalOutputQuery>,
) -> WebResult<HttpResponse> {
    match manager.read_output(&session_id, query.cursor.unwrap_or(0)) {
        Ok(chunk) => Ok(HttpResponse::Ok().json(chunk)),
        Err(error) => Ok(map_terminal_error(error)),
    }
}

#[post("/sessions/{session_id}/input")]
pub async fn send_terminal_input(
    manager: web::Data<Arc<TerminalManager>>,
    session_id: web::Path<String>,
    req: web::Json<TerminalInputRequest>,
) -> WebResult<HttpResponse> {
    match manager.send_input(&session_id, &req.input).await {
        Ok(()) => Ok(HttpResponse::Accepted().finish()),
        Err(error) => Ok(map_terminal_error(error)),
    }
}

#[post("/sessions/{session_id}/interrupt")]
pub async fn interrupt_terminal(
    manager: web::Data<Arc<TerminalManager>>,
    session_id: web::Path<String>,
) -> WebResult<HttpResponse> {
    match manager.interrupt(&session_id).await {
        Ok(()) => Ok(HttpResponse::Accepted().finish()),
        Err(error) => Ok(map_terminal_error(error)),
    }
}

#[post("/sessions/{session_id}/resize")]
pub async fn resize_terminal(
    manager: web::Data<Arc<TerminalManager>>,
    session_id: web::Path<String>,
    req: web::Json<TerminalResizeRequest>,
) -> WebResult<HttpResponse> {
    let rows = req.rows.max(2);
    let cols = req.cols.max(10);
    match manager.resize_session(&session_id, cols, rows).await {
        Ok(()) => Ok(HttpResponse::Accepted().finish()),
        Err(error) => Ok(map_terminal_error(error)),
    }
}

#[delete("/sessions/{session_id}")]
pub async fn close_terminal_session(
    manager: web::Data<Arc<TerminalManager>>,
    session_id: web::Path<String>,
) -> WebResult<HttpResponse> {
    match manager.close_session(&session_id).await {
        Ok(()) => Ok(HttpResponse::NoContent().finish()),
        Err(error) => Ok(map_terminal_error(error)),
    }
}

fn map_terminal_error(error: TerminalError) -> HttpResponse {
    let (status, code) = match error {
        TerminalError::InvalidWorkingDirectory => (actix_web::http::StatusCode::BAD_REQUEST, "invalid_cwd"),
        TerminalError::SessionNotFound => (actix_web::http::StatusCode::NOT_FOUND, "session_not_found"),
        TerminalError::InvalidSessionToken => (actix_web::http::StatusCode::UNAUTHORIZED, "invalid_session_token"),
        TerminalError::Spawn(_) => (actix_web::http::StatusCode::BAD_GATEWAY, "spawn_failed"),
        TerminalError::Input(_) | TerminalError::Resize(_) | TerminalError::Terminate(_) => {
            (actix_web::http::StatusCode::BAD_GATEWAY, "terminal_io_error")
        }
    };

    HttpResponse::build(status).json(ErrorResponse {
        error: ErrorPayload {
            code: code.to_string(),
            message: error.to_string(),
        },
    })
}

fn normalize_workspace_root_for_terminal(path: &str) -> Result<String, HttpResponse> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(HttpResponse::BadRequest().body("ERROR=path is required\n"));
    }

    let canonical = fs::canonicalize(trimmed)
        .map_err(|error| HttpResponse::BadRequest().body(format!("ERROR=invalid path: {error}\n")))?;
    if !canonical.is_dir() {
        return Err(HttpResponse::BadRequest().body("ERROR=path must be a directory\n"));
    }

    Ok(canonical.display().to_string())
}

fn derive_workspace_name(root_path: &str) -> String {
    Path::new(root_path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "workspace".to_string())
}

fn workspace_root_matches(record_root: &str, target_root: &str) -> bool {
    if record_root == target_root {
        return true;
    }

    fs::canonicalize(record_root)
        .ok()
        .map(|canonical| canonical.display().to_string() == target_root)
        .unwrap_or(false)
}

fn map_memory_error_plain(error: crate::memory::MemoryError) -> HttpResponse {
    HttpResponse::BadGateway()
        .content_type("text/plain; charset=utf-8")
        .body(format!("ERROR={error}\n"))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/terminal")
            .service(create_terminal_session)
            .service(load_terminal_workspace)
            .service(read_terminal_output)
            .service(send_terminal_input)
            .service(interrupt_terminal)
            .service(resize_terminal)
            .service(close_terminal_session),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{App, http::StatusCode, test};
    use crate::memory::MemoryClient;
    use crate::terminal::TerminalManager;
    use std::sync::Arc;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn app(
        memory_client: Option<Arc<MemoryClient>>,
        terminal_manager: Arc<TerminalManager>,
    ) -> App<
        impl actix_web::dev::ServiceFactory<
            actix_web::dev::ServiceRequest,
            Config = (),
            Response = actix_web::dev::ServiceResponse,
            Error = actix_web::Error,
            InitError = (),
        >,
    > {
        App::new()
            .app_data(web::Data::new(memory_client))
            .app_data(web::Data::new(terminal_manager))
            .service(web::scope("/api").configure(configure))
    }

    #[actix_web::test]
    async fn workspace_load_uses_terminal_session_token_and_records_event() {
        let mock = MockServer::start().await;
        let temp_dir = std::env::temp_dir().join(format!("stepbit-ui-terminal-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let root_path = temp_dir.display().to_string();

        Mock::given(method("GET"))
            .and(path("/v1/workspaces"))
            .respond_with(ResponseTemplate::new(200).set_body_json(Vec::<serde_json::Value>::new()))
            .mount(&mock)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/workspaces"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "ws-1",
                "name": temp_dir.file_name().unwrap().to_string_lossy(),
                "rootPath": root_path,
                "vcsBranch": null,
                "lastScanAt": null,
                "lastIndexAt": null,
                "createdAt": "2026-04-02T10:00:00Z",
                "updatedAt": "2026-04-02T10:00:00Z"
            })))
            .mount(&mock)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/workspaces/ws-1/index"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "workspaceId": "ws-1",
                "filesDiscovered": 0,
                "filesIndexed": 0,
                "filesSkippedUnchanged": 0,
                "filesSkippedFiltered": 0,
                "chunksWritten": 0
            })))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let manager = Arc::new(TerminalManager::new("http://127.0.0.1:8080".to_string()));
        let session = manager.create_session(Some(root_path.clone())).await.unwrap();
        let token = manager.debug_token(&session.id).unwrap();
        let app = test::init_service(app(Some(client), manager.clone())).await;

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/terminal/sessions/{}/workspace-load", session.id))
                .insert_header(("x-stepbit-terminal-token", token))
                .set_json(serde_json::json!({ "path": root_path }))
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let body = test::read_body(resp).await;
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(text.contains("WORKSPACE_ID=ws-1"));

        let chunk = manager.read_output(&session.id, 0).unwrap();
        assert_eq!(chunk.workspace_event.unwrap().workspace_id, "ws-1");

        manager.close_session(&session.id).await.unwrap();
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[actix_web::test]
    async fn workspace_load_reuses_existing_workspace_without_registering_again() {
        let mock = MockServer::start().await;
        let temp_dir = std::env::temp_dir().join(format!("stepbit-ui-terminal-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let root_path = temp_dir.display().to_string();

        Mock::given(method("GET"))
            .and(path("/v1/workspaces"))
            .respond_with(ResponseTemplate::new(200).set_body_json(vec![serde_json::json!({
                "id": "ws-existing",
                "name": temp_dir.file_name().unwrap().to_string_lossy(),
                "rootPath": root_path,
                "vcsBranch": null,
                "lastScanAt": null,
                "lastIndexAt": null,
                "createdAt": "2026-04-02T10:00:00Z",
                "updatedAt": "2026-04-02T10:00:00Z"
            })]))
            .mount(&mock)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/workspaces/ws-existing/index"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "workspaceId": "ws-existing",
                "filesDiscovered": 0,
                "filesIndexed": 0,
                "filesSkippedUnchanged": 0,
                "filesSkippedFiltered": 0,
                "chunksWritten": 0
            })))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let manager = Arc::new(TerminalManager::new("http://127.0.0.1:8080".to_string()));
        let session = manager.create_session(Some(root_path.clone())).await.unwrap();
        let token = manager.debug_token(&session.id).unwrap();
        let app = test::init_service(app(Some(client), manager.clone())).await;

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/terminal/sessions/{}/workspace-load", session.id))
                .insert_header(("x-stepbit-terminal-token", token))
                .set_json(serde_json::json!({ "path": root_path }))
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let body = test::read_body(resp).await;
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(text.contains("ALREADY_REGISTERED=1"));

        manager.close_session(&session.id).await.unwrap();
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
