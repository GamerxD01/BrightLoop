-- Daily automation: billing, activation, renewal notices and overdue reminders.

CREATE TYPE job_status  AS ENUM ('running', 'done', 'failed');
CREATE TYPE job_trigger AS ENUM ('schedule', 'manual');

CREATE TABLE job_runs (
  id            BIGSERIAL PRIMARY KEY,
  job           TEXT        NOT NULL,
  run_date      DATE        NOT NULL,
  trigger       job_trigger NOT NULL,
  status        job_status  NOT NULL DEFAULT 'running',
  result        JSONB,
  error         TEXT,
  triggered_by  BIGINT      REFERENCES users (id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
-- A scheduled job runs once per day, however many servers are up: the second claim fails.
CREATE UNIQUE INDEX job_runs_once_a_day ON job_runs (job, run_date) WHERE trigger = 'schedule';
CREATE INDEX job_runs_recent_idx ON job_runs (started_at DESC);
CREATE INDEX job_runs_user_idx   ON job_runs (triggered_by);

-- Escalating reminders on overdue invoices: 1 polite (3 days), 2 firm (7), 3 final (14); 0 sent by hand.
CREATE TABLE invoice_reminders (
  id          BIGSERIAL PRIMARY KEY,
  invoice_id  BIGINT      NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  stage       SMALLINT    NOT NULL CHECK (stage BETWEEN 0 AND 3),
  email_id    BIGINT      REFERENCES email_log (id) ON DELETE SET NULL,
  sent_by     BIGINT      REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoice_reminders_once_per_stage ON invoice_reminders (invoice_id, stage) WHERE stage > 0;
CREATE INDEX invoice_reminders_invoice_idx ON invoice_reminders (invoice_id, created_at DESC);
CREATE INDEX invoice_reminders_email_idx   ON invoice_reminders (email_id);
CREATE INDEX invoice_reminders_user_idx    ON invoice_reminders (sent_by);

-- Renewal notices: 30 and 7 days before expiry, each sent once.
CREATE TABLE subscription_notices (
  id               BIGSERIAL PRIMARY KEY,
  subscription_id  BIGINT      NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  kind             TEXT        NOT NULL CHECK (kind IN ('renewal_30', 'renewal_7')),
  email_id         BIGINT      REFERENCES email_log (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, kind)
);
CREATE INDEX subscription_notices_email_idx ON subscription_notices (email_id);

-- The renewal radar reads active subscriptions by expiry date.
CREATE INDEX subscriptions_expiry_idx ON subscriptions (expiry_date) WHERE status = 'active' AND expiry_date IS NOT NULL;

-- The account automated changes are recorded under. It can never sign in:
-- it is inactive and its password hash matches no password.
INSERT INTO users (email, password_hash, full_name, role, is_active)
VALUES ('automation@brightloop.internal', '!', 'Automation', 'staff', FALSE);
