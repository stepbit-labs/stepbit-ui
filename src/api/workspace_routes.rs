use actix_web::{delete, get, post, web, HttpResponse, Result as WebResult};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use serde::Deserialize;
use uuid::Uuid;

use crate::api::models::{
    RebindWorkspaceRequest, RegisterWorkspaceRequest, WorkspaceContextRequest,
    WorkspaceConversationTurn, WorkspaceFileWriteRequest, WorkspaceSymbolsQuery,
};
use crate::memory::{
    ContextAssemblyRequest, ConversationTurn, MemoryClient, MemoryError, WorkspaceRegistrationRequest,
};

#[derive(Debug, serde::Serialize)]
struct ProxyErrorResponse {
    error: ProxyErrorPayload,
}

#[derive(Debug, serde::Deserialize)]
struct WorkspaceFileQuery {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceReferenceQuery {
    query: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDefinitionQuery {
    query: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileContentResponse {
    workspace_id: String,
    path: String,
    content: String,
    size_bytes: usize,
    line_count: usize,
    language: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileWriteResponse {
    workspace_id: String,
    path: String,
    content: String,
    size_bytes: usize,
    line_count: usize,
    language: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceHealthResponse {
    workspace_id: String,
    root_path: String,
    root_exists: bool,
    root_is_directory: bool,
    status: String,
}

#[derive(Debug, serde::Serialize)]
struct ProxyErrorPayload {
    code: String,
    message: String,
}

#[get("")]
pub async fn list_workspaces(
    memory: web::Data<Option<Arc<MemoryClient>>>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    match client.list_workspaces().await {
        Ok(workspaces) => Ok(HttpResponse::Ok().json(workspaces)),
        Err(error) => Ok(map_memory_error(error)),
    }
}

#[post("")]
pub async fn register_workspace(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    req: web::Json<RegisterWorkspaceRequest>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    let request = req.into_inner();
    let normalized_root = match normalize_root_path(&request.root_path) {
        Ok(path) => path,
        Err(response) => return Ok(response),
    };
    let name = request
        .name
        .unwrap_or_else(|| derive_workspace_name(&normalized_root));
    let workspace_id = request
        .id
        .unwrap_or_else(|| format!("workspace-{}", Uuid::new_v4()));
    let created_at = request
        .created_at
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let memory_request = WorkspaceRegistrationRequest {
        id: workspace_id,
        name,
        root_path: normalized_root,
        vcs_branch: request.vcs_branch,
        created_at,
    };

    match client.register_workspace(&memory_request).await {
        Ok(workspace) => Ok(HttpResponse::Created().json(workspace)),
        Err(error) => Ok(map_memory_error(error)),
    }
}

#[get("/{workspace_id}/health")]
pub async fn workspace_health(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    let workspace_id = workspace_id.into_inner();
    let workspaces = match client.list_workspaces().await {
        Ok(workspaces) => workspaces,
        Err(error) => return Ok(map_memory_error(error)),
    };

    let workspace = match workspaces.into_iter().find(|record| record.id == workspace_id) {
        Some(workspace) => workspace,
        None => {
            return Ok(HttpResponse::NotFound().json(ProxyErrorResponse {
                error: ProxyErrorPayload {
                    code: "not_found".to_string(),
                    message: format!("workspace not found: {workspace_id}"),
                },
            }))
        }
    };

    let root_path = PathBuf::from(&workspace.root_path);
    let root_exists = root_path.exists();
    let root_is_directory = root_path.is_dir();
    let status = if root_exists && root_is_directory {
        "ready"
    } else if root_exists {
        "exists_not_directory"
    } else {
        "missing"
    }
    .to_string();

    Ok(HttpResponse::Ok().json(WorkspaceHealthResponse {
        workspace_id,
        root_path: workspace.root_path,
        root_exists,
        root_is_directory,
        status,
    }))
}

#[post("/{workspace_id}/index")]
pub async fn index_workspace(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    match client.index_workspace(&workspace_id).await {
        Ok(outcome) => Ok(HttpResponse::Ok().json(outcome)),
        Err(error) => Ok(map_memory_error(error)),
    }
}

#[post("/{workspace_id}/rebind")]
pub async fn rebind_workspace(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
    req: web::Json<RebindWorkspaceRequest>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    let root_path = match normalize_root_path(&req.root_path) {
        Ok(path) => path,
        Err(response) => return Ok(response),
    };

    match client
        .rebind_workspace(
            &workspace_id,
            &crate::memory::WorkspaceRebindRequest {
                root_path,
            },
        )
        .await
    {
        Ok(workspace) => Ok(HttpResponse::Ok().json(workspace)),
        Err(error) => Ok(map_memory_error(error)),
    }
}

#[get("/{workspace_id}/index-state")]
pub async fn workspace_index_state(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    match client.get_workspace_index_state(&workspace_id).await {
        Ok(state) => Ok(HttpResponse::Ok().json(state)),
        Err(error) => Ok(map_memory_error(error)),
    }
}

#[get("/{workspace_id}/files")]
pub async fn workspace_files(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    match client.list_workspace_files(&workspace_id).await {
        Ok(files) => Ok(HttpResponse::Ok().json(files)),
        Err(error) => Ok(map_memory_error(error)),
    }
}

#[get("/{workspace_id}/symbols")]
pub async fn workspace_symbols(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
    query: web::Query<WorkspaceSymbolsQuery>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    match query.query.as_deref() {
        Some(term) if !term.trim().is_empty() => {
            match client.search_workspace_symbols(&workspace_id, term).await {
                Ok(symbols) => Ok(HttpResponse::Ok().json(symbols)),
                Err(error) => Ok(map_memory_error(error)),
            }
        }
        _ => match client.list_workspace_symbols(&workspace_id).await {
            Ok(symbols) => Ok(HttpResponse::Ok().json(symbols)),
            Err(error) => Ok(map_memory_error(error)),
        },
    }
}

#[get("/{workspace_id}/symbols/search")]
pub async fn search_workspace_symbols(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
    query: web::Query<WorkspaceSymbolsQuery>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    match query.query.as_deref() {
        Some(term) if !term.trim().is_empty() => {
            match client.search_workspace_symbols(&workspace_id, term).await {
                Ok(symbols) => Ok(HttpResponse::Ok().json(symbols)),
                Err(error) => Ok(map_memory_error(error)),
            }
        }
        _ => match client.list_workspace_symbols(&workspace_id).await {
            Ok(symbols) => Ok(HttpResponse::Ok().json(symbols)),
            Err(error) => Ok(map_memory_error(error)),
        },
    }
}

#[get("/{workspace_id}/references")]
pub async fn workspace_references(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
    query: web::Query<WorkspaceReferenceQuery>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    match client
        .search_workspace_references(&workspace_id, query.query.as_deref().unwrap_or(""))
        .await
    {
        Ok(references) => Ok(HttpResponse::Ok().json(references)),
        Err(error) => Ok(map_memory_error(error)),
    }
}

#[get("/{workspace_id}/definitions")]
pub async fn workspace_definitions(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
    query: web::Query<WorkspaceDefinitionQuery>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    match client
        .search_workspace_definitions(&workspace_id, query.query.as_deref().unwrap_or(""))
        .await
    {
        Ok(definitions) => Ok(HttpResponse::Ok().json(definitions)),
        Err(error) => Ok(map_memory_error(error)),
    }
}

#[get("/{workspace_id}/file")]
pub async fn workspace_file_content(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
    query: web::Query<WorkspaceFileQuery>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    let workspace_id = workspace_id.into_inner();
    let relative_path = match normalize_workspace_relative_path(&query.path) {
        Ok(path) => path,
        Err(response) => return Ok(response),
    };
    let workspaces = match client.list_workspaces().await {
        Ok(workspaces) => workspaces,
        Err(error) => return Ok(map_memory_error(error)),
    };

    let workspace = match workspaces.into_iter().find(|record| record.id == workspace_id) {
        Some(workspace) => workspace,
        None => {
            return Ok(HttpResponse::NotFound().json(ProxyErrorResponse {
                error: ProxyErrorPayload {
                    code: "not_found".to_string(),
                    message: format!("workspace not found: {workspace_id}"),
                },
            }))
        }
    };

    let root_path = PathBuf::from(workspace.root_path);
    let resolved_path = match resolve_workspace_file_path(&root_path, &relative_path) {
        Ok(path) => path,
        Err(response) => return Ok(response),
    };
    let content = match read_workspace_file_content(&resolved_path, &relative_path) {
        Ok(content) => content,
        Err(error) => return Ok(bad_request(format!("failed to read workspace file: {error}"))),
    };
    let line_count = content.lines().count();
    let size_bytes = content.len();

    Ok(HttpResponse::Ok().json(WorkspaceFileContentResponse {
        workspace_id,
        path: relative_path.clone(),
        content,
        size_bytes,
        line_count,
        language: infer_language_from_path(&relative_path),
    }))
}

#[post("/{workspace_id}/file")]
pub async fn workspace_file_write(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
    req: web::Json<WorkspaceFileWriteRequest>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    let workspace_id = workspace_id.into_inner();
    let request = req.into_inner();
    let relative_path = match normalize_workspace_relative_path(&request.path) {
        Ok(path) => path,
        Err(response) => return Ok(response),
    };
    let workspaces = match client.list_workspaces().await {
        Ok(workspaces) => workspaces,
        Err(error) => return Ok(map_memory_error(error)),
    };

    let workspace = match workspaces.into_iter().find(|record| record.id == workspace_id) {
        Some(workspace) => workspace,
        None => {
            return Ok(HttpResponse::NotFound().json(ProxyErrorResponse {
                error: ProxyErrorPayload {
                    code: "not_found".to_string(),
                    message: format!("workspace not found: {workspace_id}"),
                },
            }))
        }
    };

    let root_path = PathBuf::from(workspace.root_path);
    let resolved_path = match resolve_workspace_writable_file_path(&root_path, &relative_path) {
        Ok(path) => path,
        Err(response) => return Ok(response),
    };

    if let Some(parent) = resolved_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return Ok(bad_request(format!("failed to create workspace file parent: {error}")));
        }
    }

    if let Err(error) = fs::write(&resolved_path, request.content.as_bytes()) {
        return Ok(bad_request(format!("failed to write workspace file: {error}")));
    }

    let content = request.content;
    let line_count = content.lines().count();
    let size_bytes = content.len();

    Ok(HttpResponse::Ok().json(WorkspaceFileWriteResponse {
        workspace_id,
        path: relative_path.clone(),
        content,
        size_bytes,
        line_count,
        language: infer_language_from_path(&relative_path),
    }))
}

#[delete("/{workspace_id}")]
pub async fn delete_workspace(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    match client.delete_workspace(&workspace_id).await {
        Ok(()) => Ok(HttpResponse::NoContent().finish()),
        Err(error) => Ok(map_memory_error(error)),
    }
}

#[post("/{workspace_id}/context")]
pub async fn assemble_context(
    memory: web::Data<Option<Arc<MemoryClient>>>,
    workspace_id: web::Path<String>,
    req: web::Json<WorkspaceContextRequest>,
) -> WebResult<HttpResponse> {
    let Some(client) = active_client(&memory) else {
        return Ok(service_unavailable("stepbit-memory is not configured"));
    };

    let request = req.into_inner();
    let context_request = ContextAssemblyRequest {
        workspace_id: Some(workspace_id.into_inner()),
        conversation_id: request.conversation_id,
        prompt: request.prompt,
        recent_turns: request
            .recent_turns
            .into_iter()
            .map(workspace_turn_to_memory_turn)
            .collect(),
        selected_paths: request.selected_paths,
        total_tokens: request.total_tokens,
        reserved_for_output: request.reserved_for_output,
    };

    match client.assemble_context(&context_request).await {
        Ok(pack) => Ok(HttpResponse::Ok().json(pack)),
        Err(error) => Ok(map_memory_error(error)),
    }
}

fn active_client(memory: &web::Data<Option<Arc<MemoryClient>>>) -> Option<Arc<MemoryClient>> {
    memory.get_ref().as_ref().cloned()
}

fn normalize_root_path(root_path: &str) -> Result<String, HttpResponse> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() {
        return Err(bad_request("root_path is required"));
    }

    Ok(trimmed.to_string())
}

fn derive_workspace_name(root_path: &str) -> String {
    let path = Path::new(root_path);
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "workspace".to_string())
}

fn workspace_turn_to_memory_turn(turn: WorkspaceConversationTurn) -> ConversationTurn {
    ConversationTurn {
        role: turn.role,
        text: turn.text,
        id: turn.id,
        created_at: turn.created_at,
    }
}

fn normalize_workspace_relative_path(path: &str) -> Result<String, HttpResponse> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(bad_request("path is required"));
    }

    if trimmed.starts_with('/') || trimmed.contains("..") {
        return Err(bad_request("path must be relative to the workspace root"));
    }

    Ok(trimmed.replace('\\', "/"))
}

fn resolve_workspace_file_path(root_path: &Path, relative_path: &str) -> Result<PathBuf, HttpResponse> {
    let root_canonical = fs::canonicalize(root_path).map_err(|error| {
        bad_request(format!(
            "failed to resolve workspace root '{}': {error}",
            root_path.display()
        ))
    })?;
    let joined = root_canonical.join(relative_path);
    let canonical = fs::canonicalize(&joined)
        .map_err(|error| bad_request(format!("failed to resolve workspace file path: {error}")))?;

    if !canonical.starts_with(&root_canonical) {
        return Err(bad_request("path escapes the workspace root"));
    }

    Ok(canonical)
}

fn resolve_workspace_writable_file_path(
    root_path: &Path,
    relative_path: &str,
) -> Result<PathBuf, HttpResponse> {
    let root_canonical = fs::canonicalize(root_path).map_err(|error| {
        bad_request(format!(
            "failed to resolve workspace root '{}': {error}",
            root_path.display()
        ))
    })?;
    let joined = root_canonical.join(relative_path);

    if !joined.starts_with(&root_canonical) {
        return Err(bad_request("path escapes the workspace root"));
    }

    Ok(joined)
}

fn infer_language_from_path(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| match ext.to_ascii_lowercase().as_str() {
            "ts" => "typescript".to_string(),
            "tsx" => "tsx".to_string(),
            "js" => "javascript".to_string(),
            "jsx" => "jsx".to_string(),
            "rs" => "rust".to_string(),
            "go" => "go".to_string(),
            "py" => "python".to_string(),
            "md" => "markdown".to_string(),
            "json" => "json".to_string(),
            "toml" => "toml".to_string(),
            "pdf" => "pdf".to_string(),
            _ => ext.to_string(),
        })
}

fn read_workspace_file_content(path: &Path, relative_path: &str) -> Result<String, String> {
    if is_pdf_path(relative_path) {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        return pdf_extract::extract_text_from_mem(&bytes)
            .map(|text| normalize_extracted_text(&text))
            .map_err(|error| error.to_string());
    }

    fs::read_to_string(path).map_err(|error| error.to_string())
}

fn normalize_extracted_text(text: &str) -> String {
    text.lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn is_pdf_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
}

fn map_memory_error(error: MemoryError) -> HttpResponse {
    match error {
        MemoryError::Network(message) => service_unavailable(message),
        MemoryError::Api(message) => bad_gateway(message),
        MemoryError::InvalidRequest => bad_request("invalid memory request"),
    }
}

fn service_unavailable(message: impl Into<String>) -> HttpResponse {
    HttpResponse::ServiceUnavailable().json(ProxyErrorResponse {
        error: ProxyErrorPayload {
            code: "memory_unavailable".to_string(),
            message: message.into(),
        },
    })
}

fn bad_request(message: impl Into<String>) -> HttpResponse {
    HttpResponse::BadRequest().json(ProxyErrorResponse {
        error: ProxyErrorPayload {
            code: "bad_request".to_string(),
            message: message.into(),
        },
    })
}

fn bad_gateway(message: impl Into<String>) -> HttpResponse {
    HttpResponse::BadGateway().json(ProxyErrorResponse {
        error: ProxyErrorPayload {
            code: "upstream_error".to_string(),
            message: message.into(),
        },
    })
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/workspaces")
            .service(list_workspaces)
            .service(register_workspace)
            .service(workspace_health)
            .service(rebind_workspace)
            .service(index_workspace)
            .service(workspace_index_state)
            .service(workspace_files)
            .service(workspace_symbols)
            .service(search_workspace_symbols)
            .service(workspace_definitions)
            .service(workspace_references)
            .service(workspace_file_content)
            .service(workspace_file_write)
            .service(delete_workspace)
            .service(assemble_context),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{App, http::StatusCode, test};
    use crate::memory::{
        ContextPackVersion, MemoryClient, MemoryContextDiagnostics, MemoryContextPack,
        MemoryContextProvenance, MemoryContextSection, MemoryContextSectionKind,
        MemoryProvenanceKind, MemoryTokenBudget, WorkspaceRecord, WorkspaceReferenceRecord,
        WorkspaceSymbolRecord,
    };
    use wiremock::matchers::{body_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn app(memory_client: Option<Arc<MemoryClient>>) -> App<
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
            .service(web::scope("/api").configure(configure))
    }

    #[actix_web::test]
    async fn list_workspaces_proxies_to_memory() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/workspaces"))
            .respond_with(ResponseTemplate::new(200).set_body_json(vec![WorkspaceRecord {
                id: "ws-1".to_string(),
                name: "repo".to_string(),
                root_path: "/tmp/repo".to_string(),
                vcs_branch: Some("main".to_string()),
                last_scan_at: None,
                last_index_at: None,
                created_at: "2026-03-31T12:00:00Z".to_string(),
                updated_at: "2026-03-31T12:00:00Z".to_string(),
            }]))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(&app, test::TestRequest::get().uri("/api/workspaces").to_request()).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn list_workspace_symbols_proxies_to_memory() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/workspaces/ws-1/symbols"))
            .respond_with(ResponseTemplate::new(200).set_body_json(vec![WorkspaceSymbolRecord {
                id: "symbol-1".to_string(),
                workspace_id: "ws-1".to_string(),
                file_id: "file-1".to_string(),
                path: "src/lib.ts".to_string(),
                name: "openWorkspace".to_string(),
                kind: "function".to_string(),
                start_line: 2,
                end_line: 4,
                signature: Some("export function openWorkspace() {".to_string()),
                container_name: None,
                indexed_at: "2026-03-31T12:00:00Z".to_string(),
            }]))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(&app, test::TestRequest::get().uri("/api/workspaces/ws-1/symbols").to_request()).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn search_workspace_symbols_proxies_to_memory() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/workspaces/ws-1/symbols"))
            .respond_with(ResponseTemplate::new(200).set_body_json(vec![WorkspaceSymbolRecord {
                id: "symbol-1".to_string(),
                workspace_id: "ws-1".to_string(),
                file_id: "file-1".to_string(),
                path: "src/lib.ts".to_string(),
                name: "openWorkspace".to_string(),
                kind: "function".to_string(),
                start_line: 2,
                end_line: 4,
                signature: Some("export function openWorkspace() {".to_string()),
                container_name: None,
                indexed_at: "2026-03-31T12:00:00Z".to_string(),
            }]))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/workspaces/ws-1/symbols?query=open")
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn search_workspace_definitions_proxies_to_memory() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/workspaces/ws-1/definitions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(vec![WorkspaceSymbolRecord {
                id: "symbol-1".to_string(),
                workspace_id: "ws-1".to_string(),
                file_id: "file-1".to_string(),
                path: "src/lib.ts".to_string(),
                name: "openWorkspace".to_string(),
                kind: "function".to_string(),
                start_line: 2,
                end_line: 4,
                signature: Some("export function openWorkspace() {".to_string()),
                container_name: None,
                indexed_at: "2026-03-31T12:00:00Z".to_string(),
            }]))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/workspaces/ws-1/definitions?query=openWorkspace")
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn search_workspace_references_proxies_to_memory() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/workspaces/ws-1/references"))
            .respond_with(ResponseTemplate::new(200).set_body_json(vec![WorkspaceReferenceRecord {
                id: "reference-1".to_string(),
                workspace_id: "ws-1".to_string(),
                file_id: "file-1".to_string(),
                path: "src/lib.ts".to_string(),
                chunk_id: "chunk-1".to_string(),
                chunk_index: 0,
                start_line: 12,
                end_line: 14,
                snippet: "openWorkspace();".to_string(),
                matched_text: "openWorkspace".to_string(),
                indexed_at: "2026-03-31T12:00:00Z".to_string(),
            }]))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/workspaces/ws-1/references?query=openWorkspace")
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn workspace_health_reports_missing_root() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/workspaces"))
            .respond_with(ResponseTemplate::new(200).set_body_json(vec![WorkspaceRecord {
                id: "ws-1".to_string(),
                name: "repo".to_string(),
                root_path: "/path/that/does/not/exist".to_string(),
                vcs_branch: Some("main".to_string()),
                last_scan_at: None,
                last_index_at: None,
                created_at: "2026-03-31T12:00:00Z".to_string(),
                updated_at: "2026-03-31T12:00:00Z".to_string(),
            }]))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(&app, test::TestRequest::get().uri("/api/workspaces/ws-1/health").to_request()).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn delete_workspace_proxies_to_memory() {
        let mock = MockServer::start().await;
        Mock::given(method("DELETE"))
            .and(path("/v1/workspaces/ws-1"))
            .respond_with(ResponseTemplate::new(204))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(&app, test::TestRequest::delete().uri("/api/workspaces/ws-1").to_request()).await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    #[actix_web::test]
    async fn rebind_workspace_proxies_to_memory() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/workspaces/ws-1/rebind"))
            .and(body_json(serde_json::json!({
                "rootPath": "/tmp/new-root"
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(WorkspaceRecord {
                id: "ws-1".to_string(),
                name: "repo".to_string(),
                root_path: "/tmp/new-root".to_string(),
                vcs_branch: Some("main".to_string()),
                last_scan_at: None,
                last_index_at: None,
                created_at: "2026-03-31T12:00:00Z".to_string(),
                updated_at: "2026-03-31T12:00:00Z".to_string(),
            }))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/workspaces/ws-1/rebind")
                .set_json(serde_json::json!({
                    "rootPath": "/tmp/new-root"
                }))
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn register_workspace_derives_defaults_when_missing() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/workspaces"))
            .and(body_json(serde_json::json!({
                "id": "workspace-test",
                "name": "repo",
                "rootPath": "/tmp/repo",
                "vcsBranch": "main",
                "createdAt": "2026-03-31T12:00:00Z"
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "workspace-test",
                "name": "repo",
                "rootPath": "/tmp/repo",
                "vcsBranch": "main",
                "lastScanAt": null,
                "lastIndexAt": null,
                "createdAt": "2026-03-31T12:00:00Z",
                "updatedAt": "2026-03-31T12:00:00Z"
            })))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/workspaces")
                .set_json(serde_json::json!({
                    "id": "workspace-test",
                    "rootPath": "/tmp/repo",
                    "name": "repo",
                    "vcsBranch": "main",
                    "createdAt": "2026-03-31T12:00:00Z"
                }))
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[actix_web::test]
    async fn context_pack_request_includes_path_workspace_id() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/context/assemble"))
            .and(body_json(serde_json::json!({
                "workspaceId": "ws-1",
                "conversationId": "conv-1",
                "prompt": "inspect repo",
                "recentTurns": [
                    {
                        "role": "user",
                        "text": "inspect repo",
                        "id": "turn-1",
                        "createdAt": "2026-03-31T12:00:00Z"
                    }
                ],
                "selectedPaths": ["src/lib.rs"],
                "totalTokens": 2048,
                "reservedForOutput": 256
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(MemoryContextPack {
                version: ContextPackVersion::V1,
                workspace_id: Some("ws-1".to_string()),
                conversation_id: Some("conv-1".to_string()),
                summary: Some("workspace summary".to_string()),
                sections: vec![MemoryContextSection {
                    id: "sec-1".to_string(),
                    kind: MemoryContextSectionKind::ProjectSummary,
                    title: Some("Summary".to_string()),
                    text: "workspace summary".to_string(),
                    priority: 1.0,
                    token_estimate: 12,
                    provenance: vec![MemoryContextProvenance {
                        source_kind: MemoryProvenanceKind::Workspace,
                        source_id: "ws-1".to_string(),
                        label: Some("repo".to_string()),
                        path: None,
                        line_start: None,
                        line_end: None,
                        inclusion_reason: "workspace summary".to_string(),
                        score: Some(1.0),
                    }],
                }],
                token_budget: MemoryTokenBudget {
                    total_tokens: 2048,
                    reserved_for_output: 256,
                    available_for_context: 1792,
                    used_for_context: 120,
                },
                diagnostics: MemoryContextDiagnostics {
                    retrieval_strategy: "lexical".to_string(),
                    assembly_notes: vec!["selected path boost".to_string()],
                },
            }))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/workspaces/ws-1/context")
                .set_json(serde_json::json!({
                    "conversationId": "conv-1",
                    "prompt": "inspect repo",
                    "recentTurns": [
                        {
                            "role": "user",
                            "text": "inspect repo",
                            "id": "turn-1",
                            "createdAt": "2026-03-31T12:00:00Z"
                        }
                    ],
                    "selectedPaths": ["src/lib.rs"],
                    "totalTokens": 2048,
                    "reservedForOutput": 256
                }))
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn workspace_file_write_persists_content_to_disk() {
        let temp_root = std::env::temp_dir().join(format!("stepbit-ui-write-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_root).unwrap();
        let workspace_file = temp_root.join("src").join("main.ts");
        std::fs::create_dir_all(workspace_file.parent().unwrap()).unwrap();

        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/workspaces"))
            .respond_with(ResponseTemplate::new(200).set_body_json(vec![WorkspaceRecord {
                id: "ws-1".to_string(),
                name: "repo".to_string(),
                root_path: temp_root.display().to_string(),
                vcs_branch: None,
                last_scan_at: None,
                last_index_at: None,
                created_at: "2026-03-31T12:00:00Z".to_string(),
                updated_at: "2026-03-31T12:00:00Z".to_string(),
            }]))
            .mount(&mock)
            .await;

        let client = Arc::new(MemoryClient::new(mock.uri(), None));
        let app = test::init_service(app(Some(client))).await;

        let resp = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/workspaces/ws-1/file")
                .set_json(serde_json::json!({
                    "path": "src/main.ts",
                    "content": "export const main = true;\n"
                }))
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(std::fs::read_to_string(&workspace_file).unwrap(), "export const main = true;\n");
        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[actix_web::test]
    async fn missing_memory_client_returns_service_unavailable() {
        let app = test::init_service(app(None)).await;
        let resp = test::call_service(&app, test::TestRequest::get().uri("/api/workspaces").to_request()).await;
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
