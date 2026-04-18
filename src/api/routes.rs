use actix_web::{delete, get, patch, post, web, HttpResponse, Result as WebResult};
use actix_web::http::header::{ContentDisposition, DispositionParam, DispositionType};
use reqwest::Client;
use uuid::Uuid;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::api::models::{
    CreateMessageRequest, CreateSessionRequest, PaginationQuery, SessionAutomationCommandResponse,
    SessionCronCreateRequest, SessionExecutionCommandResponse, SessionGoalRunRequest,
    SessionPipelineRunRequest, SessionReasoningRunRequest, SessionTriggerCreateRequest,
    UpdateSessionRequest,
};
use crate::db::{service::DbService, DbPool};
use crate::llm::{LlmProvider, models::{Message as LlmMessage, ChatOptions}};

#[derive(Debug, serde::Deserialize)]
pub struct QuantlabRunRequest {
    pub prompt: String,
    pub strategy: String,
    pub ticker: String,
    pub start: String,
    pub end: String,
    pub interval: Option<String>,
    pub rsi_buy_max: Option<f64>,
    pub rsi_sell_min: Option<f64>,
    pub cooldown_days: Option<i64>,
    pub timeout_seconds: Option<u64>,
    pub run_label: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct ArtifactQuery {
    pub path: String,
}

// --- Sessions ---

#[post("")]
pub async fn create_session(
    pool: web::Data<DbPool>,
    req: web::Json<CreateSessionRequest>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    let req = req.into_inner();
    
    match DbService::insert_session(&conn, &req.name, req.metadata) {
        Ok(session) => Ok(HttpResponse::Created().json(session)),
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

#[get("")]
pub async fn list_sessions(
    pool: web::Data<DbPool>,
    query: web::Query<PaginationQuery>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    
    match DbService::list_sessions(&conn, query.limit, query.offset) {
        Ok(sessions) => Ok(HttpResponse::Ok().json(sessions)),
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

#[delete("")]
pub async fn purge_all_sessions(
    pool: web::Data<DbPool>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    match DbService::purge_database(&conn) {
        Ok(_) => Ok(HttpResponse::NoContent().finish()),
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

#[get("/{id}")]
pub async fn get_session(
    pool: web::Data<DbPool>,
    id: web::Path<Uuid>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    
    match DbService::get_session(&conn, id.into_inner()) {
        Ok(Some(session)) => Ok(HttpResponse::Ok().json(session)),
        Ok(None) => Ok(HttpResponse::NotFound().finish()),
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

#[delete("/{id}")]
pub async fn delete_session(
    pool: web::Data<DbPool>,
    id: web::Path<Uuid>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    match DbService::delete_session(&conn, id.into_inner()) {
        Ok(_) => Ok(HttpResponse::NoContent().finish()),
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

#[patch("/{id}")]
pub async fn update_session(
    pool: web::Data<DbPool>,
    id: web::Path<Uuid>,
    req: web::Json<UpdateSessionRequest>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    match DbService::update_session(&conn, id.into_inner(), req.name.clone(), req.metadata.clone()) {
        Ok(Some(session)) => Ok(HttpResponse::Ok().json(session)),
        Ok(None) => Ok(HttpResponse::NotFound().finish()),
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

// --- Messages ---

#[post("/{id}/messages")]
pub async fn add_message(
    pool: web::Data<DbPool>,
    llm: web::Data<Arc<dyn LlmProvider>>,
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<Uuid>,
    req: web::Json<CreateMessageRequest>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    let id = id.into_inner();
    let req = req.into_inner();
    
    // Check if session exists first
    if DbService::get_session(&conn, id).unwrap_or(None).is_none() {
        return Ok(HttpResponse::NotFound().body("Session not found"));
    }

    let user_msg = match DbService::insert_message(
        &conn, 
        id, 
        &req.role, 
        &req.content, 
        req.model.as_deref(), 
        req.token_count, 
        req.metadata.clone()
    ) {
        Ok(message) => message,
        Err(e) => return Ok(HttpResponse::InternalServerError().body(e.to_string())),
    };

    let skip_completion = req.role != "user"
        || req
            .metadata
            .get("source")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|source| source.ends_with("-slash-command"));

    // If it's not a standard user chat message, we don't trigger the LLM completion.
    if skip_completion {
        return Ok(HttpResponse::Created().json(user_msg));
    }

    // Fetch history for LLM Context
    let history = match DbService::get_messages(&conn, id, 50, 0) {
        Ok(msgs) => msgs,
        Err(e) => return Ok(HttpResponse::InternalServerError().body(e.to_string())),
    };

    let mut llm_messages: Vec<LlmMessage> = history.into_iter().map(|m| {
        let tool_calls = m.metadata.get("tool_calls").and_then(|tc| serde_json::from_value(tc.clone()).ok());
        let tool_call_id = m.metadata.get("tool_call_id").and_then(|tid| tid.as_str().map(|s| s.to_string()));
        LlmMessage {
            role: m.role,
            content: m.content,
            tool_calls,
            tool_call_id,
        }
    }).collect();

    // Drop the DuckDB connection lock
    drop(conn);

    let tools = crate::tools::ToolRegistry::new();
    let current_date = chrono::Local::now().format("%A, %B %d, %Y").to_string();
    let system_prompt = config.chat.system_prompt.replace("{current_date}", &current_date);
    let grounded_prompt = format!("Current Date: {}.\n\n{}", current_date, system_prompt);
    
    let current_options = ChatOptions {
        model: req.model,
        system_prompt: Some(grounded_prompt),
        tools: Some(tools.get_definitions()),
        ..Default::default()
    };

    let mut loop_count = 0;
    let max_loops = 5;

    while loop_count < max_loops {
        let response = match llm.chat(&llm_messages, current_options.clone()).await {
            Ok(res) => res,
            Err(e) => return Ok(HttpResponse::InternalServerError().body(format!("LLM Error: {}", e))),
        };

        // If no tool calls, we're done
        if response.tool_calls.as_ref().map(|tc| tc.is_empty()).unwrap_or(true) {
            // Re-lock the DB pool to insert the assistant's context
            let conn = pool.lock().unwrap();
            let token_count = response.usage.as_ref().map(|u| u.input_tokens + u.output_tokens).map(|t| t as i32);

            return match DbService::insert_message(
                &conn,
                id,
                "assistant",
                &response.content,
                Some(&response.model),
                token_count,
                serde_json::json!({}),
            ) {
                Ok(assistant_msg) => Ok(HttpResponse::Created().json(assistant_msg)),
                Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
            };
        }

        // Handle tool calls
        let mut assistant_tool_calls = Vec::new();
        let tool_calls = response.tool_calls.unwrap();
        
        for tool_call in &tool_calls {
            assistant_tool_calls.push(tool_call.clone());
        }

        // 1. Add assistant message with tool calls to history
        llm_messages.push(LlmMessage {
            role: "assistant".to_string(),
            content: response.content.clone(),
            tool_calls: Some(assistant_tool_calls.clone()),
            tool_call_id: None,
        });

        // 2. Persist assistant message (optional but good for history)
        {
            let conn = pool.lock().unwrap();
            let _ = DbService::insert_message(
                &conn,
                id,
                "assistant",
                &response.content,
                Some(&response.model),
                None, // We'll count tokens at the end or skip here
                serde_json::json!({ "tool_calls": assistant_tool_calls }),
            );
        }

        // 3. Execute tools
        for tool_call in tool_calls {
            let tool_id = tool_call.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
            let result = tools.call_tool(&tool_call.function.name, &tool_call.function.arguments, id, pool.get_ref().clone()).await;
            
            llm_messages.push(LlmMessage {
                role: "tool".to_string(),
                content: result.clone(),
                tool_calls: None,
                tool_call_id: Some(tool_id.clone()),
            });

            // Re-lock the DB pool to insert the tool result
            {
                let conn = pool.lock().unwrap();
                let _ = DbService::insert_message(
                    &conn,
                    id,
                    "tool",
                    &result,
                    None,
                    None,
                    serde_json::json!({ "tool_call_id": tool_id }),
                );
            }
        }

        loop_count += 1;
    }

    Ok(HttpResponse::InternalServerError().body("Max tool call loops reached"))
}

#[get("/{id}/messages")]
pub async fn get_messages(
    pool: web::Data<DbPool>,
    id: web::Path<Uuid>,
    query: web::Query<PaginationQuery>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    
    match DbService::get_messages(&conn, id.into_inner(), query.limit, query.offset) {
        Ok(messages) => Ok(HttpResponse::Ok().json(messages)),
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

#[get("/{id}/artifacts")]
pub async fn get_session_artifact(
    pool: web::Data<DbPool>,
    id: web::Path<Uuid>,
    query: web::Query<ArtifactQuery>,
) -> WebResult<HttpResponse> {
    let session_id = id.into_inner();
    {
        let conn = pool.lock().unwrap();
        if DbService::get_session(&conn, session_id).unwrap_or(None).is_none() {
            return Ok(HttpResponse::NotFound().body("Session not found"));
        }
    }

    let requested_path = PathBuf::from(&query.path);
    let resolved_path = match resolve_served_artifact_path(&requested_path) {
        Ok(path) => path,
        Err(error) => return Ok(HttpResponse::BadRequest().body(error)),
    };

    let bytes = fs::read(&resolved_path)
        .map_err(actix_web::error::ErrorInternalServerError)?;
    let file_name = resolved_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("artifact")
        .to_string();

    Ok(HttpResponse::Ok()
        .content_type(artifact_content_type(&resolved_path))
        .insert_header(ContentDisposition {
            disposition: DispositionType::Inline,
            parameters: vec![DispositionParam::Filename(file_name)],
        })
        .body(bytes))
}

#[get("/{id}/export")]
pub async fn export_session(
    pool: web::Data<DbPool>,
    id: web::Path<Uuid>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    let id = id.into_inner();

    let session = match DbService::get_session(&conn, id) {
        Ok(Some(s)) => s,
        Ok(None) => return Ok(HttpResponse::NotFound().finish()),
        Err(e) => return Ok(HttpResponse::InternalServerError().body(e.to_string())),
    };

    let messages = DbService::get_messages(&conn, id, 1000, 0).unwrap_or_default();
    
    let mut export = String::new();
    export.push_str(&format!("Session: {}\n", session.name));
    export.push_str(&format!("ID: {}\n", session.id));
    export.push_str(&format!("Created At: {}\n", session.created_at));
    export.push_str("---\n");

    for m in messages {
        export.push_str(&format!("[{}]: {}\n", m.role.to_uppercase(), m.content));
        export.push_str("---\n");
    }

    Ok(HttpResponse::Ok()
        .content_type("text/plain")
        .insert_header(("Content-Disposition", format!("attachment; filename=\"session_{}.txt\"", id)))
        .body(export))
}

#[post("/import")]
pub async fn import_session(
    pool: web::Data<DbPool>,
    body: String,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    let mut lines = body.lines();
    
    let name = lines.next()
        .and_then(|l| l.strip_prefix("Session: "))
        .unwrap_or("Imported Session");
        
    match DbService::insert_session(&conn, name, serde_json::json!({})) {
        Ok(session) => {
            let mut current_role = String::new();
            let mut current_content = String::new();
            
            for line in lines {
                if line == "---" {
                    if !current_role.is_empty() && !current_content.is_empty() {
                        let _ = DbService::insert_message(
                            &conn, session.id, &current_role.to_lowercase(), 
                            &current_content.trim(), None, None, serde_json::json!({})
                        );
                        current_content.clear();
                    }
                } else if line.starts_with("[") && line.contains("]: ") {
                    if let (Some(start), Some(end)) = (line.find('['), line.find(']')) {
                        current_role = line[start+1..end].to_string();
                        current_content = line[end+2..].to_string();
                    }
                } else {
                    current_content.push_str("\n");
                    current_content.push_str(line);
                }
            }
            Ok(HttpResponse::Created().json(session))
        }
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

#[get("/stats")]
pub async fn get_stats(
    pool: web::Data<DbPool>,
    config: web::Data<crate::config::AppConfig>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    match DbService::get_stats(&conn, &config.database.path) {
        Ok(stats) => Ok(HttpResponse::Ok().json(stats)),
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

#[get("/llm/mcp/tools")]
pub async fn list_mcp_tools(
    llm: web::Data<Arc<dyn LlmProvider>>,
) -> WebResult<HttpResponse> {
    match llm.get_mcp_tools().await {
        Ok(tools) => Ok(HttpResponse::Ok().json(tools)),
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

#[post("/{id}/quantlab/run")]
pub async fn run_quantlab(
    pool: web::Data<DbPool>,
    llm: web::Data<Arc<dyn LlmProvider>>,
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<Uuid>,
    req: web::Json<QuantlabRunRequest>,
) -> WebResult<HttpResponse> {
    let session_id = id.into_inner();

    {
        let conn = pool.lock().unwrap();
        if DbService::get_session(&conn, session_id).unwrap_or(None).is_none() {
            return Ok(HttpResponse::NotFound().body("Session not found"));
        }
    }

    let Some(stepbit_core) = config.llm.stepbit_core.as_ref() else {
        return Ok(HttpResponse::BadRequest().body("stepbit-core provider is not configured"));
    };

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(actix_web::error::ErrorInternalServerError)?;

    let req = req.into_inner();
    let interval = req.interval.clone().unwrap_or_else(|| "1d".to_string());
    let payload = serde_json::json!({
        "input": {
            "strategy": req.strategy,
            "date_range": {
                "start": req.start,
                "end": req.end
            },
            "features": {
                "ticker": req.ticker,
                "interval": interval
            },
            "parameters": {
                "rsi_buy_max": req.rsi_buy_max,
                "rsi_sell_min": req.rsi_sell_min,
                "cooldown_days": req.cooldown_days
            },
            "timeout_seconds": req.timeout_seconds,
            "run_label": req.run_label
        }
    });

    let url = format!(
        "{}/v1/mcp/tools/quantlab_run/call",
        stepbit_core.base_url.trim_end_matches('/')
    );
    let mut request = client.post(url).json(&payload);
    if let Some(api_key) = stepbit_core.api_key.as_ref() {
        request = request.bearer_auth(api_key);
    }

    let response = request
        .send()
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Ok(HttpResponse::BadGateway().body(format!(
            "quantlab_run failed with status {}: {}",
            status, body
        )));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;
    let tool_output = body
        .get("output")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    let structured_response = build_quantlab_structured_response(&tool_output);
    let summary = structured_response["output"]
        .as_array()
        .and_then(|items| items.last())
        .and_then(|item| item["content"].as_array())
        .and_then(|content| content.first())
        .and_then(|content| content["text"].as_str())
        .unwrap_or("QuantLab run completed.")
        .to_string();

    let inserted = {
        let conn = pool.lock().unwrap();
        DbService::insert_message(
            &conn,
            session_id,
            "assistant",
            &summary,
            Some("quantlab_run"),
            None,
            serde_json::json!({
                "source": "quantlab-slash-command",
                "prompt": req.prompt,
                "quantlab_request": {
                    "strategy": req.strategy,
                    "ticker": req.ticker,
                    "start": req.start,
                    "end": req.end,
                    "interval": req.interval,
                    "rsi_buy_max": req.rsi_buy_max,
                    "rsi_sell_min": req.rsi_sell_min,
                    "cooldown_days": req.cooldown_days,
                    "timeout_seconds": req.timeout_seconds,
                    "run_label": req.run_label,
                },
                "structured_response": structured_response,
            }),
        )
    }
    .map_err(actix_web::error::ErrorInternalServerError)?;

    if let Some(analysis) = generate_quantlab_analysis(llm.get_ref().clone(), &req.prompt, &tool_output).await {
        let conn = pool.lock().unwrap();
        let _ = DbService::insert_message(
            &conn,
            session_id,
            "assistant",
            &analysis,
            Some("quantlab_run_analysis"),
            None,
            serde_json::json!({
                "source": "quantlab-analysis",
                "run_id": tool_output["run_id"].as_str(),
                "execution_run_id": tool_output["run_id"].as_str(),
                "tool_name": "quantlab_run",
            }),
        );
    }

    Ok(HttpResponse::Ok().json(SessionExecutionCommandResponse {
        message_id: inserted.id,
        run_id: tool_output["run_id"].as_str().unwrap_or_default().to_string(),
        summary,
        structured_response,
    }))
}

#[post("/{id}/goals/run")]
pub async fn run_goal(
    pool: web::Data<DbPool>,
    llm: web::Data<Arc<dyn LlmProvider>>,
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<Uuid>,
    req: web::Json<SessionGoalRunRequest>,
) -> WebResult<HttpResponse> {
    let session_id = id.into_inner();
    ensure_session_exists(&pool, session_id)?;

    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(120)?;
    let req = req.into_inner();
    let payload = serde_json::json!({ "goal": req.goal });
    let body = post_stepbit_core_json(&client, stepbit_core, "/v1/goals/execute", &payload).await?;
    let structured_response = build_goal_structured_response(&body);
    let summary = extract_structured_response_summary(&structured_response, "Goal run completed.");
    let run_id = body["run_id"].as_str().unwrap_or_default().to_string();

    let inserted = insert_execution_assistant_message(
        &pool,
        session_id,
        "goal_run",
        &summary,
        serde_json::json!({
            "source": "goal-slash-command",
            "prompt": req.prompt,
            "goal_request": {
                "goal": req.goal,
            },
            "execution_run_id": run_id,
            "structured_response": structured_response,
        }),
    )?;

    if let Some(analysis) = generate_execution_analysis(
        llm.get_ref().clone(),
        "goal_run",
        &req.prompt,
        &body,
    )
    .await
    {
        let conn = pool.lock().unwrap();
        let _ = DbService::insert_message(
            &conn,
            session_id,
            "assistant",
            &analysis,
            Some("goal_run_analysis"),
            None,
            serde_json::json!({
                "source": "goal-analysis",
                "run_id": run_id,
                "execution_run_id": run_id,
                "tool_name": "goal_run",
            }),
        );
    }

    Ok(HttpResponse::Ok().json(SessionExecutionCommandResponse {
        message_id: inserted.id,
        run_id,
        summary,
        structured_response,
    }))
}

#[post("/{id}/reasoning/run")]
pub async fn run_reasoning_command(
    pool: web::Data<DbPool>,
    llm: web::Data<Arc<dyn LlmProvider>>,
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<Uuid>,
    req: web::Json<SessionReasoningRunRequest>,
) -> WebResult<HttpResponse> {
    let session_id = id.into_inner();
    ensure_session_exists(&pool, session_id)?;

    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(120)?;
    let req = req.into_inner();
    let payload = serde_json::json!({
        "graph": {
            "nodes": {
                "analysis": {
                    "id": "analysis",
                    "node_type": "LlmGeneration",
                    "payload": {
                        "prompt": req.question,
                        "max_tokens": req.max_tokens.unwrap_or(2048)
                    }
                }
            },
            "edges": []
        }
    });
    let body = post_stepbit_core_json(&client, stepbit_core, "/v1/reasoning/execute", &payload).await?;
    let structured_response = build_reasoning_structured_response(&body);
    let summary = extract_structured_response_summary(&structured_response, "Reasoning run completed.");
    let run_id = body["run_id"].as_str().unwrap_or_default().to_string();

    let inserted = insert_execution_assistant_message(
        &pool,
        session_id,
        "reasoning_run",
        &summary,
        serde_json::json!({
            "source": "reasoning-slash-command",
            "prompt": req.prompt,
            "reasoning_request": {
                "question": req.question,
                "max_tokens": req.max_tokens,
            },
            "execution_run_id": run_id,
            "structured_response": structured_response,
        }),
    )?;

    if let Some(analysis) = generate_execution_analysis(
        llm.get_ref().clone(),
        "reasoning_run",
        &req.prompt,
        &body,
    )
    .await
    {
        let conn = pool.lock().unwrap();
        let _ = DbService::insert_message(
            &conn,
            session_id,
            "assistant",
            &analysis,
            Some("reasoning_run_analysis"),
            None,
            serde_json::json!({
                "source": "reasoning-analysis",
                "run_id": run_id,
                "execution_run_id": run_id,
                "tool_name": "reasoning_run",
            }),
        );
    }

    Ok(HttpResponse::Ok().json(SessionExecutionCommandResponse {
        message_id: inserted.id,
        run_id,
        summary,
        structured_response,
    }))
}

#[post("/{id}/pipelines/run")]
pub async fn run_pipeline_command(
    pool: web::Data<DbPool>,
    llm: web::Data<Arc<dyn LlmProvider>>,
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<Uuid>,
    req: web::Json<SessionPipelineRunRequest>,
) -> WebResult<HttpResponse> {
    let session_id = id.into_inner();
    ensure_session_exists(&pool, session_id)?;

    let req = req.into_inner();
    let pipeline = {
        let conn = pool.lock().unwrap();
        match (req.pipeline_id, req.pipeline_name.as_deref()) {
            (Some(pipeline_id), _) => DbService::get_pipeline(&conn, pipeline_id)
                .map_err(actix_web::error::ErrorInternalServerError)?,
            (None, Some(pipeline_name)) => DbService::get_pipeline_by_name(&conn, pipeline_name)
                .map_err(actix_web::error::ErrorInternalServerError)?,
            (None, None) => {
                return Ok(HttpResponse::BadRequest().body("Pipeline id or name is required"));
            }
        }
    };

    let Some(pipeline) = pipeline else {
        return Ok(HttpResponse::NotFound().body("Pipeline not found"));
    };

    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(180)?;
    let payload = serde_json::json!({
        "pipeline": pipeline.definition,
        "question": req.question,
    });
    let body = post_stepbit_core_json(&client, stepbit_core, "/v1/pipelines/execute", &payload).await?;
    let structured_response = build_pipeline_structured_response(&body);
    let summary = extract_structured_response_summary(&structured_response, "Pipeline run completed.");
    let run_id = body["run_id"].as_str().unwrap_or_default().to_string();

    let inserted = insert_execution_assistant_message(
        &pool,
        session_id,
        "pipeline_run",
        &summary,
        serde_json::json!({
            "source": "pipeline-slash-command",
            "prompt": req.prompt,
            "pipeline_request": {
                "pipeline_id": pipeline.id,
                "pipeline_name": pipeline.name,
                "question": req.question,
            },
            "execution_run_id": run_id,
            "structured_response": structured_response,
        }),
    )?;

    if let Some(analysis) = generate_execution_analysis(
        llm.get_ref().clone(),
        "pipeline_run",
        &req.prompt,
        &body,
    )
    .await
    {
        let conn = pool.lock().unwrap();
        let _ = DbService::insert_message(
            &conn,
            session_id,
            "assistant",
            &analysis,
            Some("pipeline_run_analysis"),
            None,
            serde_json::json!({
                "source": "pipeline-analysis",
                "run_id": run_id,
                "execution_run_id": run_id,
                "tool_name": "pipeline_run",
            }),
        );
    }

    Ok(HttpResponse::Ok().json(SessionExecutionCommandResponse {
        message_id: inserted.id,
        run_id,
        summary,
        structured_response,
    }))
}

#[post("/{id}/cron/create")]
pub async fn create_cron_command(
    pool: web::Data<DbPool>,
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<Uuid>,
    req: web::Json<SessionCronCreateRequest>,
) -> WebResult<HttpResponse> {
    let session_id = id.into_inner();
    ensure_session_exists(&pool, session_id)?;

    let req = req.into_inner();
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(120)?;
    let execution_type = parse_cron_execution_type(&req.execution_type)?;
    let payload = build_cron_creation_payload(&pool, &req)?;
    let mut create_payload = serde_json::json!({
        "id": req.job_id.clone(),
        "schedule": req.schedule.clone(),
        "execution_type": execution_type,
        "payload": payload,
        "enabled": req.enabled.unwrap_or(false),
    });

    if let Some(retry_policy) = req.retry_policy.clone() {
        create_payload["retry_policy"] = retry_policy;
    }

    let _body = post_stepbit_core_json(&client, stepbit_core, "/v1/cron/jobs", &create_payload).await?;
    let summary = summarize_cron_creation(&req);
    let metadata = serde_json::json!({
        "source": "cron-create-slash-command",
        "prompt": req.prompt.clone(),
        "automation_id": req.job_id.clone(),
        "automation_kind": "cron_job",
        "cron_request": {
            "job_id": req.job_id.clone(),
            "schedule": req.schedule.clone(),
            "execution_type": req.execution_type.clone(),
            "enabled": req.enabled.unwrap_or(false),
            "goal": req.goal.clone(),
            "reasoning_prompt": req.reasoning_prompt.clone(),
            "max_tokens": req.max_tokens,
            "pipeline_id": req.pipeline_id,
            "pipeline_name": req.pipeline_name.clone(),
            "input_json": req.input_json.clone(),
            "retry_policy": req.retry_policy.clone(),
        }
    });
    let response_metadata = metadata.clone();

    let started_at = chrono::Utc::now().to_rfc3339();
    let inserted = insert_execution_assistant_message(
        &pool,
        session_id,
        "cron_create",
        &summary,
        build_automation_command_metadata(
            metadata,
            "cron_create",
            &started_at,
            serde_json::json!({
                "job_id": req.job_id.clone(),
                "schedule": req.schedule.clone(),
                "execution_type": req.execution_type.clone(),
                "enabled": req.enabled.unwrap_or(false),
                "goal": req.goal.clone(),
                "reasoning_prompt": req.reasoning_prompt.clone(),
                "max_tokens": req.max_tokens,
                "pipeline_id": req.pipeline_id,
                "pipeline_name": req.pipeline_name.clone(),
            }),
            req.job_id.clone(),
            "cron_job",
        ),
    )?;

    Ok(HttpResponse::Ok().json(SessionAutomationCommandResponse {
        message_id: inserted.id,
        automation_id: req.job_id.clone(),
        automation_kind: "cron_job".to_string(),
        summary,
        metadata: response_metadata,
    }))
}

#[post("/{id}/triggers/create")]
pub async fn create_trigger_command(
    pool: web::Data<DbPool>,
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<Uuid>,
    req: web::Json<SessionTriggerCreateRequest>,
) -> WebResult<HttpResponse> {
    let session_id = id.into_inner();
    ensure_session_exists(&pool, session_id)?;

    let req = req.into_inner();
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(120)?;
    let action = build_trigger_action_payload(&pool, &req)?;
    let create_payload = serde_json::json!({
        "id": req.trigger_id.clone(),
        "event_type": req.event_type.clone(),
        "condition": req.condition.clone(),
        "action": action,
    });

    let _body = post_stepbit_core_json(&client, stepbit_core, "/v1/triggers", &create_payload).await?;
    let summary = summarize_trigger_creation(&req);
    let metadata = serde_json::json!({
        "source": "trigger-create-slash-command",
        "prompt": req.prompt.clone(),
        "automation_id": req.trigger_id.clone(),
        "automation_kind": "trigger",
        "trigger_request": {
            "trigger_id": req.trigger_id.clone(),
            "event_type": req.event_type.clone(),
            "action_kind": req.action_kind.clone(),
            "goal": req.goal.clone(),
            "reasoning_prompt": req.reasoning_prompt.clone(),
            "max_tokens": req.max_tokens,
            "pipeline_id": req.pipeline_id,
            "pipeline_name": req.pipeline_name.clone(),
            "condition": req.condition.clone(),
        }
    });
    let response_metadata = metadata.clone();

    let started_at = chrono::Utc::now().to_rfc3339();
    let inserted = insert_execution_assistant_message(
        &pool,
        session_id,
        "trigger_create",
        &summary,
        build_automation_command_metadata(
            metadata,
            "trigger_create",
            &started_at,
            serde_json::json!({
                "trigger_id": req.trigger_id.clone(),
                "event_type": req.event_type.clone(),
                "action_kind": req.action_kind.clone(),
                "goal": req.goal.clone(),
                "reasoning_prompt": req.reasoning_prompt.clone(),
                "max_tokens": req.max_tokens,
                "pipeline_id": req.pipeline_id,
                "pipeline_name": req.pipeline_name.clone(),
                "condition": req.condition.clone(),
            }),
            req.trigger_id.clone(),
            "trigger",
        ),
    )?;

    Ok(HttpResponse::Ok().json(SessionAutomationCommandResponse {
        message_id: inserted.id,
        automation_id: req.trigger_id.clone(),
        automation_kind: "trigger".to_string(),
        summary,
        metadata: response_metadata,
    }))
}

fn ensure_session_exists(pool: &web::Data<DbPool>, session_id: Uuid) -> WebResult<()> {
    let conn = pool.lock().unwrap();
    if DbService::get_session(&conn, session_id)
        .map_err(actix_web::error::ErrorInternalServerError)?
        .is_none()
    {
        return Err(actix_web::error::ErrorNotFound("Session not found"));
    }

    Ok(())
}

fn require_stepbit_core<'a>(
    config: &'a crate::config::AppConfig,
) -> WebResult<&'a crate::config::config::StepbitCoreConfig> {
    config
        .llm
        .stepbit_core
        .as_ref()
        .ok_or_else(|| actix_web::error::ErrorBadRequest("stepbit-core provider is not configured"))
}

fn build_stepbit_core_client(timeout_seconds: u64) -> WebResult<Client> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_seconds))
        .build()
        .map_err(actix_web::error::ErrorInternalServerError)
}

async fn post_stepbit_core_json(
    client: &Client,
    stepbit_core: &crate::config::config::StepbitCoreConfig,
    path: &str,
    payload: &serde_json::Value,
) -> WebResult<serde_json::Value> {
    let url = format!("{}{}", stepbit_core.base_url.trim_end_matches('/'), path);
    let mut request = client.post(url).json(payload);
    if let Some(api_key) = stepbit_core.api_key.as_ref() {
        request = request.bearer_auth(api_key);
    }

    let response = request
        .send()
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(actix_web::error::ErrorBadGateway(format!(
            "stepbit-core request failed with status {}: {}",
            status, body
        )));
    }

    response
        .json()
        .await
        .map_err(actix_web::error::ErrorInternalServerError)
}

async fn get_stepbit_core_json(
    client: &Client,
    stepbit_core: &crate::config::config::StepbitCoreConfig,
    path: &str,
) -> WebResult<serde_json::Value> {
    let url = format!("{}{}", stepbit_core.base_url.trim_end_matches('/'), path);
    let mut request = client.get(url);
    if let Some(api_key) = stepbit_core.api_key.as_ref() {
        request = request.bearer_auth(api_key);
    }

    let response = request
        .send()
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(actix_web::error::ErrorBadGateway(format!(
            "stepbit-core request failed with status {}: {}",
            status, body
        )));
    }

    response
        .json()
        .await
        .map_err(actix_web::error::ErrorInternalServerError)
}

async fn delete_stepbit_core(
    client: &Client,
    stepbit_core: &crate::config::config::StepbitCoreConfig,
    path: &str,
) -> WebResult<()> {
    let url = format!("{}{}", stepbit_core.base_url.trim_end_matches('/'), path);
    let mut request = client.delete(url);
    if let Some(api_key) = stepbit_core.api_key.as_ref() {
        request = request.bearer_auth(api_key);
    }

    let response = request
        .send()
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(actix_web::error::ErrorBadGateway(format!(
            "stepbit-core request failed with status {}: {}",
            status, body
        )));
    }

    Ok(())
}

fn extract_structured_response_summary(
    structured_response: &serde_json::Value,
    fallback: &str,
) -> String {
    structured_response["output"]
        .as_array()
        .and_then(|items| items.last())
        .and_then(|item| item["content"].as_array())
        .and_then(|content| content.first())
        .and_then(|content| content["text"].as_str())
        .unwrap_or(fallback)
        .to_string()
}

fn insert_execution_assistant_message(
    pool: &web::Data<DbPool>,
    session_id: Uuid,
    model: &str,
    summary: &str,
    metadata: serde_json::Value,
) -> WebResult<crate::db::models::Message> {
    let conn = pool.lock().unwrap();
    DbService::insert_message(
        &conn,
        session_id,
        "assistant",
        summary,
        Some(model),
        None,
        metadata,
    )
    .map_err(actix_web::error::ErrorInternalServerError)
}

fn build_automation_command_metadata(
    mut metadata: serde_json::Value,
    command: &str,
    timestamp: &str,
    input: serde_json::Value,
    automation_id: String,
    automation_kind: &str,
) -> serde_json::Value {
    if let Some(object) = metadata.as_object_mut() {
        object.insert(
            "automation_command_status".to_string(),
            serde_json::json!({
                "command": command,
                "status": "success",
                "started_at": timestamp,
                "finished_at": timestamp,
                "input": input,
                "automation_id": automation_id,
                "automation_kind": automation_kind,
                "last_event": "CREATED",
            }),
        );
    }

    metadata
}

fn parse_cron_execution_type(
    execution_type: &str,
) -> WebResult<&'static str> {
    match execution_type.trim() {
        "Goal" => Ok("Goal"),
        "ReasoningGraph" => Ok("ReasoningGraph"),
        "Pipeline" => Ok("Pipeline"),
        _ => Err(actix_web::error::ErrorBadRequest(
            "execution_type must be Goal, ReasoningGraph, or Pipeline",
        )),
    }
}

fn build_reasoning_graph_definition(prompt: &str, max_tokens: Option<u32>) -> serde_json::Value {
    serde_json::json!({
        "nodes": {
            "analysis": {
                "id": "analysis",
                "node_type": "LlmGeneration",
                "payload": {
                    "prompt": prompt,
                    "max_tokens": max_tokens.unwrap_or(2048)
                }
            }
        },
        "edges": []
    })
}

fn resolve_pipeline_record(
    pool: &web::Data<DbPool>,
    pipeline_id: Option<i64>,
    pipeline_name: Option<&str>,
) -> WebResult<crate::db::models::Pipeline> {
    let conn = pool.lock().unwrap();
    let pipeline = match (pipeline_id, pipeline_name) {
        (Some(id), _) => DbService::get_pipeline(&conn, id)
            .map_err(actix_web::error::ErrorInternalServerError)?,
        (None, Some(name)) => DbService::get_pipeline_by_name(&conn, name)
            .map_err(actix_web::error::ErrorInternalServerError)?,
        (None, None) => {
            return Err(actix_web::error::ErrorBadRequest(
                "Pipeline id or name is required",
            ))
        }
    };

    pipeline.ok_or_else(|| actix_web::error::ErrorNotFound("Pipeline not found"))
}

fn build_cron_creation_payload(
    pool: &web::Data<DbPool>,
    req: &SessionCronCreateRequest,
) -> WebResult<serde_json::Value> {
    match req.execution_type.trim() {
        "Goal" => Ok(serde_json::json!({
            "goal": req.goal.clone().ok_or_else(|| actix_web::error::ErrorBadRequest("goal is required for Goal cron jobs"))?,
        })),
        "ReasoningGraph" => Ok(serde_json::json!({
            "graph": build_reasoning_graph_definition(
                req.reasoning_prompt
                    .as_deref()
                    .ok_or_else(|| actix_web::error::ErrorBadRequest("reasoning_prompt is required for ReasoningGraph cron jobs"))?,
                req.max_tokens,
            ),
        })),
        "Pipeline" => {
            let pipeline = resolve_pipeline_record(pool, req.pipeline_id, req.pipeline_name.as_deref())?;
            let input_data = match req.input_json.clone() {
                Some(value) if value.is_object() => value,
                Some(_) => return Err(actix_web::error::ErrorBadRequest("input_json must be a JSON object")),
                None => serde_json::json!({}),
            };

            Ok(serde_json::json!({
                "pipeline": pipeline.definition,
                "input_data": input_data,
            }))
        }
        _ => Err(actix_web::error::ErrorBadRequest(
            "execution_type must be Goal, ReasoningGraph, or Pipeline",
        )),
    }
}

fn build_trigger_action_payload(
    pool: &web::Data<DbPool>,
    req: &SessionTriggerCreateRequest,
) -> WebResult<serde_json::Value> {
    match req.action_kind.trim() {
        "goal" => Ok(serde_json::json!({
            "Goal": {
                "goal": req.goal.clone().ok_or_else(|| actix_web::error::ErrorBadRequest("goal is required for goal triggers"))?,
            }
        })),
        "reasoning" => Ok(serde_json::json!({
            "ReasoningGraph": {
                "graph": build_reasoning_graph_definition(
                    req.reasoning_prompt
                        .as_deref()
                        .ok_or_else(|| actix_web::error::ErrorBadRequest("reasoning_prompt is required for reasoning triggers"))?,
                    req.max_tokens,
                )
            }
        })),
        "pipeline" => {
            let pipeline = resolve_pipeline_record(pool, req.pipeline_id, req.pipeline_name.as_deref())?;
            Ok(serde_json::json!({
                "Pipeline": {
                    "pipeline": pipeline.definition,
                }
            }))
        }
        _ => Err(actix_web::error::ErrorBadRequest(
            "action_kind must be goal, reasoning, or pipeline",
        )),
    }
}

fn summarize_cron_creation(req: &SessionCronCreateRequest) -> String {
    let activation_note = if req.enabled.unwrap_or(false) {
        "Automatic scheduling is enabled."
    } else {
        "Automatic scheduling is disabled by default; use Automations to enable it or Run Now for a manual execution."
    };

    match req.execution_type.as_str() {
        "Goal" => format!(
            "Cron job `{}` created for `{}` on schedule `{}`. {}",
            req.job_id,
            req.goal.as_deref().unwrap_or("goal"),
            req.schedule,
            activation_note
        ),
        "ReasoningGraph" => format!(
            "Cron job `{}` created for a reasoning graph on schedule `{}`. {}",
            req.job_id, req.schedule, activation_note
        ),
        "Pipeline" => format!(
            "Cron job `{}` created for pipeline `{}` on schedule `{}`. {}",
            req.job_id,
            req.pipeline_name
                .as_deref()
                .unwrap_or_else(|| req.pipeline_id.as_ref().map(|id| if *id > 0 { "selected pipeline" } else { "pipeline" }).unwrap_or("pipeline")),
            req.schedule,
            activation_note
        ),
        _ => format!("Cron job `{}` created.", req.job_id),
    }
}

fn summarize_trigger_creation(req: &SessionTriggerCreateRequest) -> String {
    match req.action_kind.as_str() {
        "goal" => format!(
            "Trigger `{}` created for event `{}`. It will dispatch a goal when the event matches.",
            req.trigger_id, req.event_type
        ),
        "reasoning" => format!(
            "Trigger `{}` created for event `{}`. It will dispatch a reasoning graph when the event matches.",
            req.trigger_id, req.event_type
        ),
        "pipeline" => format!(
            "Trigger `{}` created for event `{}`. It will dispatch pipeline `{}` when the event matches.",
            req.trigger_id,
            req.event_type,
            req.pipeline_name
                .as_deref()
                .unwrap_or_else(|| req.pipeline_id.as_ref().map(|id| if *id > 0 { "selected pipeline" } else { "pipeline" }).unwrap_or("pipeline"))
        ),
        _ => format!("Trigger `{}` created.", req.trigger_id),
    }
}

fn build_quantlab_structured_response(tool_output: &serde_json::Value) -> serde_json::Value {
    let artifacts = tool_output["artifacts"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let mut output = vec![serde_json::json!({
        "id": "quantlab-tool-result-0",
        "item_type": "tool_result",
        "role": "tool",
        "status": "completed",
        "content": [
            {
                "content_type": "output_json",
                "text": serde_json::to_string(tool_output).unwrap_or_else(|_| "{}".to_string())
            }
        ]
    })];

    for (index, artifact) in artifacts.iter().enumerate() {
        output.push(serde_json::json!({
            "id": format!("quantlab-artifact-{index}"),
            "item_type": "artifact",
            "role": "assistant",
            "status": "completed",
            "content": [
                {
                    "content_type": "artifact",
                    "text": artifact_title(artifact),
                    "artifact": {
                        "family": detect_artifact_family(artifact),
                        "title": artifact_title(artifact),
                        "source_tool": "quantlab_run",
                        "data": artifact
                    }
                }
            ]
        }));
    }

    output.push(serde_json::json!({
        "id": "quantlab-message-0",
        "item_type": "message",
        "role": "assistant",
        "status": "completed",
        "content": [
            {
                "content_type": "output_text",
                "text": summarize_quantlab_output(tool_output)
            }
        ]
    }));

    serde_json::json!({
        "output": output,
        "metadata": {
            "execution_run_id": tool_output["run_id"],
            "command": "quantlab_run",
            "execution_kind": "quantlab"
        },
        "turn_context": {
            "used_tools": ["quantlab_run"]
        },
        "warnings": []
    })
}

fn build_goal_structured_response(goal_output: &serde_json::Value) -> serde_json::Value {
    let summary = summarize_goal_output(goal_output);
    serde_json::json!({
        "output": [
            {
                "id": "goal-tool-result-0",
                "item_type": "tool_result",
                "role": "tool",
                "status": "completed",
                "content": [
                    {
                        "content_type": "output_json",
                        "text": serde_json::to_string(goal_output).unwrap_or_else(|_| "{}".to_string())
                    }
                ]
            },
            {
                "id": "goal-message-0",
                "item_type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [
                    {
                        "content_type": "output_text",
                        "text": summary
                    }
                ]
            }
        ],
        "metadata": {
            "execution_run_id": goal_output["run_id"],
            "command": "goal_run",
            "execution_kind": "goal"
        },
        "turn_context": {
            "used_tools": ["goal_execute"]
        },
        "warnings": []
    })
}

fn build_reasoning_structured_response(reasoning_output: &serde_json::Value) -> serde_json::Value {
    let mut output = vec![serde_json::json!({
        "id": "reasoning-tool-result-0",
        "item_type": "tool_result",
        "role": "tool",
        "status": "completed",
        "content": [
            {
                "content_type": "output_json",
                "text": serde_json::to_string(reasoning_output).unwrap_or_else(|_| "{}".to_string())
            }
        ]
    })];

    if let Some(results) = reasoning_output.get("results").and_then(serde_json::Value::as_object) {
        for (index, (node_id, value)) in results.iter().enumerate() {
            output.push(serde_json::json!({
                "id": format!("reasoning-artifact-{index}"),
                "item_type": "artifact",
                "role": "assistant",
                "status": "completed",
                "content": [
                    {
                        "content_type": "artifact",
                        "text": node_id,
                        "artifact": {
                            "family": "json",
                            "title": node_id,
                            "source_tool": "reasoning_execute",
                            "data": value
                        }
                    }
                ]
            }));
        }
    }

    output.push(serde_json::json!({
        "id": "reasoning-message-0",
        "item_type": "message",
        "role": "assistant",
        "status": "completed",
        "content": [
            {
                "content_type": "output_text",
                "text": summarize_reasoning_output(reasoning_output)
            }
        ]
    }));

    serde_json::json!({
        "output": output,
        "metadata": {
            "execution_run_id": reasoning_output["run_id"],
            "command": "reasoning_run",
            "execution_kind": "reasoning"
        },
        "turn_context": {
            "used_tools": ["reasoning_execute"]
        },
        "warnings": []
    })
}

fn build_pipeline_structured_response(pipeline_output: &serde_json::Value) -> serde_json::Value {
    let tool_calls = pipeline_output["tool_calls"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let mut output = vec![serde_json::json!({
        "id": "pipeline-tool-result-0",
        "item_type": "tool_result",
        "role": "tool",
        "status": "completed",
        "content": [
            {
                "content_type": "output_json",
                "text": serde_json::to_string(pipeline_output).unwrap_or_else(|_| "{}".to_string())
            }
        ]
    })];

    for (tool_index, tool_output) in tool_calls.iter().enumerate() {
        let Some(artifacts) = tool_output.get("artifacts").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for (artifact_index, artifact) in artifacts.iter().enumerate() {
            output.push(serde_json::json!({
                "id": format!("pipeline-artifact-{tool_index}-{artifact_index}"),
                "item_type": "artifact",
                "role": "assistant",
                "status": "completed",
                "content": [
                    {
                        "content_type": "artifact",
                        "text": artifact_title(artifact),
                        "artifact": {
                            "family": detect_artifact_family(artifact),
                            "title": artifact_title(artifact),
                            "source_tool": "pipeline_execute",
                            "data": artifact
                        }
                    }
                ]
            }));
        }
    }

    output.push(serde_json::json!({
        "id": "pipeline-message-0",
        "item_type": "message",
        "role": "assistant",
        "status": "completed",
        "content": [
            {
                "content_type": "output_text",
                "text": summarize_pipeline_output(pipeline_output)
            }
        ]
    }));

    serde_json::json!({
        "output": output,
        "metadata": {
            "execution_run_id": pipeline_output["run_id"],
            "command": "pipeline_run",
            "execution_kind": "pipeline"
        },
        "turn_context": {
            "used_tools": ["pipeline_execute"]
        },
        "warnings": []
    })
}

async fn generate_quantlab_analysis(
    llm: Arc<dyn LlmProvider>,
    original_prompt: &str,
    tool_output: &serde_json::Value,
) -> Option<String> {
    let compact_payload = serde_json::json!({
        "status": tool_output["status"],
        "run_id": tool_output["run_id"],
        "machine_contract": tool_output["machine_contract"],
        "metrics": tool_output["metrics"],
        "errors": tool_output["errors"],
        "events": tool_output["events"],
        "artifacts": tool_output["artifacts"]
            .as_array()
            .map(|items| items.iter().take(8).cloned().collect::<Vec<_>>())
            .unwrap_or_default(),
    });

    let messages = vec![
        LlmMessage {
            role: "system".to_string(),
            content: "You are summarizing a completed QuantLab run for a user in chat. Use only the supplied result data. If the run succeeded, explain whether performance was positive or negative, cite the main metrics, mention one practical caveat, and propose one concrete next step. If the run failed, explain the failure and one correction. Keep it under 140 words, in concise Markdown, and do not invent missing values.".to_string(),
            tool_calls: None,
            tool_call_id: None,
        },
        LlmMessage {
            role: "user".to_string(),
            content: format!(
                "Original user command:\n{}\n\nQuantLab result payload:\n{}",
                original_prompt,
                serde_json::to_string_pretty(&compact_payload).ok()?
            ),
            tool_calls: None,
            tool_call_id: None,
        },
    ];

    let analysis_result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        llm.chat(
            &messages,
            ChatOptions {
                temperature: Some(0.2),
                max_tokens: Some(1024),
                ..Default::default()
            },
        ),
    )
    .await;

    match analysis_result {
        Ok(Ok(response)) => {
            let trimmed = response.content.trim();
            if trimmed.is_empty() {
                Some(fallback_quantlab_analysis(tool_output))
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => Some(fallback_quantlab_analysis(tool_output)),
    }
}

fn fallback_quantlab_analysis(tool_output: &serde_json::Value) -> String {
    let status = tool_output["status"].as_str().unwrap_or("unknown");
    let run_id = tool_output["run_id"].as_str().unwrap_or("unknown");
    let summary = tool_output["machine_contract"]["summary"]
        .as_object()
        .or_else(|| tool_output["metrics"].as_object());

    if status != "success" {
        let first_error = tool_output["errors"]
            .as_array()
            .and_then(|items| items.first())
            .and_then(|item| item["message"].as_str())
            .unwrap_or("QuantLab did not return a usable result.");
        return format!(
            "QuantLab no pudo completar el run `{}`. Error principal: {}. Revisa los parametros, el rango de fechas y los artifacts generados antes de reintentar.",
            run_id, first_error
        );
    }

    let total_return = summary
        .and_then(|value| value.get("total_return"))
        .and_then(serde_json::Value::as_f64);
    let sharpe = summary
        .and_then(|value| value.get("sharpe_simple").or_else(|| value.get("sharpe")))
        .and_then(serde_json::Value::as_f64);
    let drawdown = summary
        .and_then(|value| value.get("max_drawdown"))
        .and_then(serde_json::Value::as_f64);
    let trades = summary
        .and_then(|value| value.get("trades"))
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default();

    let performance_tone = match total_return {
        Some(value) if value > 0.0 => "El resultado es positivo",
        Some(value) if value < 0.0 => "El resultado es negativo",
        _ => "El resultado es mixto",
    };

    let next_step = match total_return {
        Some(value) if value > 0.0 && sharpe.unwrap_or(0.0) > 0.5 => {
            "Siguiente paso recomendado: repetir el run en otro periodo o ticker cercano para comprobar que no sea un ajuste demasiado localizado."
        }
        Some(value) if value <= 0.0 => {
            "Siguiente paso recomendado: variar RSI y cooldown con un sweep antes de volver a paper."
        }
        _ => "Siguiente paso recomendado: revisar report.json y trades.csv para entender la distribucion de entradas y salidas."
    };

    format!(
        "{} para el run `{}`: retorno {}, sharpe {}, drawdown maximo {} y {} trades. {}",
        performance_tone,
        run_id,
        total_return
            .map(|value| format!("{:.2}%", value * 100.0))
            .unwrap_or_else(|| "n/a".to_string()),
        sharpe
            .map(|value| format!("{:.3}", value))
            .unwrap_or_else(|| "n/a".to_string()),
        drawdown
            .map(|value| format!("{:.2}%", value * 100.0))
            .unwrap_or_else(|| "n/a".to_string()),
        trades,
        next_step
    )
}

async fn generate_execution_analysis(
    llm: Arc<dyn LlmProvider>,
    command: &str,
    original_prompt: &str,
    payload: &serde_json::Value,
) -> Option<String> {
    let system_prompt = match command {
        "goal_run" => "You are summarizing a completed goal execution for a user in chat. Use only the supplied result data. Explain whether it succeeded, describe the most important outcomes, cite one important risk or caveat, and propose one concrete next step. Keep it under 140 words in concise Markdown.",
        "reasoning_run" => "You are summarizing a completed reasoning graph execution for a user in chat. Use only the supplied result data. Explain what the reasoning resolved, highlight the most relevant node outputs, mention one limitation, and propose one concrete next step. Keep it under 140 words in concise Markdown.",
        "pipeline_run" => "You are summarizing a completed pipeline execution for a user in chat. Use only the supplied result data. Describe the final answer, mention the trace depth and any artifacts or tool calls, note one caveat, and propose one concrete next step. Keep it under 140 words in concise Markdown.",
        _ => return None,
    };

    let messages = vec![
        LlmMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
            tool_calls: None,
            tool_call_id: None,
        },
        LlmMessage {
            role: "user".to_string(),
            content: format!(
                "Original user command:\n{}\n\nExecution payload:\n{}",
                original_prompt,
                serde_json::to_string_pretty(payload).ok()?
            ),
            tool_calls: None,
            tool_call_id: None,
        },
    ];

    let analysis_result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        llm.chat(
            &messages,
            ChatOptions {
                temperature: Some(0.2),
                max_tokens: Some(1024),
                ..Default::default()
            },
        ),
    )
    .await;

    match analysis_result {
        Ok(Ok(response)) => {
            let trimmed = response.content.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => None,
    }
}

fn summarize_quantlab_output(tool_output: &serde_json::Value) -> String {
    let status = tool_output["status"].as_str().unwrap_or("unknown");
    let run_id = tool_output["run_id"].as_str().unwrap_or("unknown");
    let summary = tool_output["machine_contract"]["summary"]
        .as_object()
        .or_else(|| tool_output["metrics"].as_object());

    let total_return = summary
        .and_then(|value| value.get("total_return"))
        .map(render_metric_value)
        .unwrap_or_else(|| "n/a".to_string());
    let sharpe = summary
        .and_then(|value| value.get("sharpe_simple").or_else(|| value.get("sharpe")))
        .map(render_metric_value)
        .unwrap_or_else(|| "n/a".to_string());
    let drawdown = summary
        .and_then(|value| value.get("max_drawdown"))
        .map(render_metric_value)
        .unwrap_or_else(|| "n/a".to_string());
    let trades = summary
        .and_then(|value| value.get("trades"))
        .map(render_metric_value)
        .unwrap_or_else(|| "n/a".to_string());

    format!(
        "QuantLab run `{run_id}` finished with status `{status}`.\n\nReturn: {total_return}\nSharpe: {sharpe}\nMax drawdown: {drawdown}\nTrades: {trades}"
    )
}

fn summarize_goal_output(goal_output: &serde_json::Value) -> String {
    let run_id = goal_output["run_id"].as_str().unwrap_or("unknown");
    let success = goal_output["success"].as_bool().unwrap_or(false);
    let results = goal_output["results"]
        .as_object()
        .map(|value| value.len())
        .unwrap_or_default();
    let error = goal_output["error"].as_str().unwrap_or("n/a");

    if success {
        format!(
            "Goal run `{run_id}` completed successfully.\n\nProduced {results} result entries."
        )
    } else {
        format!(
            "Goal run `{run_id}` failed.\n\nError: {error}"
        )
    }
}

fn summarize_reasoning_output(reasoning_output: &serde_json::Value) -> String {
    let run_id = reasoning_output["run_id"].as_str().unwrap_or("unknown");
    let result_count = reasoning_output["results"]
        .as_object()
        .map(|value| value.len())
        .unwrap_or_default();

    format!(
        "Reasoning run `{run_id}` completed.\n\nResolved {result_count} nodes."
    )
}

fn summarize_pipeline_output(pipeline_output: &serde_json::Value) -> String {
    let run_id = pipeline_output["run_id"].as_str().unwrap_or("unknown");
    let final_answer = pipeline_output["final_answer"].as_str().unwrap_or("No final answer returned.");
    let trace_len = pipeline_output["trace"]
        .as_array()
        .map(|value| value.len())
        .unwrap_or_default();
    let tool_call_len = pipeline_output["tool_calls"]
        .as_array()
        .map(|value| value.len())
        .unwrap_or_default();

    format!(
        "Pipeline run `{run_id}` completed.\n\nFinal answer: {final_answer}\nTrace steps: {trace_len}\nTool calls: {tool_call_len}"
    )
}

fn render_metric_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Number(number) => number.to_string(),
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Bool(flag) => flag.to_string(),
        _ => "n/a".to_string(),
    }
}

fn artifact_title(artifact: &serde_json::Value) -> String {
    artifact["title"]
        .as_str()
        .or_else(|| artifact["name"].as_str())
        .or_else(|| artifact["path"].as_str())
        .unwrap_or("artifact")
        .to_string()
}

fn detect_artifact_family(artifact: &serde_json::Value) -> &'static str {
    let Some(object) = artifact.as_object() else {
        return "unknown";
    };

    if object
        .get("role")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|role| role == "chart")
    {
        return "chart";
    }
    if object.contains_key("headers") && object.contains_key("rows") {
        return "table";
    }
    if object.contains_key("svg")
        || object
            .get("content_type")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|content_type| content_type == "image/svg+xml")
    {
        return "svg";
    }
    if object.contains_key("markdown")
        || object
            .get("content_type")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|content_type| content_type == "text/markdown")
    {
        return "markdown";
    }
    if object.contains_key("path") {
        return "file";
    }
    "unknown"
}

fn resolve_served_artifact_path(requested_path: &Path) -> Result<PathBuf, String> {
    if !requested_path.is_absolute() {
        return Err("Artifact path must be absolute.".to_string());
    }

    let resolved = requested_path
        .canonicalize()
        .map_err(|_| format!("Artifact path does not exist: {}", requested_path.display()))?;

    if !resolved.is_file() {
        return Err(format!("Artifact is not a file: {}", resolved.display()));
    }

    let mut allowed_roots = Vec::new();
    if let Ok(root) = std::env::var("STEPBIT_QUANTLAB_ROOT") {
        if !root.trim().is_empty() {
            allowed_roots.push(PathBuf::from(root));
        }
    }
    if let Ok(current_dir) = std::env::current_dir() {
        if let Some(parent) = current_dir.parent() {
            allowed_roots.push(parent.join("quantlab"));
        }
    }
    allowed_roots.push(std::env::temp_dir().join("stepbit-core"));

    let mut resolved_allowed_roots = Vec::new();
    for root in allowed_roots {
        if let Ok(canonical_root) = root.canonicalize() {
            resolved_allowed_roots.push(canonical_root);
        }
    }

    if resolved_allowed_roots
        .iter()
        .any(|root| resolved.starts_with(root))
    {
        return Ok(resolved);
    }

    Err(format!(
        "Artifact path is outside allowed roots: {}",
        resolved.display()
    ))
}

fn artifact_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("json") => "application/json",
        Some("md") => "text/markdown; charset=utf-8",
        Some("csv") => "text/csv; charset=utf-8",
        Some("txt") | Some("log") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[post("/llm/reasoning/execute")]
pub async fn execute_reasoning(
    llm: web::Data<Arc<dyn LlmProvider>>,
    graph: web::Json<crate::llm::models::ReasoningGraph>,
) -> WebResult<HttpResponse> {
    match llm.execute_reasoning(graph.into_inner()).await {
        Ok(results) => Ok(HttpResponse::Ok().json(results)),
        Err(e) => Ok(HttpResponse::InternalServerError().body(e.to_string())),
    }
}

#[post("/llm/reasoning/execute/stream")]
pub async fn execute_reasoning_stream(
    llm: web::Data<Arc<dyn LlmProvider>>,
    graph: web::Json<crate::llm::models::ReasoningGraph>,
) -> WebResult<HttpResponse> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(100);
    let llm_clone = llm.get_ref().clone();
    let graph_inner = graph.into_inner();

    tokio::spawn(async move {
        if let Err(e) = llm_clone.execute_reasoning_streaming(graph_inner, tx).await {
            tracing::error!("Reasoning stream error: {}", e);
        }
    });

    let stream = async_stream::stream! {
        while let Some(value) = rx.recv().await {
            let data = format!("data: {}\n\n", serde_json::to_string(&value).unwrap());
            yield Ok::<bytes::Bytes, actix_web::Error>(bytes::Bytes::from(data));
        }
    };

    Ok(HttpResponse::Ok()
        .content_type("text/event-stream")
        .streaming(stream))
}

#[get("/automations/cron/status")]
pub async fn get_automations_cron_status(
    config: web::Data<crate::config::AppConfig>,
) -> WebResult<HttpResponse> {
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(30)?;
    let body = get_stepbit_core_json(&client, stepbit_core, "/v1/cron/status").await?;
    Ok(HttpResponse::Ok().json(body))
}

#[get("/automations/cron/jobs")]
pub async fn list_automation_cron_jobs(
    config: web::Data<crate::config::AppConfig>,
) -> WebResult<HttpResponse> {
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(30)?;
    let body = get_stepbit_core_json(&client, stepbit_core, "/v1/cron/jobs").await?;
    Ok(HttpResponse::Ok().json(body))
}

#[post("/automations/cron/jobs/{id}/trigger")]
pub async fn trigger_automation_cron_job(
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<String>,
) -> WebResult<HttpResponse> {
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(60)?;
    let path = format!("/v1/cron/jobs/{}/trigger", id.into_inner());
    let body = post_stepbit_core_json(&client, stepbit_core, &path, &serde_json::json!({})).await?;
    Ok(HttpResponse::Ok().json(body))
}

#[post("/automations/cron/jobs/{id}/enable")]
pub async fn enable_automation_cron_job(
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<String>,
) -> WebResult<HttpResponse> {
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(30)?;
    let path = format!("/v1/cron/jobs/{}/enable", id.into_inner());
    let body = post_stepbit_core_json(&client, stepbit_core, &path, &serde_json::json!({})).await?;
    Ok(HttpResponse::Ok().json(body))
}

#[post("/automations/cron/jobs/{id}/disable")]
pub async fn disable_automation_cron_job(
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<String>,
) -> WebResult<HttpResponse> {
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(30)?;
    let path = format!("/v1/cron/jobs/{}/disable", id.into_inner());
    let body = post_stepbit_core_json(&client, stepbit_core, &path, &serde_json::json!({})).await?;
    Ok(HttpResponse::Ok().json(body))
}

#[delete("/automations/cron/jobs/{id}")]
pub async fn delete_automation_cron_job(
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<String>,
) -> WebResult<HttpResponse> {
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(30)?;
    let path = format!("/v1/cron/jobs/{}", id.into_inner());
    delete_stepbit_core(&client, stepbit_core, &path).await?;
    Ok(HttpResponse::NoContent().finish())
}

#[get("/automations/triggers")]
pub async fn list_automation_triggers(
    config: web::Data<crate::config::AppConfig>,
) -> WebResult<HttpResponse> {
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(30)?;
    let body = get_stepbit_core_json(&client, stepbit_core, "/v1/triggers").await?;
    Ok(HttpResponse::Ok().json(body))
}

#[delete("/automations/triggers/{id}")]
pub async fn delete_automation_trigger(
    config: web::Data<crate::config::AppConfig>,
    id: web::Path<String>,
) -> WebResult<HttpResponse> {
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(30)?;
    let path = format!("/v1/triggers/{}", id.into_inner());
    delete_stepbit_core(&client, stepbit_core, &path).await?;
    Ok(HttpResponse::NoContent().finish())
}

#[get("/automations/events/recent")]
pub async fn list_automation_recent_events(
    config: web::Data<crate::config::AppConfig>,
    query: web::Query<crate::api::models::PaginationQuery>,
) -> WebResult<HttpResponse> {
    let stepbit_core = require_stepbit_core(&config)?;
    let client = build_stepbit_core_client(30)?;
    let path = format!("/v1/events/recent?limit={}", query.limit.clamp(1, 100));
    let body = get_stepbit_core_json(&client, stepbit_core, &path).await?;
    Ok(HttpResponse::Ok().json(body))
}

#[post("/query")]
pub async fn query_sql(
    pool: web::Data<DbPool>,
    req: web::Json<crate::api::models::SqlQueryRequest>,
) -> WebResult<HttpResponse> {
    let conn = pool.lock().unwrap();
    match DbService::query_raw(&conn, &req.sql) {
        Ok(result) => Ok(HttpResponse::Ok().json(result)),
        Err(e) => Ok(HttpResponse::BadRequest().body(e.to_string())),
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/sessions")

            .service(create_session)
            .service(list_sessions)
            .service(purge_all_sessions)
            .service(get_stats)
            .service(get_session)
            .service(update_session)
            .service(delete_session)
            .service(add_message)
            .service(get_messages)
            .service(get_session_artifact)
            .service(run_quantlab)
            .service(run_goal)
            .service(run_reasoning_command)
            .service(run_pipeline_command)
            .service(create_cron_command)
            .service(create_trigger_command)
            .service(export_session)
            .service(import_session)
    );
    
    cfg.service(query_sql);
    cfg.service(list_mcp_tools);
    cfg.service(execute_reasoning);
    cfg.service(execute_reasoning_stream);
    cfg.service(get_automations_cron_status);
    cfg.service(list_automation_cron_jobs);
    cfg.service(trigger_automation_cron_job);
    cfg.service(enable_automation_cron_job);
    cfg.service(disable_automation_cron_job);
    cfg.service(delete_automation_cron_job);
    cfg.service(list_automation_triggers);
    cfg.service(delete_automation_trigger);
    cfg.service(list_automation_recent_events);
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{http::StatusCode, test, App};
    use async_trait::async_trait;
    use tokio::sync::mpsc::Sender;
    use wiremock::matchers::{body_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    struct DummyLlmProvider;

    #[async_trait]
    impl crate::llm::LlmProvider for DummyLlmProvider {
        fn name(&self) -> &str {
            "dummy"
        }

        async fn chat(
            &self,
            _messages: &[crate::llm::models::Message],
            _options: ChatOptions,
        ) -> Result<crate::llm::models::ChatResponse, crate::llm::LlmError> {
            Ok(crate::llm::models::ChatResponse {
                content: "analysis".to_string(),
                model: "dummy".to_string(),
                usage: None,
                tool_calls: None,
            })
        }

        async fn chat_streaming(
            &self,
            _messages: &[crate::llm::models::Message],
            _options: ChatOptions,
            _tx: Sender<String>,
        ) -> Result<Option<Vec<crate::llm::models::ToolCall>>, crate::llm::LlmError> {
            Ok(None)
        }

        fn supported_models(&self) -> Vec<String> {
            vec!["dummy".to_string()]
        }

        fn default_model(&self) -> String {
            "dummy".to_string()
        }

        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    fn test_config(base_url: String) -> crate::config::AppConfig {
        crate::config::AppConfig {
            server: crate::config::ServerConfig {
                host: "127.0.0.1".to_string(),
                port: 8080,
            },
            database: crate::config::DatabaseConfig {
                path: ":memory:".to_string(),
            },
            auth: crate::config::AuthConfig {
                api_keys: vec!["sk-dev-key-123".to_string()],
                token_expiry_hours: 24,
            },
            llm: crate::config::LlmConfig {
                provider: "stepbit-core".to_string(),
                model: "dummy".to_string(),
                openai: None,
                anthropic: None,
                ollama: None,
                copilot: None,
                stepbit_core: Some(crate::config::StepbitCoreConfig {
                    base_url,
                    default_model: "dummy".to_string(),
                    api_key: Some("sk-dev-key-123".to_string()),
                }),
                stepbit_memory: None,
            },
            chat: crate::config::ChatConfig {
                max_history_messages: 50,
                system_prompt: "test".to_string(),
            },
        }
    }

    fn test_pool() -> DbPool {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::connection::SCHEMA).unwrap();
        Arc::new(std::sync::Mutex::new(conn))
    }

    fn app(
        pool: DbPool,
        config: crate::config::AppConfig,
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
            .app_data(web::Data::new(pool))
            .app_data(web::Data::new(config))
            .app_data(web::Data::new(Arc::new(DummyLlmProvider) as Arc<dyn LlmProvider>))
            .service(web::scope("/api").configure(configure))
    }

    fn insert_session(pool: &DbPool) -> Uuid {
        let conn = pool.lock().unwrap();
        DbService::insert_session(&conn, "Test Session", serde_json::json!({}))
            .unwrap()
            .id
    }

    #[actix_web::test]
    async fn goal_run_route_returns_explicit_run_id_and_structured_metadata() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/goals/execute"))
            .and(body_json(serde_json::json!({ "goal": "Audit quantlab workspace" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "run_id": "goalrun-test-1",
                "success": true,
                "results": { "summary": "ok" }
            })))
            .mount(&mock)
            .await;

        let pool = test_pool();
        let session_id = insert_session(&pool);
        let app = test::init_service(app(pool.clone(), test_config(mock.uri()))).await;

        let response: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/sessions/{session_id}/goals/run"))
                .set_json(serde_json::json!({
                    "prompt": "/goal-run Audit quantlab workspace",
                    "goal": "Audit quantlab workspace"
                }))
                .to_request(),
        )
        .await;

        assert_eq!(response["run_id"], "goalrun-test-1");
        assert_eq!(response["structured_response"]["metadata"]["execution_run_id"], "goalrun-test-1");
    }

    #[actix_web::test]
    async fn reasoning_run_route_builds_single_node_graph_and_returns_run_id() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/reasoning/execute"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "run_id": "reasonrun-test-1",
                "results": { "analysis": { "status": "generated", "output": "done" } }
            })))
            .mount(&mock)
            .await;

        let pool = test_pool();
        let session_id = insert_session(&pool);
        let app = test::init_service(app(pool.clone(), test_config(mock.uri()))).await;

        let response: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/sessions/{session_id}/reasoning/run"))
                .set_json(serde_json::json!({
                    "prompt": "/reasoning-run prompt=\"Inspect repo\" max_tokens=256",
                    "question": "Inspect repo",
                    "max_tokens": 256
                }))
                .to_request(),
        )
        .await;

        assert_eq!(response["run_id"], "reasonrun-test-1");
        assert_eq!(response["structured_response"]["metadata"]["execution_run_id"], "reasonrun-test-1");
    }

    #[actix_web::test]
    async fn pipeline_run_route_resolves_pipeline_and_returns_run_id() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/pipelines/execute"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "run_id": "piperun-test-1",
                "final_answer": "Pipeline done",
                "trace": ["stage 1"],
                "tool_calls": [],
                "intermediate_results": []
            })))
            .mount(&mock)
            .await;

        let pool = test_pool();
        let session_id = insert_session(&pool);
        {
            let conn = pool.lock().unwrap();
            let _ = DbService::insert_pipeline(
                &conn,
                "Daily Compare",
                serde_json::json!({
                    "name": "Daily Compare",
                    "stages": []
                }),
            )
            .unwrap();
        }
        let app = test::init_service(app(pool.clone(), test_config(mock.uri()))).await;

        let response: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/sessions/{session_id}/pipelines/run"))
                .set_json(serde_json::json!({
                    "prompt": "/pipeline-run name=\"Daily Compare\" question=\"Compare the last two runs\"",
                    "pipeline_name": "Daily Compare",
                    "question": "Compare the last two runs"
                }))
                .to_request(),
        )
        .await;

        assert_eq!(response["run_id"], "piperun-test-1");
        assert_eq!(response["structured_response"]["metadata"]["execution_run_id"], "piperun-test-1");
    }

    #[actix_web::test]
    async fn missing_session_returns_not_found_for_execution_commands() {
        let mock = MockServer::start().await;
        let pool = test_pool();
        let app = test::init_service(app(pool, test_config(mock.uri()))).await;

        let response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/sessions/{}/goals/run", Uuid::new_v4()))
                .set_json(serde_json::json!({
                    "prompt": "/goal-run x",
                    "goal": "x"
                }))
                .to_request(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn cron_create_route_builds_goal_payload_and_persists_confirmation() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/cron/jobs"))
            .and(body_json(serde_json::json!({
                "id": "daily_quant",
                "schedule": "0 9 * * *",
                "execution_type": "Goal",
                "payload": {
                    "goal": "Monitor quantlab daily"
                },
                "enabled": false
            })))
            .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
                "status": "created"
            })))
            .mount(&mock)
            .await;

        let pool = test_pool();
        let session_id = insert_session(&pool);
        let app = test::init_service(app(pool, test_config(mock.uri()))).await;

        let response: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/sessions/{session_id}/cron/create"))
                .set_json(serde_json::json!({
                    "prompt": "/cron-create id=daily_quant schedule=\"0 9 * * *\" type=goal goal=\"Monitor quantlab daily\"",
                    "job_id": "daily_quant",
                    "schedule": "0 9 * * *",
                    "execution_type": "Goal",
                    "goal": "Monitor quantlab daily"
                }))
                .to_request(),
        )
        .await;

        assert_eq!(response["automation_id"], "daily_quant");
        assert_eq!(response["automation_kind"], "cron_job");
        assert_eq!(response["metadata"]["automation_id"], "daily_quant");
        assert_eq!(response["metadata"]["cron_request"]["enabled"], false);
    }

    #[actix_web::test]
    async fn cron_create_route_resolves_pipeline_by_name() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/cron/jobs"))
            .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
                "status": "created"
            })))
            .mount(&mock)
            .await;

        let pool = test_pool();
        let session_id = insert_session(&pool);
        {
            let conn = pool.lock().unwrap();
            let _ = DbService::insert_pipeline(
                &conn,
                "Daily Compare",
                serde_json::json!({
                    "name": "Daily Compare",
                    "stages": []
                }),
            )
            .unwrap();
        }
        let app = test::init_service(app(pool, test_config(mock.uri()))).await;

        let response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/sessions/{session_id}/cron/create"))
                .set_json(serde_json::json!({
                    "prompt": "/cron-create id=daily_pipe schedule=\"0 11 * * *\" type=pipeline name=\"Daily Compare\"",
                    "job_id": "daily_pipe",
                    "schedule": "0 11 * * *",
                    "execution_type": "Pipeline",
                    "pipeline_name": "Daily Compare"
                }))
                .to_request(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn trigger_create_route_builds_reasoning_action_and_returns_trigger_id() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/triggers"))
            .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
                "status": "trigger_created"
            })))
            .mount(&mock)
            .await;

        let pool = test_pool();
        let session_id = insert_session(&pool);
        let app = test::init_service(app(pool, test_config(mock.uri()))).await;

        let response: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/sessions/{session_id}/triggers/create"))
                .set_json(serde_json::json!({
                    "prompt": "/trigger-create id=workspace_drift event=workspace.index.completed action=reasoning prompt=\"Explain drift\" max_tokens=256",
                    "trigger_id": "workspace_drift",
                    "event_type": "workspace.index.completed",
                    "action_kind": "reasoning",
                    "reasoning_prompt": "Explain drift",
                    "max_tokens": 256
                }))
                .to_request(),
        )
        .await;

        assert_eq!(response["automation_id"], "workspace_drift");
        assert_eq!(response["automation_kind"], "trigger");
    }

    #[actix_web::test]
    async fn automation_create_routes_fail_when_pipeline_is_missing() {
        let mock = MockServer::start().await;
        let pool = test_pool();
        let session_id = insert_session(&pool);
        let app = test::init_service(app(pool, test_config(mock.uri()))).await;

        let response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri(&format!("/api/sessions/{session_id}/triggers/create"))
                .set_json(serde_json::json!({
                    "prompt": "/trigger-create id=pipe_trigger event=quantlab.completed action=pipeline name=\"Missing Pipeline\"",
                    "trigger_id": "pipe_trigger",
                    "event_type": "quantlab.completed",
                    "action_kind": "pipeline",
                    "pipeline_name": "Missing Pipeline"
                }))
                .to_request(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn automation_routes_proxy_cron_status_and_recent_events() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/cron/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "scheduler_running": true,
                "total_jobs": 2,
                "failing_jobs": 0,
                "retrying_jobs": 1
            })))
            .mount(&mock)
            .await;
        Mock::given(method("GET"))
            .and(path("/v1/events/recent"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "events": [{
                    "id": "evt-1",
                    "event_type": "trigger.dispatched",
                    "payload": {},
                    "timestamp": "2026-04-05T10:00:00Z"
                }]
            })))
            .mount(&mock)
            .await;

        let pool = test_pool();
        let app = test::init_service(app(pool, test_config(mock.uri()))).await;

        let cron_status = test::call_service(
            &app,
            test::TestRequest::get().uri("/api/automations/cron/status").to_request(),
        )
        .await;
        assert_eq!(cron_status.status(), StatusCode::OK);

        let recent_events = test::call_service(
            &app,
            test::TestRequest::get()
                .uri("/api/automations/events/recent?limit=10")
                .to_request(),
        )
        .await;
        assert_eq!(recent_events.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn automation_routes_proxy_cron_trigger_and_delete() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/cron/jobs/job-1/trigger"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status": "triggered",
                "run_id": "cronrun-test-1"
            })))
            .mount(&mock)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/cron/jobs/job-1/enable"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status": "enabled"
            })))
            .mount(&mock)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/cron/jobs/job-1/disable"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status": "disabled"
            })))
            .mount(&mock)
            .await;
        Mock::given(method("DELETE"))
            .and(path("/v1/cron/jobs/job-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status": "deleted"
            })))
            .mount(&mock)
            .await;

        let pool = test_pool();
        let app = test::init_service(app(pool, test_config(mock.uri()))).await;

        let trigger_response: serde_json::Value = test::call_and_read_body_json(
            &app,
            test::TestRequest::post()
                .uri("/api/automations/cron/jobs/job-1/trigger")
                .to_request(),
        )
        .await;
        assert_eq!(trigger_response["run_id"], "cronrun-test-1");

        let enable_response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/automations/cron/jobs/job-1/enable")
                .to_request(),
        )
        .await;
        assert_eq!(enable_response.status(), StatusCode::OK);

        let disable_response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/api/automations/cron/jobs/job-1/disable")
                .to_request(),
        )
        .await;
        assert_eq!(disable_response.status(), StatusCode::OK);

        let delete_response = test::call_service(
            &app,
            test::TestRequest::delete()
                .uri("/api/automations/cron/jobs/job-1")
                .to_request(),
        )
        .await;
        assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);
    }

    #[actix_web::test]
    async fn automation_routes_proxy_triggers() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/triggers"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "triggers": [{
                    "id": "trigger-1",
                    "event_type": "quantlab.completed",
                    "condition": null,
                    "action": { "Goal": { "goal": "summarize" } }
                }]
            })))
            .mount(&mock)
            .await;
        Mock::given(method("DELETE"))
            .and(path("/v1/triggers/trigger-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status": "trigger_deleted"
            })))
            .mount(&mock)
            .await;

        let pool = test_pool();
        let app = test::init_service(app(pool, test_config(mock.uri()))).await;

        let trigger_list = test::call_service(
            &app,
            test::TestRequest::get().uri("/api/automations/triggers").to_request(),
        )
        .await;
        assert_eq!(trigger_list.status(), StatusCode::OK);

        let delete_response = test::call_service(
            &app,
            test::TestRequest::delete()
                .uri("/api/automations/triggers/trigger-1")
                .to_request(),
        )
        .await;
        assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);
    }
}
