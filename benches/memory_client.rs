use std::time::Duration;

use criterion::{criterion_group, criterion_main, Criterion};
use stepbit::memory::{ContextAssemblyRequest, ConversationTurn, MemoryClient, WorkspaceRegistrationRequest};
use tokio::runtime::Runtime;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn bench_memory_client_round_trips(c: &mut Criterion) {
    let runtime = Runtime::new().expect("tokio runtime");
    let server = runtime.block_on(MockServer::start());
    let client = MemoryClient::new(server.uri(), None);

    runtime.block_on(async {
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

        Mock::given(method("POST"))
            .and(path("/v1/context/assemble"))
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
    });

    c.bench_function("memory_client_register_workspace", |bench| {
        bench.iter(|| {
            runtime.block_on(async {
                client
                    .register_workspace(&WorkspaceRegistrationRequest {
                        id: "ws-1".to_string(),
                        name: "repo".to_string(),
                        root_path: "/tmp/repo".to_string(),
                        vcs_branch: Some("main".to_string()),
                        created_at: "2026-03-31T12:00:00Z".to_string(),
                    })
                    .await
                    .expect("register workspace");
            });
        });
    });

    c.bench_function("memory_client_assemble_context", |bench| {
        bench.iter(|| {
            runtime.block_on(async {
                client
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
                    .expect("assemble context");
            });
        });
    });

    runtime.block_on(async {
        tokio::time::sleep(Duration::from_millis(10)).await;
    });
}

criterion_group!(benches, bench_memory_client_round_trips);
criterion_main!(benches);
