-- Crossfarm community and assistant storage (Cloudflare D1, binding DB).
-- Apply: npx wrangler d1 execute crossfarm --local --file schema.sql   (or --remote)

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  created INTEGER NOT NULL,
  who TEXT NOT NULL,
  place TEXT,
  lat REAL,
  lon REAL,
  crop TEXT,
  q TEXT NOT NULL,
  body TEXT,
  context TEXT,
  lang TEXT,
  routed INTEGER DEFAULT 0,
  token TEXT,
  hidden INTEGER DEFAULT 0,
  helpful INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS threads_created ON threads (created);

CREATE TABLE IF NOT EXISTS replies (
  id TEXT PRIMARY KEY,
  thread TEXT NOT NULL,
  created INTEGER NOT NULL,
  who TEXT NOT NULL,
  place TEXT,
  role TEXT,
  text TEXT NOT NULL,
  lang TEXT,
  token TEXT,
  hidden INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS replies_thread ON replies (thread);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  created INTEGER NOT NULL,
  ip TEXT NOT NULL,
  UNIQUE (kind, target, ip)
);

CREATE TABLE IF NOT EXISTS pilot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created INTEGER NOT NULL,
  role TEXT NOT NULL,
  region TEXT,
  contact TEXT NOT NULL,
  note TEXT
);

-- Spend and rate counters: k = 'total' | 'day:<date>' | 'ip:<date>:<hash>' | 'w:<date>:<hash>'
CREATE TABLE IF NOT EXISTS usage (
  k TEXT PRIMARY KEY,
  tokens INTEGER DEFAULT 0,
  calls INTEGER DEFAULT 0
);

-- Model answers by prompt hash: identical questions cost nothing the second time
CREATE TABLE IF NOT EXISTS cache (
  k TEXT PRIMARY KEY,
  created INTEGER NOT NULL,
  body TEXT NOT NULL
);
