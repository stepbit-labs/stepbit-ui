#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::json;
    use stepbit::db::connection::SCHEMA;
    use stepbit::db::service::DbService;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    #[tokio::test]
    async fn test_pipeline_crud() {
        let conn = setup_test_db();
        let name = "Revenue Analysis";
        let definition = json!({
            "stages": [
                { "stage_type": "LlmStage", "config": { "prompt": "Analyze revenue" } }
            ]
        });

        // 1. Insert
        let pipeline = DbService::insert_pipeline(&conn, name, definition.clone()).unwrap();
        assert_eq!(pipeline.name, name);

        // 2. List
        let pipelines = DbService::list_pipelines(&conn, 10, 0).unwrap();
        assert_eq!(pipelines.len(), 1);

        // 3. Get
        let fetched = DbService::get_pipeline(&conn, pipeline.id).unwrap().unwrap();
        assert_eq!(fetched.name, name);

        // 4. Delete
        DbService::delete_pipeline(&conn, pipeline.id).unwrap();
        let fetched_after = DbService::get_pipeline(&conn, pipeline.id).unwrap();
        assert!(fetched_after.is_none());
    }

    #[tokio::test]
    async fn test_pipeline_execution_orchestration() {
        use stepbit::llm::stepbit_core::StepbitCoreProvider;
        use stepbit::llm::LlmProvider;
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let mock_server = MockServer::start().await;
        let provider =
            StepbitCoreProvider::new(mock_server.uri(), "phi-4".to_string(), None);

        Mock::given(method("POST"))
            .and(path("/v1/pipelines/execute"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "final_answer": "The revenue is $1M",
                "trace": ["Stage 1 complete"],
                "tool_calls": [],
                "intermediate_results": []
            })))
            .mount(&mock_server)
            .await;

        let definition = json!({ "name": "test", "stages": [] });
        let result = provider
            .execute_pipeline(definition, "What is the revenue?".to_string())
            .await
            .unwrap();

        assert_eq!(result.final_answer, "The revenue is $1M");
        assert_eq!(result.trace.len(), 1);
    }
}
