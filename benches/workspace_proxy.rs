use std::sync::Arc;

use actix_web::{test, web, App};
use criterion::{criterion_group, criterion_main, Criterion};
use stepbit::api::workspace_routes;
use stepbit::memory::{MemoryClient, WorkspaceRecord};
use tokio::runtime::Runtime;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn bench_workspace_proxy_round_trips(c: &mut Criterion) {
    let runtime = Runtime::new().expect("tokio runtime");
    let server = runtime.block_on(MockServer::start());

    runtime.block_on(async {
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
            .mount(&server)
            .await;
    });

    let client = Arc::new(MemoryClient::new(server.uri(), None));
    let app = runtime.block_on(async {
        test::init_service(
            App::new()
                .app_data(web::Data::new(Some(client.clone())))
                .service(web::scope("/api").configure(workspace_routes::configure)),
        )
        .await
    });

    c.bench_function("workspace_proxy_list_workspaces", |bench| {
        bench.iter(|| {
            runtime.block_on(async {
                let resp = test::call_service(
                    &app,
                    test::TestRequest::get().uri("/api/workspaces").to_request(),
                )
                .await;
                assert!(resp.status().is_success());
            });
        });
    });

    c.bench_function("workspace_client_list_workspaces", |bench| {
        bench.iter(|| {
            runtime.block_on(async {
                let workspaces = client.list_workspaces().await.expect("list workspaces");
                assert_eq!(workspaces.len(), 1);
            });
        });
    });
}

criterion_group!(benches, bench_workspace_proxy_round_trips);
criterion_main!(benches);
