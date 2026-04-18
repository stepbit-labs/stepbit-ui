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
fn test_session_lifecycle() {
    let conn = open_test_db();

    let session = DbService::insert_session(&conn, "Test Chat", json!({"source": "test"})).unwrap();
    assert_eq!(session.name, "Test Chat");

    let fetched = DbService::get_session(&conn, session.id).unwrap().unwrap();
    assert_eq!(fetched.id, session.id);

    let list = DbService::list_sessions(&conn, 10, 0).unwrap();
    assert_eq!(list.len(), 1);

    DbService::delete_session(&conn, session.id).unwrap();
    let deleted = DbService::get_session(&conn, session.id).unwrap();
    assert!(deleted.is_none());
}

#[test]
fn test_message_lifecycle() {
    let conn = open_test_db();
    let session = DbService::insert_session(&conn, "Test Chat 2", json!({})).unwrap();

    let msg1 = DbService::insert_message(
        &conn, session.id, "system", "You are a bot", None, None, json!({}),
    ).unwrap();

    let msg2 = DbService::insert_message(
        &conn, session.id, "user", "Hello!", None, Some(5), json!({}),
    ).unwrap();

    assert_eq!(msg1.role, "system");
    assert_eq!(msg1.session_id, session.id);
    assert_eq!(msg2.token_count, Some(5));

    let history = DbService::get_messages(&conn, session.id, 10, 0).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].role, "system");
    assert_eq!(history[1].role, "user");

    DbService::delete_session(&conn, session.id).unwrap();
    let empty_history = DbService::get_messages(&conn, session.id, 10, 0).unwrap();
    assert_eq!(empty_history.len(), 0);
}

// ── New tests required by task 003 ──────────────────────────────────────────

#[test]
fn test_insert_session_round_trips_all_fields() {
    let conn = open_test_db();
    let meta = json!({"client": "test", "version": 1});

    let inserted = DbService::insert_session(&conn, "round-trip", meta.clone()).unwrap();
    let fetched = DbService::get_session(&conn, inserted.id).unwrap().unwrap();

    assert_eq!(fetched.name, "round-trip");
    assert_eq!(fetched.metadata["client"], "test");
    assert_eq!(fetched.metadata["version"], 1);
    assert_eq!(fetched.id, inserted.id);
}

#[test]
fn test_insert_message_ascending_order() {
    let conn = open_test_db();
    let session = DbService::insert_session(&conn, "order test", json!({})).unwrap();

    DbService::insert_message(&conn, session.id, "user", "first", None, None, json!({})).unwrap();
    DbService::insert_message(&conn, session.id, "assistant", "second", None, None, json!({})).unwrap();
    DbService::insert_message(&conn, session.id, "user", "third", None, None, json!({})).unwrap();

    let messages = DbService::get_messages(&conn, session.id, 10, 0).unwrap();
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0].content, "first");
    assert_eq!(messages[1].content, "second");
    assert_eq!(messages[2].content, "third");
}

#[test]
fn test_delete_session_removes_messages() {
    let conn = open_test_db();
    let session = DbService::insert_session(&conn, "to delete", json!({})).unwrap();

    DbService::insert_message(&conn, session.id, "user", "msg1", None, None, json!({})).unwrap();
    DbService::insert_message(&conn, session.id, "assistant", "msg2", None, None, json!({})).unwrap();

    DbService::delete_session(&conn, session.id).unwrap();

    assert!(DbService::get_session(&conn, session.id).unwrap().is_none());
    assert_eq!(DbService::get_messages(&conn, session.id, 10, 0).unwrap().len(), 0);
}

#[test]
fn test_skill_round_trip() {
    let conn = open_test_db();

    let skill = DbService::insert_skill(&conn, "My Skill", "Skill content", "tag1,tag2", None).unwrap();
    let fetched = DbService::get_skill(&conn, skill.id).unwrap().unwrap();

    assert_eq!(fetched.name, "My Skill");
    assert_eq!(fetched.content, "Skill content");
    assert_eq!(fetched.tags, "tag1,tag2");
    assert!(fetched.source_url.is_none());

    let list = DbService::list_skills(&conn, 10, 0).unwrap();
    assert_eq!(list.len(), 1);

    DbService::delete_skill(&conn, skill.id).unwrap();
    assert!(DbService::get_skill(&conn, skill.id).unwrap().is_none());
}

#[test]
fn test_pipeline_find_by_name_case_insensitive() {
    let conn = open_test_db();
    let definition = json!({"stages": []});

    DbService::insert_pipeline(&conn, "RevenueAnalysis", definition.clone()).unwrap();

    let found = DbService::get_pipeline_by_name(&conn, "revenueanalysis").unwrap();
    assert!(found.is_some());
    assert_eq!(found.unwrap().name, "RevenueAnalysis");

    let not_found = DbService::get_pipeline_by_name(&conn, "other").unwrap();
    assert!(not_found.is_none());
}

#[test]
fn test_list_sessions_empty_db_returns_empty_vec() {
    let conn = open_test_db();
    let result = DbService::list_sessions(&conn, 10, 0).unwrap();
    assert!(result.is_empty());
}
