CREATE TABLE IF NOT EXISTS app_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  campus_base TEXT NOT NULL,
  issuer TEXT NOT NULL,
  client TEXT NOT NULL,
  installation TEXT,
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS active_profile (
  id INTEGER PRIMARY KEY CHECK(id=1),
  profile_id TEXT NOT NULL REFERENCES app_profiles(id)
);
INSERT OR IGNORE INTO schema_migrations(version) VALUES(2);
