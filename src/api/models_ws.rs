use serde::{Deserialize, Serialize};
use crate::memory::MemoryContextPack;

#[derive(Debug, Deserialize)]
pub struct WsClientMessage {
    pub r#type: String, // Expected: "message", "cancel"
    pub content: String,
    pub stream: Option<bool>,
    pub search: Option<bool>,
    pub reason: Option<bool>,
    pub workspace_context: Option<MemoryContextPack>,
}

#[derive(Debug, Serialize)]
pub struct WsServerMessage {
    pub r#type: String, // Expected: "chunk", "done", "error", "status"
    pub content: String,
}
