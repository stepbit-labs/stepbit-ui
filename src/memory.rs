use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error("network error: {0}")]
    Network(String),
    #[error("api error: {0}")]
    Api(String),
    #[error("invalid request")]
    InvalidRequest,
}

#[derive(Debug, Clone)]
pub struct MemoryClient {
    client: Client,
    base_url: String,
    api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHealthResponse {
    pub status: String,
    pub service: String,
    pub db_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub vcs_branch: Option<String>,
    pub last_scan_at: Option<String>,
    pub last_index_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRegistrationRequest {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub vcs_branch: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRebindRequest {
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexingOutcome {
    pub workspace_id: String,
    pub files_discovered: usize,
    pub files_indexed: usize,
    pub files_skipped_unchanged: usize,
    pub files_skipped_filtered: usize,
    pub chunks_written: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexState {
    pub workspace_id: String,
    pub status: String,
    pub last_index_started_at: Option<String>,
    pub last_index_completed_at: Option<String>,
    pub last_error: Option<String>,
    pub indexed_file_count: u64,
    pub indexed_chunk_count: u64,
    pub changed_file_count: u64,
    pub skipped_file_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileRecord {
    pub id: String,
    pub workspace_id: String,
    pub path: String,
    pub kind: Option<String>,
    pub size_bytes: u64,
    pub sha256: Option<String>,
    pub language: Option<String>,
    pub last_modified_at: Option<String>,
    pub indexed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSymbolRecord {
    pub id: String,
    pub workspace_id: String,
    pub file_id: String,
    pub path: String,
    pub name: String,
    pub kind: String,
    pub start_line: u32,
    pub end_line: u32,
    pub signature: Option<String>,
    pub container_name: Option<String>,
    pub indexed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReferenceRecord {
    pub id: String,
    pub workspace_id: String,
    pub file_id: String,
    pub path: String,
    pub chunk_id: String,
    pub chunk_index: usize,
    pub start_line: u32,
    pub end_line: u32,
    pub snippet: String,
    pub matched_text: String,
    pub indexed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextPackVersion {
    V1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryContextPack {
    pub version: ContextPackVersion,
    pub workspace_id: Option<String>,
    pub conversation_id: Option<String>,
    pub summary: Option<String>,
    pub sections: Vec<MemoryContextSection>,
    pub token_budget: MemoryTokenBudget,
    pub diagnostics: MemoryContextDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryContextSection {
    pub id: String,
    pub kind: MemoryContextSectionKind,
    pub title: Option<String>,
    pub text: String,
    pub priority: f32,
    pub token_estimate: u32,
    pub provenance: Vec<MemoryContextProvenance>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryContextSectionKind {
    RecentTurns,
    ConversationSummary,
    ProjectSummary,
    ModuleSummary,
    ProjectFact,
    FileSnippet,
    RecentChanges,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryContextProvenance {
    pub source_kind: MemoryProvenanceKind,
    pub source_id: String,
    pub label: Option<String>,
    pub path: Option<String>,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub inclusion_reason: String,
    pub score: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryProvenanceKind {
    Workspace,
    File,
    ModuleSummary,
    ProjectFact,
    ConversationCompaction,
    RecentTurns,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTokenBudget {
    pub total_tokens: u32,
    pub reserved_for_output: u32,
    pub available_for_context: u32,
    pub used_for_context: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryContextDiagnostics {
    pub retrieval_strategy: String,
    pub assembly_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationTurn {
    pub role: String,
    pub text: String,
    pub id: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextAssemblyRequest {
    pub workspace_id: Option<String>,
    pub conversation_id: Option<String>,
    pub prompt: String,
    pub recent_turns: Vec<ConversationTurn>,
    pub selected_paths: Vec<String>,
    pub total_tokens: u32,
    pub reserved_for_output: u32,
}

impl MemoryClient {
    pub fn new(base_url: String, api_key: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_else(|_| Client::new()),
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
        }
    }

    pub async fn health(&self) -> Result<MemoryHealthResponse, MemoryError> {
        self.get_json("/health").await
    }

    pub async fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>, MemoryError> {
        self.get_json("/v1/workspaces").await
    }

    pub async fn delete_workspace(&self, workspace_id: &str) -> Result<(), MemoryError> {
        let response = self
            .request(Method::DELETE, &format!("/v1/workspaces/{workspace_id}"), None::<&()>)
            .await?;
        self.decode_empty(response).await
    }

    pub async fn rebind_workspace(
        &self,
        workspace_id: &str,
        request: &WorkspaceRebindRequest,
    ) -> Result<WorkspaceRecord, MemoryError> {
        self.post_json(&format!("/v1/workspaces/{workspace_id}/rebind"), Some(request))
            .await
    }

    pub async fn register_workspace(
        &self,
        request: &WorkspaceRegistrationRequest,
    ) -> Result<WorkspaceRecord, MemoryError> {
        self.post_json("/v1/workspaces", Some(request)).await
    }

    pub async fn index_workspace(&self, workspace_id: &str) -> Result<IndexingOutcome, MemoryError> {
        self.post_json(&format!("/v1/workspaces/{workspace_id}/index"), Option::<&()>::None)
            .await
    }

    pub async fn get_workspace_index_state(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceIndexState, MemoryError> {
        self.get_json(&format!("/v1/workspaces/{workspace_id}/index-state"))
            .await
    }

    pub async fn list_workspace_files(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<WorkspaceFileRecord>, MemoryError> {
        self.get_json(&format!("/v1/workspaces/{workspace_id}/files"))
            .await
    }

    pub async fn list_workspace_symbols(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<WorkspaceSymbolRecord>, MemoryError> {
        self.get_json(&format!("/v1/workspaces/{workspace_id}/symbols"))
            .await
    }

    pub async fn search_workspace_symbols(
        &self,
        workspace_id: &str,
        query: &str,
    ) -> Result<Vec<WorkspaceSymbolRecord>, MemoryError> {
        let encoded_query = urlencoding::encode(query);
        self.get_json(&format!(
            "/v1/workspaces/{workspace_id}/symbols?query={encoded_query}"
        ))
        .await
    }

    pub async fn search_workspace_definitions(
        &self,
        workspace_id: &str,
        query: &str,
    ) -> Result<Vec<WorkspaceSymbolRecord>, MemoryError> {
        let encoded_query = urlencoding::encode(query);
        self.get_json(&format!(
            "/v1/workspaces/{workspace_id}/definitions?query={encoded_query}"
        ))
        .await
    }

    pub async fn search_workspace_references(
        &self,
        workspace_id: &str,
        query: &str,
    ) -> Result<Vec<WorkspaceReferenceRecord>, MemoryError> {
        let encoded_query = urlencoding::encode(query);
        self.get_json(&format!(
            "/v1/workspaces/{workspace_id}/references?query={encoded_query}"
        ))
        .await
    }

    pub async fn assemble_context(
        &self,
        request: &ContextAssemblyRequest,
    ) -> Result<MemoryContextPack, MemoryError> {
        self.post_json("/v1/context/assemble", Some(request)).await
    }

    async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, MemoryError> {
        let response = self.request(Method::GET, path, None::<&()>).await?;
        self.decode_json(response).await
    }

    async fn post_json<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        path: &str,
        body: Option<&B>,
    ) -> Result<T, MemoryError> {
        let response = self.request(Method::POST, path, body).await?;
        self.decode_json(response).await
    }

    async fn request<B: Serialize + ?Sized>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<reqwest::Response, MemoryError> {
        let url = format!("{}{}", self.base_url, path);
        let mut request = self.client.request(method, &url);
        if let Some(api_key) = &self.api_key {
            request = request.bearer_auth(api_key);
        }
        if let Some(body) = body {
            request = request.json(body);
        }

        request
            .send()
            .await
            .map_err(|error| MemoryError::Network(error.to_string()))
    }

    async fn decode_json<T: DeserializeOwned>(
        &self,
        response: reqwest::Response,
    ) -> Result<T, MemoryError> {
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(MemoryError::Api(format!("{status}: {body}")));
        }

        response
            .json::<T>()
            .await
            .map_err(|error| MemoryError::Api(error.to_string()))
    }

    async fn decode_empty(&self, response: reqwest::Response) -> Result<(), MemoryError> {
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(MemoryError::Api(format!("{status}: {body}")));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn health_uses_bearer_auth_when_configured() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/health"))
            .and(header("authorization", "Bearer sk-memory"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status": "ok",
                "service": "stepbit-memory",
                "dbPath": "./memory.sqlite"
            })))
            .mount(&server)
            .await;

        let client = MemoryClient::new(server.uri(), Some("sk-memory".to_string()));
        let health = client.health().await.unwrap();

        assert_eq!(health.service, "stepbit-memory");
    }

    #[tokio::test]
    async fn delete_workspace_uses_bearer_auth_when_configured() {
        let server = MockServer::start().await;
        Mock::given(method("DELETE"))
            .and(path("/v1/workspaces/ws-1"))
            .and(header("authorization", "Bearer sk-memory"))
            .respond_with(ResponseTemplate::new(204))
            .mount(&server)
            .await;

        let client = MemoryClient::new(server.uri(), Some("sk-memory".to_string()));
        client.delete_workspace("ws-1").await.unwrap();
    }

    #[tokio::test]
    async fn rebind_workspace_sends_camel_case_payload() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/workspaces/ws-1/rebind"))
            .and(body_json(serde_json::json!({
                "rootPath": "/tmp/new-repo"
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "ws-1",
                "name": "repo",
                "rootPath": "/tmp/new-repo",
                "vcsBranch": "main",
                "lastScanAt": null,
                "lastIndexAt": null,
                "createdAt": "2026-03-31T12:00:00Z",
                "updatedAt": "2026-03-31T12:00:00Z"
            })))
            .mount(&server)
            .await;

        let client = MemoryClient::new(server.uri(), None);
        let record = client
            .rebind_workspace(
                "ws-1",
                &WorkspaceRebindRequest {
                    root_path: "/tmp/new-repo".to_string(),
                },
            )
            .await
            .unwrap();

        assert_eq!(record.root_path, "/tmp/new-repo");
    }

    #[tokio::test]
    async fn register_workspace_sends_camel_case_payload() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/workspaces"))
            .and(body_json(serde_json::json!({
                "id": "ws-1",
                "name": "repo",
                "rootPath": "/tmp/repo",
                "vcsBranch": "main",
                "createdAt": "2026-03-31T12:00:00Z"
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "ws-1",
                "name": "repo",
                "rootPath": "/tmp/repo",
                "vcsBranch": "main",
                "lastScanAt": null,
                "lastIndexAt": null,
                "createdAt": "2026-03-31T12:00:00Z",
                "updatedAt": "2026-03-31T12:00:00Z"
            })))
            .mount(&server)
            .await;

        let client = MemoryClient::new(server.uri(), None);
        let record = client
            .register_workspace(&WorkspaceRegistrationRequest {
                id: "ws-1".to_string(),
                name: "repo".to_string(),
                root_path: "/tmp/repo".to_string(),
                vcs_branch: Some("main".to_string()),
                created_at: "2026-03-31T12:00:00Z".to_string(),
            })
            .await
            .unwrap();

        assert_eq!(record.root_path, "/tmp/repo");
    }

    #[tokio::test]
    async fn assemble_context_uses_expected_request_shape() {
        let server = MockServer::start().await;
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
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "version": "v1",
                "workspaceId": "ws-1",
                "conversationId": "conv-1",
                "summary": "workspace summary",
                "sections": [],
                "tokenBudget": {
                    "totalTokens": 2048,
                    "reservedForOutput": 256,
                    "availableForContext": 1792,
                    "usedForContext": 120
                },
                "diagnostics": {
                    "retrievalStrategy": "lexical",
                    "assemblyNotes": ["selected path boost"]
                }
            })))
            .mount(&server)
            .await;

        let client = MemoryClient::new(server.uri(), None);
        let pack = client
            .assemble_context(&ContextAssemblyRequest {
                workspace_id: Some("ws-1".to_string()),
                conversation_id: Some("conv-1".to_string()),
                prompt: "inspect repo".to_string(),
                recent_turns: vec![ConversationTurn {
                    role: "user".to_string(),
                    text: "inspect repo".to_string(),
                    id: Some("turn-1".to_string()),
                    created_at: Some("2026-03-31T12:00:00Z".to_string()),
                }],
                selected_paths: vec!["src/lib.rs".to_string()],
                total_tokens: 2048,
                reserved_for_output: 256,
            })
            .await
            .unwrap();

        assert_eq!(pack.workspace_id.as_deref(), Some("ws-1"));
        assert_eq!(pack.diagnostics.retrieval_strategy, "lexical");
    }

    #[tokio::test]
    async fn list_workspace_symbols_uses_expected_path() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/workspaces/ws-1/symbols"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": "symbol-1",
                    "workspaceId": "ws-1",
                    "fileId": "file-1",
                    "path": "src/lib.rs",
                    "name": "build_context",
                    "kind": "function",
                    "startLine": 1,
                    "endLine": 3,
                    "signature": "pub fn build_context() {",
                    "containerName": null,
                    "indexedAt": "2026-03-31T12:00:00Z"
                }
            ])))
            .mount(&server)
            .await;

        let client = MemoryClient::new(server.uri(), None);
        let symbols = client.list_workspace_symbols("ws-1").await.unwrap();

        assert_eq!(symbols.len(), 1);
        assert_eq!(symbols[0].name, "build_context");
    }

    #[tokio::test]
    async fn search_workspace_symbols_uses_expected_path() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/workspaces/ws-1/symbols"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": "symbol-1",
                    "workspaceId": "ws-1",
                    "fileId": "file-1",
                    "path": "src/lib.rs",
                    "name": "build_context",
                    "kind": "function",
                    "startLine": 1,
                    "endLine": 3,
                    "signature": "pub fn build_context() {",
                    "containerName": null,
                    "indexedAt": "2026-03-31T12:00:00Z"
                }
            ])))
            .mount(&server)
            .await;

        let client = MemoryClient::new(server.uri(), None);
        let symbols = client.search_workspace_symbols("ws-1", "build context").await.unwrap();

        assert_eq!(symbols.len(), 1);
    }

    #[tokio::test]
    async fn search_workspace_references_uses_expected_path() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/workspaces/ws-1/references"))
            .and(wiremock::matchers::query_param("query", "open_workspace"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": "reference:file-1:src/lib.rs:0",
                    "workspaceId": "ws-1",
                    "fileId": "file-1",
                    "path": "src/lib.rs",
                    "chunkId": "chunk-1",
                    "chunkIndex": 0,
                    "startLine": 1,
                    "endLine": 3,
                    "snippet": "open_workspace();",
                    "matchedText": "open_workspace",
                    "indexedAt": "2026-03-31T12:00:00Z"
                }
            ])))
            .mount(&server)
            .await;

        let client = MemoryClient::new(server.uri(), None);
        let references = client
            .search_workspace_references("ws-1", "open_workspace")
            .await
            .unwrap();

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].path, "src/lib.rs");
    }
}
