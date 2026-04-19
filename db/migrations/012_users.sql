-- Migration 012: create users table and seed admin user

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO users (username, password_hash)
VALUES (
  'admin',
  '36c3fb7cf0514f3ed68d5156a5e271f6:68e8d79a5ee8ced10c32eade48df079b05012f9927b39498cc2dcedb544566c088963118019bf381fd7321f722b78e4dd286d3b2e43bc5bb8090a6db78ec6ceb'
)
ON CONFLICT (username) DO NOTHING;
