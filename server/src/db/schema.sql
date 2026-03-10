-- DOS V1 Schema
-- SQLite

-- Personas (5 archetypes, fixed per device)
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active_window_start TEXT NOT NULL,  -- e.g. "09:30"
  active_window_end TEXT NOT NULL,    -- e.g. "20:30"
  session_count_min INTEGER NOT NULL,
  session_count_max INTEGER NOT NULL,
  session_duration_min INTEGER NOT NULL,  -- minutes
  session_duration_max INTEGER NOT NULL,
  peak_bias_windows TEXT,  -- JSON array of {start,end} or null
  weekend_modifiers TEXT,  -- JSON or null
  niche_exposure_min REAL,
  niche_exposure_max REAL,
  secondary_interest_tags TEXT,  -- JSON array or null
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Operators
CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  coverage_weekday INTEGER NOT NULL DEFAULT 1,  -- 1 = covers weekday
  coverage_weekend INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Devices
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  device_unique_id TEXT UNIQUE,  -- system-generated for enrollment
  persona_id TEXT NOT NULL REFERENCES personas(id),
  operator_id TEXT REFERENCES operators(id),
  status TEXT NOT NULL DEFAULT 'active',  -- active | paused | retired
  token_hash TEXT,  -- hashed device token for auth
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_devices_operator ON devices(operator_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

-- Accounts (Instagram accounts, mapped to devices)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  display_name TEXT,
  account_identifier TEXT,  -- external ref, no credentials
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_device ON accounts(device_id);

-- Post queue (ingestion)
CREATE TABLE IF NOT EXISTS post_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  account_id TEXT REFERENCES accounts(id),
  planned_date TEXT NOT NULL,  -- YYYY-MM-DD
  planned_time_start TEXT,    -- HH:MM or null for window
  planned_time_end TEXT,
  content_ref TEXT,           -- external ref to content
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | scheduled | completed | missed
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_post_queue_device_date ON post_queue(device_id, planned_date);

-- Daily plans (generated per device per day)
CREATE TABLE IF NOT EXISTS daily_plans (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  plan_date TEXT NOT NULL,    -- YYYY-MM-DD
  daily_mode TEXT NOT NULL,   -- light | normal | heavy | post_only
  session_count INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, plan_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_plans_date ON daily_plans(plan_date);

-- Sessions (planned, part of daily plan)
CREATE TABLE IF NOT EXISTS planned_sessions (
  id TEXT PRIMARY KEY,
  daily_plan_id TEXT NOT NULL REFERENCES daily_plans(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  planned_start TEXT NOT NULL,   -- ISO or HH:MM
  planned_duration_min INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_planned_sessions_plan ON planned_sessions(daily_plan_id);

-- Posting tasks (planned, part of daily plan)
CREATE TABLE IF NOT EXISTS planned_posts (
  id TEXT PRIMARY KEY,
  daily_plan_id TEXT NOT NULL REFERENCES daily_plans(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  planned_time_window_start TEXT NOT NULL,
  planned_time_window_end TEXT NOT NULL,
  variance_min INTEGER NOT NULL DEFAULT 5,
  variance_max INTEGER NOT NULL DEFAULT 15,
  post_queue_id TEXT REFERENCES post_queue(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_planned_posts_plan ON planned_posts(daily_plan_id);

-- Session focus (dominant / secondary accounts per session)
CREATE TABLE IF NOT EXISTS planned_session_focus (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES planned_sessions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL,  -- 'dominant' | 'secondary'
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_planned_session_focus_session ON planned_session_focus(session_id);

-- Session logs (actual execution)
CREATE TABLE IF NOT EXISTS session_logs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  session_id TEXT NOT NULL REFERENCES planned_sessions(id),
  planned_start TEXT NOT NULL,
  planned_duration_min INTEGER NOT NULL,
  actual_start TEXT,
  actual_end TEXT,
  status TEXT NOT NULL,  -- completed | missed | late
  server_time_iso TEXT,  -- when server received or wrote log
  idempotency_key TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_logs_device ON session_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_session_logs_created ON session_logs(created_at);

-- Post logs (actual execution)
CREATE TABLE IF NOT EXISTS post_logs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  planned_time_start TEXT,
  planned_time_end TEXT,
  actual_time TEXT,
  status TEXT NOT NULL,  -- completed | missed | late
  server_time_iso TEXT,  -- when server received or wrote log
  idempotency_key TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_post_logs_device ON post_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_post_logs_created ON post_logs(created_at);

-- System settings (buffers, variance)
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Default settings
INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('session_proximity_buffer_min', '5'),
  ('session_proximity_buffer_max', '10'),
  ('post_proximity_buffer_min', '2'),
  ('post_proximity_buffer_max', '3'),
  ('post_variance_min', '5'),
  ('post_variance_max', '15'),
  ('same_device_post_gap_min', '10'),
  ('late_session_threshold_min', '15');
