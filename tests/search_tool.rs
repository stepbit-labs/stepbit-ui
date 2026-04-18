#[cfg(test)]
mod tests {
    use stepbit::tools::search::SearchTool;
    use stepbit::tools::Tool;

    #[tokio::test]
    async fn test_search_tool_definition() {
        let tool = SearchTool::new();
        let def = tool.definition();
        assert_eq!(def.function.name, "internet_search");
    }

    #[tokio::test]
    async fn test_search_tool_execution() {
        // This test requires internet access.
        let tool = SearchTool::new();
        let session_id = uuid::Uuid::new_v4();

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tool_results (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                source_url TEXT,
                content    TEXT NOT NULL,
                created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            );",
        )
        .unwrap();
        let pool = std::sync::Arc::new(std::sync::Mutex::new(conn));

        let result = tool
            .call(r#"{"query": "rust programming language"}"#, session_id, pool)
            .await;

        println!(
            "Search Result Snippet: {}",
            result.chars().take(200).collect::<String>()
        );
        assert!(!result.contains("Error"));
        assert!(!result.is_empty());
        assert!(result.contains("Source ID:"));
    }
}
