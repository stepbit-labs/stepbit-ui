#!/usr/bin/env bash
# migrate_chat_db.sh
#
# One-shot migration: DuckDB chat.db → SQLite chat.db
#
# Requirements:
#   - duckdb CLI available in PATH (only needed for migration, not for runtime)
#   - sqlite3 CLI available in PATH
#
# Usage:
#   ./scripts/migrate_chat_db.sh [path/to/chat.db]
#
# If no argument is given, defaults to ~/.stepbit/chat.db
# After migration, the original file is preserved as chat.db.duckdb.bak

set -euo pipefail

DB_PATH="${1:-$HOME/.stepbit/chat.db}"
BACKUP_PATH="${DB_PATH}.duckdb.bak"
NEW_DB="${DB_PATH}.sqlite.tmp"
TMP_DIR=$(mktemp -d)

trap 'rm -rf "$TMP_DIR"' EXIT

if [ ! -f "$DB_PATH" ]; then
    echo "Error: database not found at $DB_PATH"
    exit 1
fi

if ! command -v duckdb &>/dev/null; then
    echo "Error: duckdb CLI not found. Install it from https://duckdb.org/docs/installation/"
    exit 1
fi

if ! command -v sqlite3 &>/dev/null; then
    echo "Error: sqlite3 CLI not found."
    exit 1
fi

echo "Migrating $DB_PATH from DuckDB to SQLite..."

# 1. Export tables to CSV using DuckDB CLI
for table in sessions messages tool_results skills pipelines; do
    echo "  Exporting $table..."
    duckdb "$DB_PATH" "COPY $table TO '$TMP_DIR/$table.csv' (HEADER, DELIMITER ',');" 2>/dev/null || \
        echo "  Warning: table $table not found or empty, skipping."
done

# 2. Create new SQLite database with schema
sqlite3 "$NEW_DB" <<'SQL'
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
SQL

# 3. Import CSVs into SQLite
for table in sessions messages tool_results skills pipelines; do
    csv="$TMP_DIR/$table.csv"
    if [ -f "$csv" ]; then
        echo "  Importing $table..."
        sqlite3 "$NEW_DB" ".mode csv" ".headers on" ".import $csv $table"
    fi
done

# 4. Swap files
echo "Backing up original to $BACKUP_PATH..."
mv "$DB_PATH" "$BACKUP_PATH"
mv "$NEW_DB" "$DB_PATH"

echo "Migration complete."
echo "  New SQLite DB : $DB_PATH"
echo "  DuckDB backup : $BACKUP_PATH"
echo ""
echo "You can verify with: sqlite3 '$DB_PATH' 'SELECT count(*) FROM sessions;'"
