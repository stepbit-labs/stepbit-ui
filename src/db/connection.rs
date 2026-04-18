use crate::config::DatabaseConfig;
use rusqlite::{Connection, Result as DbResult};
use std::sync::{Arc, Mutex};
use tracing::info;

pub type DbPool = Arc<Mutex<Connection>>;

pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    name       TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    metadata   TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    model       TEXT,
    token_count INTEGER,
    created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    metadata    TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS tool_results (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    source_url TEXT,
    content    TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tool_results_session ON tool_results(session_id);

CREATE TABLE IF NOT EXISTS skills (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    content    TEXT NOT NULL,
    tags       TEXT DEFAULT '',
    source_url TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS pipelines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    definition TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
"#;

pub fn get_connection(config: &DatabaseConfig) -> DbResult<DbPool> {
    info!("Connecting to SQLite at {}", config.path);
    let conn = if config.path == ":memory:" {
        Connection::open_in_memory()?
    } else {
        Connection::open(&config.path)?
    };

    init_schema(&conn)?;

    Ok(Arc::new(Mutex::new(conn)))
}

fn init_schema(conn: &Connection) -> DbResult<()> {
    info!("Initializing database schema");
    conn.execute_batch(SCHEMA)?;
    Ok(())
}
