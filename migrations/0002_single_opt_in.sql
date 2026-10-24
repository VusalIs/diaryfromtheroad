-- Single opt-in (2026-10-24): an address is subscribed as soon as it is entered and gets a welcome
-- email, so the confirmation columns go. Addresses that bounce or report the email as spam are kept
-- with their own status so the form can't add them again. Sign-ups that were never confirmed are
-- dropped, as the privacy notice promised at the time.
CREATE TABLE subscribers_single_opt_in (
  id INTEGER PRIMARY KEY,
  -- Trimmed and lowercased before it is stored; the CHECK keeps it that way.
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND length(email) <= 254),
  -- active: subscribed. unsubscribed: left through a link and may sign up again.
  -- bounced, complained: Resend reported a permanent bounce or a spam report; never emailed again.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed', 'bounced', 'complained')),
  created_at TEXT NOT NULL,
  -- When the address last became active.
  subscribed_at TEXT NOT NULL,
  -- When the last welcome email went out; the rate limits count these.
  welcome_sent_at TEXT,
  -- Random, and stored as is so an export can build each subscriber's unsubscribe link.
  unsubscribe_token TEXT NOT NULL UNIQUE,
  -- When the address left the list, for any reason.
  unsubscribed_at TEXT
);

INSERT INTO subscribers_single_opt_in
  (id, email, status, created_at, subscribed_at, welcome_sent_at, unsubscribe_token, unsubscribed_at)
SELECT id, email, status, created_at, COALESCE(confirmed_at, created_at), confirmation_sent_at,
  unsubscribe_token, unsubscribed_at
FROM subscribers
WHERE status != 'pending';

DROP TABLE subscribers;
ALTER TABLE subscribers_single_opt_in RENAME TO subscribers;

CREATE INDEX subscribers_welcome_sent_at ON subscribers (welcome_sent_at);
