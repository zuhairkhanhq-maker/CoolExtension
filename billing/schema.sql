CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  verified_at timestamptz,
  trial_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  device_id uuid NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges(expires_at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  device_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY, hits integer NOT NULL, reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS limits_expiry ON rate_limits(reset_at);
CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  customer_id text NOT NULL,
  status text NOT NULL,
  price_id text NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  trial_end timestamptz,
  past_due_since timestamptz,
  scheduled_action text,
  source_updated_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_customers (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  customer_id text NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS subscriptions_account ON subscriptions(account_id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS reconcile_after timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS subscriptions_reconcile_after ON subscriptions(reconcile_after);
CREATE INDEX IF NOT EXISTS subscriptions_reconcile ON subscriptions(synced_at) WHERE status NOT IN ('canceled','paused');
CREATE TABLE IF NOT EXISTS adjustments (
  id text PRIMARY KEY, subscription_id text NOT NULL,
  transaction_id text NOT NULL, action text NOT NULL, status text NOT NULL,
  type text, billed_at timestamptz, source_updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS adjustments_subscription ON adjustments(subscription_id);
CREATE TABLE IF NOT EXISTS checkout_intents (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  plan text NOT NULL,
  transaction_id text UNIQUE,
  checkout_url text,
  state text NOT NULL DEFAULT 'creating',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_checkout ON checkout_intents(account_id) WHERE state IN ('creating','ready','uncertain');
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS reconcile_after timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS checkout_reconcile_after ON checkout_intents(reconcile_after) WHERE state='ready';
CREATE TABLE IF NOT EXISTS webhook_jobs (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  entity_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_ready ON webhook_jobs(next_at) WHERE state IN ('pending','processing');
