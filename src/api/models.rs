use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryUsageEntry {
    pub tag: String,
    pub usage_bytes: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemStats {
    pub total_sessions: i64,
    pub total_messages: i64,
    pub total_tokens: i64,
    pub db_size_bytes: u64,
    pub memory_usage: Vec<MemoryUsageEntry>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSessionRequest {
    pub name: String,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct CreateMessageRequest {
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub token_count: Option<i32>,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default = "default_offset")]
    pub offset: usize,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSessionRequest {
    pub name: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

fn default_limit() -> usize {
    50
}

fn default_offset() -> usize {
    0
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ActiveProviderRequest {
    pub provider_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ActiveModelRequest {
    pub model_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProviderInfo {
    pub id: String,
    pub active: bool,
    pub supported_models: Vec<String>,
    pub status: String, // "online", "offline", "unverified"
}

#[derive(Debug, Deserialize)]
pub struct CreateSkillRequest {
    pub name: String,
    pub content: String,
    #[serde(default)]
    pub tags: String,
    pub source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSkillRequest {
    pub name: Option<String>,
    pub content: Option<String>,
    pub tags: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FetchUrlRequest {
    pub url: String,
    pub name: String,
    #[serde(default)]
    pub tags: String,
}

#[derive(Debug, Deserialize)]
pub struct SqlQueryRequest {
    pub sql: String,
}

#[derive(Debug, Serialize)]
pub struct SqlQueryResponse {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>, // Each row is a JSON object or array
}
#[derive(Debug, Deserialize)]
pub struct PipelineRequest {
    pub name: String,
    pub definition: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct PipelineResponse {
    pub id: i64,
    pub name: String,
    pub definition: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct PipelineExecuteRequest {
    pub question: String,
}

#[derive(Debug, Serialize)]
pub struct StepbitCoreStatusResponse {
    pub online: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterWorkspaceRequest {
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(alias = "root_path")]
    pub root_path: String,
    #[serde(alias = "vcs_branch")]
    pub vcs_branch: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebindWorkspaceRequest {
    #[serde(alias = "root_path")]
    pub root_path: String,
}

#[derive(Debug, Deserialize)]
pub struct WorkspaceSymbolsQuery {
    pub query: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContextRequest {
    #[serde(alias = "conversation_id", alias = "conversationId")]
    pub conversation_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    #[serde(alias = "recentTurns", alias = "recent_turns")]
    pub recent_turns: Vec<WorkspaceConversationTurn>,
    #[serde(default)]
    #[serde(alias = "selectedPaths", alias = "selected_paths")]
    pub selected_paths: Vec<String>,
    #[serde(alias = "total_tokens", alias = "totalTokens")]
    pub total_tokens: u32,
    #[serde(alias = "reserved_for_output", alias = "reservedForOutput")]
    pub reserved_for_output: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileWriteRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConversationTurn {
    pub role: String,
    pub text: String,
    pub id: Option<String>,
    #[serde(alias = "created_at", alias = "createdAt")]
    pub created_at: Option<String>,
}
