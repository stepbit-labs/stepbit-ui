use crate::db::models::{Message, Pipeline, Session, Skill, ToolResult};
use chrono::{DateTime, Utc};
use rusqlite::{params, params_from_iter, types::Value, Connection, Result as DbResult, Row};
use uuid::Uuid;

pub struct DbService;

impl DbService {
    fn row_to_session(row: &Row) -> DbResult<Session> {
        let meta_str: String = row.get(4)?;
        let metadata = serde_json::from_str(&meta_str).unwrap_or(serde_json::json!({}));

        let created_str: String = row.get(2)?;
        let updated_str: String = row.get(3)?;

        let created_at = created_str.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now());
        let updated_at = updated_str.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now());

        Ok(Session {
            id: row.get::<_, String>(0)?.parse().unwrap_or_default(),
            name: row.get::<_, String>(1)?,
            created_at,
            updated_at,
            metadata,
        })
    }

    fn row_to_message(row: &Row) -> DbResult<Message> {
        let meta_str: String = row.get(7)?;
        let metadata = serde_json::from_str(&meta_str).unwrap_or(serde_json::json!({}));

        let created_str: String = row.get(6)?;
        let created_at = created_str.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now());

        Ok(Message {
            id: row.get(0)?,
            session_id: row.get::<_, String>(1)?.parse().unwrap_or_default(),
            role: row.get::<_, String>(2)?,
            content: row.get::<_, String>(3)?,
            model: row.get::<_, Option<String>>(4)?,
            token_count: row.get::<_, Option<i32>>(5)?,
            created_at,
            metadata,
        })
    }

    fn row_to_tool_result(row: &Row) -> DbResult<ToolResult> {
        let created_str: String = row.get(4)?;
        let created_at = created_str.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now());

        Ok(ToolResult {
            id: row.get(0)?,
            session_id: row.get::<_, String>(1)?.parse().unwrap_or_default(),
            source_url: row.get::<_, String>(2)?,
            content: row.get::<_, String>(3)?,
            created_at,
        })
    }

    fn row_to_skill(row: &Row) -> DbResult<Skill> {
        let created_str: String = row.get(5)?;
        let updated_str: String = row.get(6)?;

        let created_at = created_str.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now());
        let updated_at = updated_str.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now());

        Ok(Skill {
            id: row.get(0)?,
            name: row.get::<_, String>(1)?,
            content: row.get::<_, String>(2)?,
            tags: row.get::<_, String>(3).unwrap_or_default(),
            source_url: row.get::<_, Option<String>>(4)?,
            created_at,
            updated_at,
        })
    }

    fn row_to_pipeline(row: &Row) -> DbResult<Pipeline> {
        let def_str: String = row.get(2)?;
        let definition = serde_json::from_str(&def_str).unwrap_or(serde_json::json!({}));

        let created_str: String = row.get(3)?;
        let updated_str: String = row.get(4)?;

        let created_at = created_str.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now());
        let updated_at = updated_str.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now());

        Ok(Pipeline {
            id: row.get(0)?,
            name: row.get::<_, String>(1)?,
            definition,
            created_at,
            updated_at,
        })
    }

    // --- Session Operations ---

    pub fn insert_session(
        conn: &Connection,
        name: &str,
        metadata: serde_json::Value,
    ) -> DbResult<Session> {
        let id = Uuid::new_v4();
        let meta_str = metadata.to_string();

        conn.execute(
            "INSERT INTO sessions (id, name, metadata) VALUES (?, ?, ?)",
            params![id.to_string(), name, meta_str],
        )?;

        Self::get_session(conn, id).map(|s| s.unwrap())
    }

    pub fn get_session(conn: &Connection, id: Uuid) -> DbResult<Option<Session>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at, updated_at, metadata FROM sessions WHERE id = ?",
        )?;
        let mut rows = stmt.query_map(params![id.to_string()], Self::row_to_session)?;

        if let Some(row) = rows.next() {
            Ok(Some(row?))
        } else {
            Ok(None)
        }
    }

    pub fn list_sessions(
        conn: &Connection,
        limit: usize,
        offset: usize,
    ) -> DbResult<Vec<Session>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at, updated_at, metadata \
             FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        )?;
        let rows =
            stmt.query_map(params![limit as i64, offset as i64], Self::row_to_session)?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    pub fn delete_session(conn: &Connection, id: Uuid) -> DbResult<()> {
        let id_str = id.to_string();
        conn.execute("DELETE FROM messages WHERE session_id = ?", params![id_str])?;
        conn.execute("DELETE FROM sessions WHERE id = ?", params![id_str])?;
        Ok(())
    }

    pub fn update_session(
        conn: &Connection,
        id: Uuid,
        name: Option<String>,
        metadata: Option<serde_json::Value>,
    ) -> DbResult<Option<Session>> {
        let mut updates = Vec::new();
        let mut params_vec: Vec<Value> = Vec::new();

        if let Some(n) = name {
            updates.push("name = ?");
            params_vec.push(Value::Text(n));
        }
        if let Some(m) = metadata {
            updates.push("metadata = ?");
            params_vec.push(Value::Text(m.to_string()));
        }

        if updates.is_empty() {
            return Self::get_session(conn, id);
        }

        updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

        let sql = format!(
            "UPDATE sessions SET {} WHERE id = ?",
            updates.join(", ")
        );
        params_vec.push(Value::Text(id.to_string()));

        conn.execute(&sql, params_from_iter(params_vec))?;
        Self::get_session(conn, id)
    }

    // --- Message Operations ---

    pub fn insert_message(
        conn: &Connection,
        session_id: Uuid,
        role: &str,
        content: &str,
        model: Option<&str>,
        token_count: Option<i32>,
        metadata: serde_json::Value,
    ) -> DbResult<Message> {
        let meta_str = metadata.to_string();

        conn.execute(
            "INSERT INTO messages (session_id, role, content, model, token_count, metadata) \
             VALUES (?, ?, ?, ?, ?, ?)",
            params![
                session_id.to_string(),
                role,
                content,
                model,
                token_count,
                meta_str
            ],
        )?;

        conn.execute(
            "UPDATE sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            params![session_id.to_string()],
        )?;

        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, model, token_count, created_at, metadata \
             FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![session_id.to_string()], Self::row_to_message)?;

        Ok(rows.next().unwrap()?)
    }

    pub fn get_messages(
        conn: &Connection,
        session_id: Uuid,
        limit: usize,
        offset: usize,
    ) -> DbResult<Vec<Message>> {
        let mut stmt = conn.prepare(
            "SELECT * FROM ( \
                SELECT id, session_id, role, content, model, token_count, created_at, metadata \
                FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ? OFFSET ? \
             ) sub ORDER BY id ASC",
        )?;

        let rows = stmt.query_map(
            params![session_id.to_string(), limit as i64, offset as i64],
            Self::row_to_message,
        )?;

        let mut messages = Vec::new();
        for row in rows {
            messages.push(row?);
        }
        Ok(messages)
    }

    // --- Tool Result Operations ---

    pub fn insert_tool_result(
        conn: &Connection,
        session_id: Uuid,
        source_url: &str,
        content: &str,
    ) -> DbResult<ToolResult> {
        conn.execute(
            "INSERT INTO tool_results (session_id, source_url, content) VALUES (?, ?, ?)",
            params![session_id.to_string(), source_url, content],
        )?;

        let mut stmt = conn.prepare(
            "SELECT id, session_id, source_url, content, created_at \
             FROM tool_results WHERE session_id = ? ORDER BY id DESC LIMIT 1",
        )?;
        let mut rows =
            stmt.query_map(params![session_id.to_string()], Self::row_to_tool_result)?;

        Ok(rows.next().unwrap()?)
    }

    pub fn get_tool_result(conn: &Connection, id: i64) -> DbResult<Option<ToolResult>> {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, source_url, content, created_at \
             FROM tool_results WHERE id = ?",
        )?;
        let mut rows = stmt.query_map(params![id], Self::row_to_tool_result)?;

        if let Some(row) = rows.next() {
            Ok(Some(row?))
        } else {
            Ok(None)
        }
    }

    // --- Stats ---

    pub fn get_stats(
        conn: &Connection,
        db_path: &str,
    ) -> DbResult<crate::api::models::SystemStats> {
        let total_sessions: i64 =
            conn.query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))?;
        let total_messages: i64 =
            conn.query_row("SELECT count(*) FROM messages", [], |r| r.get(0))?;
        let total_tokens: i64 = conn.query_row(
            "SELECT coalesce(sum(token_count), 0) FROM messages",
            [],
            |r| r.get(0),
        )?;

        let db_size_bytes = std::fs::metadata(db_path)
            .map(|m| m.len())
            .unwrap_or(0);

        Ok(crate::api::models::SystemStats {
            total_sessions,
            total_messages,
            total_tokens,
            db_size_bytes,
            memory_usage: vec![],
        })
    }

    // --- Purge ---

    pub fn purge_database(conn: &Connection) -> DbResult<()> {
        conn.execute_batch(
            "DROP TABLE IF EXISTS messages;
             DROP TABLE IF EXISTS tool_results;
             DROP TABLE IF EXISTS sessions;
             DROP TABLE IF EXISTS skills;
             DROP TABLE IF EXISTS pipelines;",
        )?;

        conn.execute_batch(crate::db::connection::SCHEMA)
    }

    // --- Skill Operations ---

    pub fn insert_skill(
        conn: &Connection,
        name: &str,
        content: &str,
        tags: &str,
        source_url: Option<&str>,
    ) -> DbResult<Skill> {
        conn.execute(
            "INSERT INTO skills (name, content, tags, source_url) VALUES (?, ?, ?, ?)",
            params![name, content, tags, source_url],
        )?;

        let mut stmt = conn.prepare(
            "SELECT id, name, content, tags, source_url, created_at, updated_at \
             FROM skills ORDER BY id DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map([], Self::row_to_skill)?;
        Ok(rows.next().unwrap()?)
    }

    pub fn list_skills(
        conn: &Connection,
        limit: usize,
        offset: usize,
    ) -> DbResult<Vec<Skill>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, content, tags, source_url, created_at, updated_at \
             FROM skills ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        )?;
        let rows =
            stmt.query_map(params![limit as i64, offset as i64], Self::row_to_skill)?;
        let mut skills = Vec::new();
        for row in rows {
            skills.push(row?);
        }
        Ok(skills)
    }

    pub fn get_skill(conn: &Connection, id: i64) -> DbResult<Option<Skill>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, content, tags, source_url, created_at, updated_at \
             FROM skills WHERE id = ?",
        )?;
        let mut rows = stmt.query_map(params![id], Self::row_to_skill)?;
        if let Some(row) = rows.next() {
            Ok(Some(row?))
        } else {
            Ok(None)
        }
    }

    pub fn update_skill(
        conn: &Connection,
        id: i64,
        name: Option<String>,
        content: Option<String>,
        tags: Option<String>,
    ) -> DbResult<Option<Skill>> {
        let mut updates = Vec::new();
        let mut params_vec: Vec<Value> = Vec::new();

        if let Some(n) = name {
            updates.push("name = ?");
            params_vec.push(Value::Text(n));
        }
        if let Some(c) = content {
            updates.push("content = ?");
            params_vec.push(Value::Text(c));
        }
        if let Some(t) = tags {
            updates.push("tags = ?");
            params_vec.push(Value::Text(t));
        }

        if updates.is_empty() {
            return Self::get_skill(conn, id);
        }

        updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

        let sql = format!("UPDATE skills SET {} WHERE id = ?", updates.join(", "));
        params_vec.push(Value::Integer(id));

        conn.execute(&sql, params_from_iter(params_vec))?;
        Self::get_skill(conn, id)
    }

    pub fn delete_skill(conn: &Connection, id: i64) -> DbResult<()> {
        conn.execute("DELETE FROM skills WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn preload_skills_from_dir(conn: &Connection, dir_path: &str) -> DbResult<usize> {
        let mut count = 0;
        if let Ok(entries) = std::fs::read_dir(dir_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file()
                    && path.extension().and_then(|e| e.to_str()) == Some("md")
                {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let mut name = String::new();
                        let mut tags = String::new();
                        let mut in_frontmatter = false;

                        for line in content.lines() {
                            if line.starts_with("---") {
                                if in_frontmatter {
                                    in_frontmatter = false;
                                } else if name.is_empty() {
                                    in_frontmatter = true;
                                }
                                continue;
                            }

                            if in_frontmatter {
                                if let Some(n) = line.strip_prefix("name: ") {
                                    name = n.trim().to_string();
                                } else if let Some(n) = line.strip_prefix("name:") {
                                    name = n.trim().to_string();
                                } else if let Some(t) = line.strip_prefix("tags: ") {
                                    tags = t.trim().to_string();
                                } else if let Some(t) = line.strip_prefix("tags:") {
                                    tags = t.trim().to_string();
                                }
                            }
                        }

                        if name.is_empty() {
                            if let Some(stem) =
                                path.file_stem().and_then(|s| s.to_str())
                            {
                                name = stem.replace('_', " ");
                                name = name
                                    .chars()
                                    .enumerate()
                                    .map(|(i, c)| {
                                        if i == 0 {
                                            c.to_ascii_uppercase()
                                        } else {
                                            c
                                        }
                                    })
                                    .collect();
                            } else {
                                name = "Unnamed Skill".to_string();
                            }
                        }

                        let exists: i64 = conn.query_row(
                            "SELECT count(*) FROM skills WHERE name = ?",
                            params![name],
                            |r| r.get(0),
                        )?;

                        if exists == 0 {
                            Self::insert_skill(conn, &name, content.trim(), &tags, None)?;
                            count += 1;
                        }
                    }
                }
            }
        }
        Ok(count)
    }

    // --- Raw query ---

    pub fn query_raw(
        conn: &Connection,
        sql: &str,
    ) -> DbResult<crate::api::models::SqlQueryResponse> {
        let mut stmt = conn.prepare(sql)?;
        let col_names: Vec<String> =
            stmt.column_names().into_iter().map(|s| s.to_string()).collect();

        let mut rows = stmt.query([])?;
        let mut results = Vec::new();

        while let Some(row) = rows.next()? {
            let mut row_obj = serde_json::Map::new();
            for (i, col_name) in col_names.iter().enumerate() {
                let value: Value = row.get(i)?;

                let json_val = match value {
                    Value::Null => serde_json::Value::Null,
                    Value::Integer(v) => serde_json::Value::Number(v.into()),
                    Value::Real(v) => serde_json::Number::from_f64(v)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null),
                    Value::Text(t) => serde_json::Value::String(t),
                    Value::Blob(b) => serde_json::Value::String(format!("blob({})", b.len())),
                };
                row_obj.insert(col_name.clone(), json_val);
            }
            results.push(serde_json::Value::Object(row_obj));
        }

        Ok(crate::api::models::SqlQueryResponse {
            columns: col_names,
            rows: results,
        })
    }

    // --- Pipeline Operations ---

    pub fn insert_pipeline(
        conn: &Connection,
        name: &str,
        definition: serde_json::Value,
    ) -> DbResult<Pipeline> {
        let def_str = definition.to_string();
        conn.execute(
            "INSERT INTO pipelines (name, definition) VALUES (?, ?)",
            params![name, def_str],
        )?;

        let mut stmt = conn.prepare(
            "SELECT id, name, definition, created_at, updated_at \
             FROM pipelines ORDER BY id DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map([], Self::row_to_pipeline)?;
        Ok(rows.next().unwrap()?)
    }

    pub fn get_pipeline(conn: &Connection, id: i64) -> DbResult<Option<Pipeline>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, definition, created_at, updated_at \
             FROM pipelines WHERE id = ?",
        )?;
        let mut rows = stmt.query_map(params![id], Self::row_to_pipeline)?;
        if let Some(row) = rows.next() {
            Ok(Some(row?))
        } else {
            Ok(None)
        }
    }

    pub fn get_pipeline_by_name(
        conn: &Connection,
        name: &str,
    ) -> DbResult<Option<Pipeline>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, definition, created_at, updated_at \
             FROM pipelines WHERE lower(name) = lower(?) ORDER BY updated_at DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![name], Self::row_to_pipeline)?;
        if let Some(row) = rows.next() {
            Ok(Some(row?))
        } else {
            Ok(None)
        }
    }

    pub fn list_pipelines(
        conn: &Connection,
        limit: usize,
        offset: usize,
    ) -> DbResult<Vec<Pipeline>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, definition, created_at, updated_at \
             FROM pipelines ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        )?;
        let rows =
            stmt.query_map(params![limit as i64, offset as i64], Self::row_to_pipeline)?;
        let mut pipelines = Vec::new();
        for row in rows {
            pipelines.push(row?);
        }
        Ok(pipelines)
    }

    pub fn update_pipeline(
        conn: &Connection,
        id: i64,
        name: Option<String>,
        definition: Option<serde_json::Value>,
    ) -> DbResult<Option<Pipeline>> {
        let mut updates = Vec::new();
        let mut params_vec: Vec<Value> = Vec::new();

        if let Some(n) = name {
            updates.push("name = ?");
            params_vec.push(Value::Text(n));
        }
        if let Some(d) = definition {
            updates.push("definition = ?");
            params_vec.push(Value::Text(d.to_string()));
        }

        if updates.is_empty() {
            return Self::get_pipeline(conn, id);
        }

        updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

        let sql = format!("UPDATE pipelines SET {} WHERE id = ?", updates.join(", "));
        params_vec.push(Value::Integer(id));

        conn.execute(&sql, params_from_iter(params_vec))?;
        Self::get_pipeline(conn, id)
    }

    pub fn delete_pipeline(conn: &Connection, id: i64) -> DbResult<()> {
        conn.execute("DELETE FROM pipelines WHERE id = ?", params![id])?;
        Ok(())
    }
}
