use actix_web::{delete, get, patch, post, web, HttpResponse, Result as WebResult};
use actix_web::http::header::{ContentDisposition, DispositionParam, DispositionType};
use reqwest::Client;
use uuid::Uuid;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::api::models::{CreateMessageRequest, CreateSessionRequest, UpdateSessionRequest, PaginationQuery};
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

#[derive(Debug, serde::Serialize)]
struct QuantlabRunResponse {
    message_id: i64,
    summary: String,
    structured_response: serde_json::Value,
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
            .is_some_and(|source| source == "quantlab-slash-command");

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
                "tool_name": "quantlab_run",
            }),
        );
    }

    Ok(HttpResponse::Ok().json(QuantlabRunResponse {
        message_id: inserted.id,
        summary,
        structured_response,
    }))
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
        "turn_context": {
            "used_tools": ["quantlab_run"]
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
        std::time::Duration::from_secs(12),
        llm.chat(
            &messages,
            ChatOptions {
                temperature: Some(0.2),
                max_tokens: Some(220),
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
            .service(export_session)
            .service(import_session)
    );
    
    cfg.service(query_sql);
    cfg.service(list_mcp_tools);
    cfg.service(execute_reasoning);
    cfg.service(execute_reasoning_stream);
}
