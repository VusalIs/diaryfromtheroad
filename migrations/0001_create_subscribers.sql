-- Email subscribers, with double opt-in. One row per address.
-- Timestamps are ISO 8601 UTC strings, written by the application.
CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY,
  -- Trimmed and lowercased before it is stored; the CHECK keeps it that way.
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND length(email) <= 254),
  -- pending: signed up, not confirmed. active: confirmed. unsubscribed: confirmed, then left.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'unsubscribed')),
  created_at TEXT NOT NULL,
  -- SHA-256 of the link's token, never the token itself. Cleared once used.
  confirmation_token_hash TEXT UNIQUE,
  confirmation_sent_at TEXT,
  confirmed_at TEXT,
  -- Random, and stored as is so an export can build each subscriber's unsubscribe link.
  unsubscribe_token TEXT NOT NULL UNIQUE,
  unsubscribed_at TEXT
);

-- Rate limits count recent confirmation emails.
CREATE INDEX subscribers_confirmation_sent_at ON subscribers (confirmation_sent_at);
