use actix_web::{get, web, Error, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt as _;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::broadcast::error::RecvError;
use tracing::{error, info};
use uuid::Uuid;

use crate::api::models_ws::{WsClientMessage, WsServerMessage};
use crate::db::{service::DbService, DbPool};
use crate::llm::{
    models::{
        ChatOptions, FunctionDefinition, McpToolDefinition, Message as LlmMessage,
        StructuredChatResponse, ToolDefinition,
    },
    LlmProvider, ProviderManager,
};
use crate::terminal::TerminalManager;

#[get("/ws/chat/{session_id}")]
pub async fn ws_chat(
    req: HttpRequest,
    body: web::Payload,
    pool: web::Data<DbPool>,
    llm: web::Data<Arc<dyn LlmProvider>>,
    config: web::Data<crate::config::AppConfig>,
    session_id: web::Path<Uuid>,
) -> Result<HttpResponse, Error> {
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, body)?;
    let id = session_id.into_inner();

    // Verify session exists before accepting connection
    {
        let conn = pool.lock().unwrap();
        if DbService::get_session(&conn, id).unwrap_or(None).is_none() {
            return Ok(HttpResponse::NotFound().body("Session not found"));
        }
    }

    info!("WebSocket connection established for session {:?}", id);

    // web::Data<T> is effectively Arc<T>.
    let llm_arc = llm.get_ref().clone(); // Arc<dyn LlmProvider>
    let pool_arc = pool.get_ref().clone(); // Arc<Mutex<Connection>>

    // config is web::Data<AppConfig>, which is Arc<AppConfig>
    // We can get the inner Arc by cloning the Data and calling into_inner()
    let config_arc = config.clone().into_inner();

    actix_web::rt::spawn(async move {
        let mut active_task: Option<actix_web::rt::task::JoinHandle<()>> = None;

        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                Message::Ping(bytes) => {
                    if session.pong(&bytes).await.is_err() {
                        return;
                    }
                }
                Message::Text(text) => {
                    info!("Received WebSocket message: {}", text);
                    let client_msg: Result<WsClientMessage, _> = serde_json::from_str(&text);
                    if let Ok(msg) = client_msg {
                        match msg.r#type.as_str() {
                            "message" => {
                                // If there's an active task, abort it before starting a new one
                                if let Some(handle) = active_task.take() {
                                    handle.abort();
                                }

                                let mut session_clone = session.clone();
                                let mut session_clone_err = session.clone();
                                let pool_clone = pool_arc.clone();
                                let llm_clone = llm_arc.clone();
                                let config_clone = config_arc.clone();
                                let content = msg.content;
                                let search = msg.search.unwrap_or(false);
                                let reason = msg.reason.unwrap_or(false);
                                let workspace_context = msg.workspace_context.clone();

                                active_task = Some(actix_web::rt::spawn(async move {
                                    handle_chat_message(
                                        content,
                                        search,
                                        reason,
                                        workspace_context,
                                        id,
                                        pool_clone,
                                        llm_clone,
                                        config_clone,
                                        &mut session_clone,
                                        &mut session_clone_err,
                                    )
                                    .await;
                                }));
                            }
                            "cancel" => {
                                info!("Received cancel request for session {:?}", id);
                                if let Some(handle) = active_task.take() {
                                    let llm_cancel = llm_arc.clone();
                                    let sid_cancel = id.to_string();
                                    tokio::spawn(async move {
                                        let _ = llm_cancel.cancel(&sid_cancel).await;
                                    });
                                    handle.abort();
                                    info!("Chat task for session {:?} aborted", id);

                                    let status_msg = WsServerMessage {
                                        r#type: "status".to_string(),
                                        content: "Process cancelled".to_string(),
                                    };
                                    let _ = session
                                        .text(serde_json::to_string(&status_msg).unwrap())
                                        .await;

                                    let done_msg = WsServerMessage {
                                        r#type: "done".to_string(),
                                        content: "".to_string(),
                                    };
                                    let _ = session
                                        .text(serde_json::to_string(&done_msg).unwrap())
                                        .await;
                                } else {
                                    info!("No active task to cancel for session {:?}", id);
                                }
                            }
                            _ => {
                                error!("Unknown message type: {}", msg.r#type);
                            }
                        }
                    }
                }
                Message::Close(reason) => {
                    if let Some(handle) = active_task.take() {
                        let llm_cancel = llm.clone();
                        let sid_cancel = id.to_string();
                        tokio::spawn(async move {
                            let _ = llm_cancel.cancel(&sid_cancel).await;
                        });
                        handle.abort();
                    }
                    let _ = session.close(reason).await;
                    break;
                }
                _ => {}
            }
        }
        info!("WebSocket connection closed for session {:?}", id);
    });

    Ok(response)
}

#[get("/ws/terminal/{session_id}")]
pub async fn ws_terminal(
    req: HttpRequest,
    body: web::Payload,
    manager: web::Data<Arc<TerminalManager>>,
    session_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let session_id = session_id.into_inner();
    let token = qstring::QString::from(req.query_string())
        .get("terminal_token")
        .map(str::to_string)
        .ok_or_else(|| actix_web::error::ErrorUnauthorized("Missing terminal token"))?;

    let mut receiver = manager
        .subscribe(&session_id, &token)
        .map_err(|_| actix_web::error::ErrorUnauthorized("Invalid terminal token"))?;

    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, body)?;

    actix_web::rt::spawn(async move {
        loop {
            tokio::select! {
                inbound = msg_stream.next() => {
                    match inbound {
                        Some(Ok(Message::Ping(bytes))) => {
                            if session.pong(&bytes).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(Message::Text(text))) => {
                            #[derive(serde::Deserialize)]
                            #[serde(tag = "type", rename_all = "camelCase")]
                            enum TerminalClientMessage {
                                Input { input: String },
                                Interrupt,
                            }

                            if let Ok(message) = serde_json::from_str::<TerminalClientMessage>(&text) {
                                match message {
                                    TerminalClientMessage::Input { input } => {
                                        let _ = manager.send_input(&session_id, &input).await;
                                    }
                                    TerminalClientMessage::Interrupt => {
                                        let _ = manager.interrupt(&session_id).await;
                                    }
                                }
                            }
                        }
                        Some(Ok(Message::Close(reason))) => {
                            let _ = session.close(reason).await;
                            break;
                        }
                        Some(Ok(_)) => {}
                        Some(Err(_)) | None => break,
                    }
                }
                event = receiver.recv() => {
                    match event {
                        Ok(event) => {
                            if let Ok(json) = serde_json::to_string(&event) {
                                if session.text(json).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Err(RecvError::Lagged(_)) => continue,
                        Err(RecvError::Closed) => break,
                    }
                }
            }
        }
    });

    Ok(response)
}

async fn handle_chat_message(
    content: String,
    search: bool,
    reason: bool,
    workspace_context: Option<crate::memory::MemoryContextPack>,
    session_id: Uuid,
    pool: DbPool,
    llm: Arc<dyn LlmProvider>,
    config: Arc<crate::config::AppConfig>,
    session: &mut actix_ws::Session,
    session_err: &mut actix_ws::Session,
) {
    info!("Starting handle_chat_message for session {:?}", session_id);

    // 0. Send initial status
    let start_status = WsServerMessage {
        r#type: "status".to_string(),
        content: "Thinking...".to_string(),
    };
    let _ = session
        .text(serde_json::to_string(&start_status).unwrap())
        .await;
    {
        let conn = pool.lock().unwrap();
        if let Err(e) = DbService::insert_message(
            &conn,
            session_id,
            "user",
            &content,
            None,
            None,
            serde_json::json!({
                "workspace_context": workspace_context,
            }),
        ) {
            error!("Failed to insert user message: {}", e);
            drop(conn); // Drop lock before await
            let err_resp = WsServerMessage {
                r#type: "error".to_string(),
                content: "Database error".to_string(),
            };
            let _ = session
                .text(serde_json::to_string(&err_resp).unwrap())
                .await;
            return;
        }
    }

    // 2. Fetch History & Session Metadata
    let (history, session_db) = {
        let conn = pool.lock().unwrap();
        let history = DbService::get_messages(&conn, session_id, 50, 0).unwrap_or_default();
        let session_db = DbService::get_session(&conn, session_id).unwrap_or(None);
        (history, session_db)
    };
    info!(
        "Fetched history and session metadata for session {:?}",
        session_id
    );

    let mut system_prompt = config.chat.system_prompt.clone();
    if let Some(s) = session_db {
        if let Some(prompt) = s.metadata.get("system_prompt").and_then(|v| v.as_str()) {
            system_prompt = prompt.to_string();
        }
    }

    let workspace_prompt = workspace_context
        .as_ref()
        .map(format_workspace_context_pack);
    if workspace_context.is_some() {
        let status_msg = WsServerMessage {
            r#type: "status".to_string(),
            content: "Using workspace...".to_string(),
        };
        let _ = session
            .text(serde_json::to_string(&status_msg).unwrap())
            .await;
    }

    let mut llm_messages: Vec<LlmMessage> = history
        .into_iter()
        .map(|m| {
            let tool_calls = m
                .metadata
                .get("tool_calls")
                .and_then(|tc| serde_json::from_value(tc.clone()).ok());
            let tool_call_id = m
                .metadata
                .get("tool_call_id")
                .and_then(|tid| tid.as_str().map(|s| s.to_string()));
            LlmMessage {
                role: m.role,
                content: m.content,
                tool_calls,
                tool_call_id,
            }
        })
        .collect();

    let tools = crate::tools::ToolRegistry::new();
    let current_date = chrono::Local::now().format("%A, %B %d, %Y").to_string();
    let grounded_system_prompt = system_prompt.replace("{current_date}", &current_date);
    let mut final_prompt = format!(
        "Current Date: {}.\n\n{}",
        current_date, grounded_system_prompt
    );

    if let Some(workspace_prompt) = workspace_prompt {
        final_prompt.push_str("\n\n");
        final_prompt.push_str("Workspace access instructions:\n");
        final_prompt.push_str("- You have access to indexed workspace context for the active repository in this turn.\n");
        final_prompt.push_str("- Do not claim that you cannot access the repository or filesystem when workspace context is present.\n");
        final_prompt.push_str("- Answer from the provided workspace context first.\n");
        final_prompt.push_str("- If the available context is insufficient, ask for a narrower target such as a file, symbol, or definition query.\n\n");
        final_prompt.push_str(&workspace_prompt);
    }

    if reason {
        final_prompt.push_str("\n\nIMPORTANT: Please reason step-by-step before providing your final answer. Externalize your internal monologue if possible.");
    }

    let mut tool_definitions = tools.get_definitions();
    let mcp_tools = llm.get_mcp_tools().await.unwrap_or_default();
    tool_definitions.extend(
        mcp_tools
            .into_iter()
            .filter(|tool| is_supported_chat_mcp_tool(tool, search))
            .map(mcp_tool_to_tool_definition),
    );

    if !search {
        tool_definitions.retain(|tool| {
            !matches!(
                tool.function.name.as_str(),
                "internet_search" | "read_full_content" | "read_url"
            )
        });
    }

    let mut seen_tools = HashSet::new();
    tool_definitions.retain(|tool| seen_tools.insert(tool.function.name.clone()));

    let current_options = ChatOptions {
        system_prompt: Some(final_prompt),
        tools: Some(tool_definitions),
        user: Some(session_id.to_string()),
        max_tokens: Some(4096), // Increase default to prevent cut-off
        ..Default::default()
    };

    match try_structured_stepbit_core_chat(
        &llm,
        &llm_messages,
        current_options.clone(),
        search,
        reason,
        session_id,
        &pool,
        session,
    )
    .await {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            let err_resp = WsServerMessage {
                r#type: "error".to_string(),
                content: format!("LLM Error: {}", error),
            };
            let _ = session_err
                .text(serde_json::to_string(&err_resp).unwrap())
                .await;
            return;
        }
    }

    info!("Starting chat loop for session {:?}", session_id);
    let mut loop_count = 0;
    let max_loops = 5;

    while loop_count < max_loops {
        // Use streaming for the primary interaction to ensure responsiveness
        info!("Calling LLM chat_streaming for session {:?}", session_id);

        let (tx_stream, mut rx_stream) = tokio::sync::mpsc::channel(100);
        let llm_clone = llm.clone();
        let messages_clone = llm_messages.clone();
        let options_clone = current_options.clone();
        let mut session_err_clone = session_err.clone();

        let stream_handle = tokio::spawn(async move {
            let res = llm_clone
                .chat_streaming(&messages_clone, options_clone, tx_stream)
                .await;
            if let Err(ref e) = res {
                error!("Stream error in chat loop: {:?}", e);
                let err_resp = WsServerMessage {
                    r#type: "error".to_string(),
                    content: format!("LLM Error: {}", e),
                };
                let _ = session_err_clone
                    .text(serde_json::to_string(&err_resp).unwrap())
                    .await;
            }
            res
        });

        let mut turn_content = String::new();
        while let Some(chunk) = rx_stream.recv().await {
            turn_content.push_str(&chunk);
            let resp = WsServerMessage {
                r#type: "chunk".to_string(),
                content: chunk,
            };
            if let Ok(json) = serde_json::to_string(&resp) {
                let _ = session.text(json).await;
            }
        }

        // PERSIST FIRST
        {
            let conn = pool.lock().unwrap();
            let _ = crate::db::service::DbService::insert_message(
                &conn,
                session_id,
                "assistant",
                &turn_content,
                Some(llm.name()),
                None,
                serde_json::json!({}),
            );
        }

        // THEN SEND DONE signal to unlock UI
        let done_msg = WsServerMessage {
            r#type: "done".to_string(),
            content: "".to_string(),
        };
        info!(
            "Sending 'done' message to session {:?} after stream finished and persisted",
            session_id
        );
        let _ = session
            .text(serde_json::to_string(&done_msg).unwrap())
            .await;

        let stream_result = stream_handle.await;
        info!("stepbit-core stream worker joined for session {:?}", session_id);

        let mut next_loop = false;

        match stream_result {
            Ok(Ok(Some(tool_calls))) => {
                info!("Extracted {} tool calls from stream", tool_calls.len());
                
                // Strip the trailing JSON array from turn_content so it doesn't pollute the context
                if let Some((_, clean_text)) = crate::llm::extract_streaming_tool_call(&turn_content) {
                    turn_content = clean_text;
                }
                
                // Add assistant message with tool calls to history
                llm_messages.push(LlmMessage {
                    role: "assistant".to_string(),
                    content: turn_content.clone(),
                    tool_calls: Some(tool_calls.clone()),
                    tool_call_id: None,
                });

                // Update DB with the tool calls
                {
                    let conn = pool.lock().unwrap();
                    let _ = crate::db::service::DbService::insert_message(
                        &conn,
                        session_id,
                        "assistant",
                        &turn_content,
                        Some(llm.name()),
                        None,
                        serde_json::json!({ "tool_calls": tool_calls }),
                    );
                }

                // Execute tools
                for tool_call in tool_calls {
                    let tool_name = tool_call.function.name.clone();
                    
                    // Send status to UI
                    let status_msg = WsServerMessage {
                        r#type: "status".to_string(),
                        content: format!("Running tool: {}...", tool_name),
                    };
                    let _ = session.text(serde_json::to_string(&status_msg).unwrap()).await;

                    let tool_id = tool_call.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
                    let result = tools.call_tool(&tool_name, &tool_call.function.arguments, session_id, pool.clone()).await;
                    
                    llm_messages.push(LlmMessage {
                        role: "tool".to_string(),
                        content: result.clone(),
                        tool_calls: None,
                        tool_call_id: Some(tool_id.clone()),
                    });

                    // Persist tool result
                    {
                        let conn = pool.lock().unwrap();
                        let _ = crate::db::service::DbService::insert_message(
                            &conn,
                            session_id,
                            "tool",
                            &result,
                            None,
                            None,
                            serde_json::json!({ "tool_call_id": tool_id }),
                        );
                    }
                }
                next_loop = true;
            }
            Ok(Ok(None)) => {
                // No tools, just a normal answer
                llm_messages.push(LlmMessage {
                    role: "assistant".to_string(),
                    content: turn_content.clone(),
                    tool_calls: None,
                    tool_call_id: None,
                });
            }
            Ok(Err(e)) => {
                error!("Stream execution failed: {}", e);
            }
            Err(e) => {
                error!("Task execution failed: {}", e);
            }
        }

        if !next_loop {
            break;
        }
        loop_count += 1;
    }
}

async fn try_structured_stepbit_core_chat(
    llm: &Arc<dyn LlmProvider>,
    llm_messages: &[LlmMessage],
    options: ChatOptions,
    search: bool,
    reason: bool,
    session_id: Uuid,
    pool: &DbPool,
    session: &mut actix_ws::Session,
) -> Result<bool, crate::llm::LlmError> {
    if !uses_structured_stepbit_core(llm) {
        return Ok(false);
    }

    let Some(response) = llm
        .chat_structured(llm_messages, options, search, reason)
        .await?
    else {
        return Ok(false);
    };

    let StructuredChatResponse {
        content,
        model,
        citations,
        metadata,
    } = response;

    if search {
        let status_msg = WsServerMessage {
            r#type: "status".to_string(),
            content: "Searching the web...".to_string(),
        };
        let _ = session
            .text(serde_json::to_string(&status_msg).unwrap())
            .await;
    }

    let chunk_msg = WsServerMessage {
        r#type: "chunk".to_string(),
        content: content.clone(),
    };
    let _ = session
        .text(serde_json::to_string(&chunk_msg).unwrap())
        .await;

    {
        let conn = pool.lock().unwrap();
        let _ = crate::db::service::DbService::insert_message(
            &conn,
            session_id,
            "assistant",
            &content,
            Some(&model),
            None,
            serde_json::json!({
                "citations": citations,
                "structured_response": metadata,
            }),
        );
    }

    let done_msg = WsServerMessage {
        r#type: "done".to_string(),
        content: "".to_string(),
    };
    let _ = session
        .text(serde_json::to_string(&done_msg).unwrap())
        .await;

    Ok(true)
}

fn uses_structured_stepbit_core(llm: &Arc<dyn LlmProvider>) -> bool {
    if let Some(manager) = llm.as_any().downcast_ref::<ProviderManager>() {
        return manager.get_active_provider_id() == "stepbit-core";
    }

    llm.name() == "stepbit-core"
}

fn is_supported_chat_mcp_tool(tool: &McpToolDefinition, search: bool) -> bool {
    match tool.name.as_str() {
        "internet_search" | "read_url" | "read_full_content" => search,
        "quantlab_run" | "quantlab_sweep" | "quantlab_forward" | "quantlab_portfolio" => true,
        _ => false,
    }
}

fn mcp_tool_to_tool_definition(tool: McpToolDefinition) -> ToolDefinition {
    ToolDefinition {
        r#type: "function".to_string(),
        function: FunctionDefinition {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
        },
    }
}

fn format_workspace_context_pack(pack: &crate::memory::MemoryContextPack) -> String {
    let mut output = String::from("Workspace context pack:\n");

    if let Some(workspace_id) = &pack.workspace_id {
        output.push_str(&format!("- workspace_id: {}\n", workspace_id));
    }

    if let Some(conversation_id) = &pack.conversation_id {
        output.push_str(&format!("- conversation_id: {}\n", conversation_id));
    }

    if let Some(summary) = &pack.summary {
        output.push_str("\nSummary:\n");
        output.push_str(summary.trim());
        output.push('\n');
    }

    if !pack.sections.is_empty() {
        output.push_str("\nSections:\n");
        for section in pack.sections.iter().take(6) {
            let title = section.title.as_deref().unwrap_or(&section.id);
            output.push_str(&format!(
                "- [{}] {} ({:?}, {} tokens)\n",
                title,
                section.text.trim(),
                section.kind,
                section.token_estimate
            ));
        }
    }

    output.push_str("\nToken budget:\n");
    output.push_str(&format!(
        "- total: {}\n- reserved_for_output: {}\n- available_for_context: {}\n- used_for_context: {}\n",
        pack.token_budget.total_tokens,
        pack.token_budget.reserved_for_output,
        pack.token_budget.available_for_context,
        pack.token_budget.used_for_context
    ));

    output.push_str("\nRetrieval notes:\n");
    output.push_str(&format!("- strategy: {}\n", pack.diagnostics.retrieval_strategy));
    for note in &pack.diagnostics.assembly_notes {
        output.push_str(&format!("- {}\n", note));
    }

    output
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(ws_chat).service(ws_terminal);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::{
        ContextPackVersion, MemoryContextDiagnostics, MemoryContextPack, MemoryContextProvenance,
        MemoryContextSection, MemoryContextSectionKind, MemoryProvenanceKind, MemoryTokenBudget,
    };

    #[test]
    fn workspace_context_pack_is_formatted_into_prompt() {
        let pack = MemoryContextPack {
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
        };

        let formatted = format_workspace_context_pack(&pack);

        assert!(formatted.contains("Workspace context pack"));
        assert!(formatted.contains("ws-1"));
        assert!(formatted.contains("workspace summary"));
        assert!(formatted.contains("selected path boost"));
    }

    #[test]
    fn workspace_instructions_prevent_no_access_language() {
        let workspace_prompt = format!(
            "Workspace access instructions:\n- You have access to indexed workspace context for the active repository in this turn.\n- Do not claim that you cannot access the repository or filesystem when workspace context is present.\n- Answer from the provided workspace context first.\n- If the available context is insufficient, ask for a narrower target such as a file, symbol, or definition query.\n\n{}",
            format_workspace_context_pack(&MemoryContextPack {
                version: ContextPackVersion::V1,
                workspace_id: Some("ws-1".to_string()),
                conversation_id: None,
                summary: Some("workspace summary".to_string()),
                sections: vec![],
                token_budget: MemoryTokenBudget {
                    total_tokens: 2048,
                    reserved_for_output: 256,
                    available_for_context: 1792,
                    used_for_context: 120,
                },
                diagnostics: MemoryContextDiagnostics {
                    retrieval_strategy: "lexical".to_string(),
                    assembly_notes: vec!["workspace overview".to_string()],
                },
            })
        );

        assert!(workspace_prompt.contains("Do not claim that you cannot access the repository or filesystem"));
        assert!(workspace_prompt.contains("workspace summary"));
    }
}
