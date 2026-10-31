-- Customer self-service: mid-period changes, adjustment invoices and account credit.

-- Account credit is spent by the system as a payment method of its own.
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'credit';

-- A recurring invoice bills a period; an adjustment bills part of one after a change.
CREATE TYPE invoice_kind AS ENUM ('recurring', 'adjustment');
ALTER TABLE invoices ADD COLUMN kind invoice_kind NOT NULL DEFAULT 'recurring';

-- "Nothing billed twice" now means one live *recurring* invoice per period;
-- adjustments for the same period are separate documents.
DROP INDEX invoices_one_per_period;
CREATE UNIQUE INDEX invoices_one_per_period
  ON invoices (subscription_id, period_start) WHERE status <> 'cancelled' AND kind = 'recurring';

-- Every change to an active subscription, with what it cost or returned.
CREATE TABLE subscription_changes (
  id                 BIGSERIAL PRIMARY KEY,
  subscription_id    BIGINT      NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  effective_date     DATE        NOT NULL,
  before_lines       JSONB       NOT NULL,
  after_lines        JSONB       NOT NULL,
  days_left          INT         NOT NULL CHECK (days_left >= 0),
  days_in_period     INT         NOT NULL CHECK (days_in_period >= 0),
  charge_invoice_id  BIGINT      REFERENCES invoices (id) ON DELETE SET NULL,
  credit_amount      BIGINT      NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  actor_id           BIGINT      REFERENCES users (id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscription_changes_subscription_idx ON subscription_changes (subscription_id, created_at DESC);
CREATE INDEX subscription_changes_invoice_idx      ON subscription_changes (charge_invoice_id);
CREATE INDEX subscription_changes_actor_idx        ON subscription_changes (actor_id);

-- Account credit as a ledger: positive rows add credit, negative rows spend it.
-- The balance is the sum; it can never go below zero (checked under a row lock on the customer).
CREATE TABLE customer_credits (
  id               BIGSERIAL PRIMARY KEY,
  customer_id      BIGINT      NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  amount           BIGINT      NOT NULL CHECK (amount <> 0),
  reason           TEXT        NOT NULL,
  subscription_id  BIGINT      REFERENCES subscriptions (id) ON DELETE SET NULL,
  invoice_id       BIGINT      REFERENCES invoices (id) ON DELETE SET NULL,
  payment_id       BIGINT      REFERENCES payments (id) ON DELETE SET NULL,
  created_by       BIGINT      REFERENCES users (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_credits_customer_idx     ON customer_credits (customer_id, created_at DESC);
CREATE INDEX customer_credits_subscription_idx ON customer_credits (subscription_id);
CREATE INDEX customer_credits_invoice_idx      ON customer_credits (invoice_id);
CREATE INDEX customer_credits_payment_idx      ON customer_credits (payment_id);
CREATE INDEX customer_credits_user_idx         ON customer_credits (created_by);
