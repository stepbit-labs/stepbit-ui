use rusqlite::Connection;
use serde_json::json;
use stepbit::db::connection::SCHEMA;
use stepbit::db::service::DbService;

fn open_test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    conn
}

#[test]
fn test_raw_sql_query() {
    let conn = open_test_db();

    // 1. Simple SELECT
    let res = DbService::query_raw(&conn, "SELECT 1 as id, 'hello' as name").unwrap();
    assert_eq!(res.columns, vec!["id", "name"]);
    assert_eq!(res.rows[0]["id"], json!(1));
    assert_eq!(res.rows[0]["name"], json!("hello"));

    // 2. Querying schema tables
    DbService::insert_session(&conn, "Test Session", json!({})).unwrap();
    let res = DbService::query_raw(&conn, "SELECT name FROM sessions").unwrap();
    assert_eq!(res.rows[0]["name"], json!("Test Session"));

    // 3. Null value
    let res = DbService::query_raw(&conn, "SELECT null as n").unwrap();
    assert_eq!(res.rows[0]["n"], json!(null));
}

#[test]
fn test_query_error_handling() {
    let conn = open_test_db();
    let res = DbService::query_raw(&conn, "SELECT * FROM non_existent_table");
    assert!(res.is_err());
}
