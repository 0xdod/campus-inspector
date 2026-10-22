CREATE TABLE IF NOT EXISTS http_logs (id TEXT PRIMARY KEY, created INTEGER NOT NULL, evidence TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS http_logs_created ON http_logs(created);
INSERT OR IGNORE INTO schema_migrations(version) VALUES(3);
