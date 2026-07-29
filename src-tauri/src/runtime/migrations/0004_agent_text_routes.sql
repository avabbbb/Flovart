CREATE TABLE IF NOT EXISTS agent_text_routes (
  order_index INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  model TEXT NOT NULL,
  base_url TEXT NOT NULL,
  protocol TEXT NOT NULL
);
