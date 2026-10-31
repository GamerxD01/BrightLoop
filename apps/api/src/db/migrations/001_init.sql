-- Brightloop subscription management — initial schema.
-- Conventions: money is BIGINT paise, percentages are INT basis points (18% = 1800),
-- calendar dates are DATE, moments are TIMESTAMPTZ. Every FK is indexed.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role           AS ENUM ('admin', 'staff', 'customer');
CREATE TYPE product_type        AS ENUM ('service', 'goods');
CREATE TYPE billing_period      AS ENUM ('daily', 'weekly', 'monthly', 'yearly');
CREATE TYPE subscription_status AS ENUM ('draft', 'quotation', 'confirmed', 'active', 'paused', 'closed');
CREATE TYPE invoice_status      AS ENUM ('draft', 'confirmed', 'paid', 'cancelled');
CREATE TYPE payment_method      AS ENUM ('bank_transfer', 'upi', 'card', 'cash', 'cheque');
CREATE TYPE discount_type       AS ENUM ('fixed', 'percentage');
CREATE TYPE discount_scope      AS ENUM ('subscription', 'products');
CREATE TYPE line_kind           AS ENUM ('plan', 'product');

-- ───────────────────────────── People ─────────────────────────────

CREATE TABLE customers (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email       CITEXT      NOT NULL UNIQUE,
  phone       TEXT,
  company     TEXT,
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_name_idx ON customers (lower(name) text_pattern_ops);

CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  email          CITEXT      NOT NULL UNIQUE,            -- one account per email
  password_hash  TEXT        NOT NULL,
  full_name      TEXT        NOT NULL,
  role           user_role   NOT NULL,
  customer_id    BIGINT      UNIQUE REFERENCES customers (id) ON DELETE RESTRICT,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  token_version  INT         NOT NULL DEFAULT 0,          -- bump to revoke every session
  last_login_at  TIMESTAMPTZ,
  created_by     BIGINT      REFERENCES users (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- portal users are always tied to exactly one customer record; staff never are
  CONSTRAINT users_customer_link CHECK ((role = 'customer') = (customer_id IS NOT NULL))
);

CREATE TABLE password_reset_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,                -- sha256; the raw token only lives in the email
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

-- ───────────────────────────── Catalog ─────────────────────────────

CREATE TABLE taxes (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL UNIQUE,
  rate_bp     INT         NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_terms (
  id        BIGSERIAL PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  due_days  INT  NOT NULL CHECK (due_days BETWEEN 0 AND 365)
);

CREATE TABLE products (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT         NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  type         product_type NOT NULL,
  sales_price  BIGINT       NOT NULL CHECK (sales_price >= 0),
  cost_price   BIGINT       NOT NULL CHECK (cost_price >= 0),
  notes        TEXT,
  tax_id       BIGINT       REFERENCES taxes (id) ON DELETE SET NULL,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX products_tax_idx ON products (tax_id);

-- e.g. attribute "Brand" with values "Odoo" (+₹560) and "Generic" (+₹0)
CREATE TABLE product_attributes (
  id    BIGSERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE attribute_values (
  id            BIGSERIAL PRIMARY KEY,
  attribute_id  BIGINT NOT NULL REFERENCES product_attributes (id) ON DELETE CASCADE,
  name          TEXT   NOT NULL,
  extra_price   BIGINT NOT NULL DEFAULT 0 CHECK (extra_price >= 0),
  UNIQUE (attribute_id, name)
);

-- a variant is a product sold with one attribute value
CREATE TABLE product_variants (
  id                  BIGSERIAL PRIMARY KEY,
  product_id          BIGINT  NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  attribute_value_id  BIGINT  NOT NULL REFERENCES attribute_values (id) ON DELETE RESTRICT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (product_id, attribute_value_id)
);
CREATE INDEX product_variants_value_idx ON product_variants (attribute_value_id);

-- ───────────────────────────── Plans ─────────────────────────────

CREATE TABLE plans (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT           NOT NULL UNIQUE,
  price             BIGINT         NOT NULL CHECK (price >= 0),   -- per unit, per period
  billing_period    billing_period NOT NULL,
  billing_interval  INT            NOT NULL DEFAULT 1 CHECK (billing_interval BETWEEN 1 AND 36),
  min_quantity      INT            NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  start_date        DATE           NOT NULL,
  end_date          DATE,
  tax_id            BIGINT         REFERENCES taxes (id) ON DELETE SET NULL,
  auto_close        BOOLEAN        NOT NULL DEFAULT FALSE,  -- close on its own at expiry
  closable          BOOLEAN        NOT NULL DEFAULT TRUE,   -- may be closed early
  pausable          BOOLEAN        NOT NULL DEFAULT FALSE,
  renewable         BOOLEAN        NOT NULL DEFAULT TRUE,
  is_active         BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX plans_tax_idx ON plans (tax_id);

CREATE TABLE quotation_templates (
  id               BIGSERIAL PRIMARY KEY,
  name             TEXT        NOT NULL UNIQUE,
  plan_id          BIGINT      NOT NULL REFERENCES plans (id) ON DELETE RESTRICT,
  validity_days    INT         NOT NULL CHECK (validity_days BETWEEN 1 AND 365),
  payment_term_id  BIGINT      NOT NULL REFERENCES payment_terms (id),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX quotation_templates_plan_idx ON quotation_templates (plan_id);
CREATE INDEX quotation_templates_term_idx ON quotation_templates (payment_term_id);

CREATE TABLE quotation_template_lines (
  id           BIGSERIAL PRIMARY KEY,
  template_id  BIGINT NOT NULL REFERENCES quotation_templates (id) ON DELETE CASCADE,
  product_id   BIGINT NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  variant_id   BIGINT REFERENCES product_variants (id) ON DELETE SET NULL,
  quantity     INT    NOT NULL CHECK (quantity > 0),
  position     INT    NOT NULL DEFAULT 0
);
CREATE INDEX quotation_template_lines_template_idx ON quotation_template_lines (template_id);
CREATE INDEX quotation_template_lines_product_idx ON quotation_template_lines (product_id);

-- ───────────────────────────── Discounts ─────────────────────────────

CREATE TABLE discounts (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT           NOT NULL UNIQUE,
  type          discount_type  NOT NULL,
  value         BIGINT         NOT NULL CHECK (value > 0),       -- paise or basis points
  scope         discount_scope NOT NULL,
  min_amount    BIGINT         NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  min_quantity  INT            NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  start_date    DATE           NOT NULL,
  end_date      DATE,
  usage_limit   INT            CHECK (usage_limit IS NULL OR usage_limit > 0),
  times_used    INT            NOT NULL DEFAULT 0 CHECK (times_used >= 0),
  is_active     BOOLEAN        NOT NULL DEFAULT TRUE,
  created_by    BIGINT         REFERENCES users (id),
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CHECK (type <> 'percentage' OR value <= 10000),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (usage_limit IS NULL OR times_used <= usage_limit)        -- the database refuses overuse
);

CREATE TABLE discount_products (
  discount_id  BIGINT NOT NULL REFERENCES discounts (id) ON DELETE CASCADE,
  product_id   BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  PRIMARY KEY (discount_id, product_id)
);
CREATE INDEX discount_products_product_idx ON discount_products (product_id);

-- ───────────────────────────── Subscriptions ─────────────────────────────

CREATE TABLE subscriptions (
  id                 BIGSERIAL PRIMARY KEY,
  number             TEXT                NOT NULL UNIQUE,      -- SUB/2026/00001
  customer_id        BIGINT              NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  plan_id            BIGINT              NOT NULL REFERENCES plans (id) ON DELETE RESTRICT,
  template_id        BIGINT              REFERENCES quotation_templates (id) ON DELETE SET NULL,
  payment_term_id    BIGINT              NOT NULL REFERENCES payment_terms (id),
  renewed_from_id    BIGINT              REFERENCES subscriptions (id) ON DELETE SET NULL,
  status             subscription_status NOT NULL DEFAULT 'draft',
  start_date         DATE                NOT NULL,
  expiry_date        DATE,
  quote_valid_until  DATE,
  next_invoice_date  DATE,
  -- cached from lines (recomputed in one place: the subscription service) for fast lists and MRR
  amount_untaxed     BIGINT              NOT NULL DEFAULT 0,
  amount_tax         BIGINT              NOT NULL DEFAULT 0,
  amount_total       BIGINT              NOT NULL DEFAULT 0,
  notes              TEXT,
  created_by         BIGINT              REFERENCES users (id),
  created_at         TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ         NOT NULL DEFAULT now(),
  CHECK (expiry_date IS NULL OR expiry_date > start_date)
);
CREATE INDEX subscriptions_customer_idx   ON subscriptions (customer_id);
CREATE INDEX subscriptions_plan_idx       ON subscriptions (plan_id);
CREATE INDEX subscriptions_template_idx   ON subscriptions (template_id);
CREATE INDEX subscriptions_term_idx       ON subscriptions (payment_term_id);
CREATE INDEX subscriptions_renewed_idx    ON subscriptions (renewed_from_id);
CREATE INDEX subscriptions_status_idx     ON subscriptions (status, created_at DESC);
-- the billing run's only query path: active subscriptions due on or before a date
CREATE INDEX subscriptions_due_idx        ON subscriptions (next_invoice_date) WHERE status = 'active';

CREATE TABLE subscription_lines (
  id               BIGSERIAL PRIMARY KEY,
  subscription_id  BIGINT    NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  kind             line_kind NOT NULL,
  product_id       BIGINT    REFERENCES products (id) ON DELETE RESTRICT,
  variant_id       BIGINT    REFERENCES product_variants (id) ON DELETE RESTRICT,
  description      TEXT      NOT NULL,
  quantity         INT       NOT NULL CHECK (quantity > 0),
  unit_price       BIGINT    NOT NULL CHECK (unit_price >= 0),   -- snapshot, never re-read from catalog
  tax_id           BIGINT    REFERENCES taxes (id) ON DELETE SET NULL,
  tax_rate_bp      INT       NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  position         INT       NOT NULL DEFAULT 0,
  CHECK ((kind = 'product') = (product_id IS NOT NULL))
);
CREATE INDEX subscription_lines_subscription_idx ON subscription_lines (subscription_id);
CREATE INDEX subscription_lines_product_idx      ON subscription_lines (product_id);
CREATE INDEX subscription_lines_variant_idx      ON subscription_lines (variant_id);
CREATE INDEX subscription_lines_tax_idx          ON subscription_lines (tax_id);

-- discounts a salesperson attached; the billing run decides each time if they still apply
CREATE TABLE subscription_discounts (
  subscription_id  BIGINT NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  discount_id      BIGINT NOT NULL REFERENCES discounts (id) ON DELETE CASCADE,
  PRIMARY KEY (subscription_id, discount_id)
);
CREATE INDEX subscription_discounts_discount_idx ON subscription_discounts (discount_id);

-- the status timeline
CREATE TABLE subscription_events (
  id               BIGSERIAL PRIMARY KEY,
  subscription_id  BIGINT              NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  from_status      subscription_status,
  to_status        subscription_status NOT NULL,
  note             TEXT,
  actor_id         BIGINT              REFERENCES users (id),
  created_at       TIMESTAMPTZ         NOT NULL DEFAULT now()
);
CREATE INDEX subscription_events_subscription_idx ON subscription_events (subscription_id, created_at);
CREATE INDEX subscription_events_actor_idx        ON subscription_events (actor_id);

-- ───────────────────────────── Invoices & payments ─────────────────────────────

CREATE TABLE invoices (
  id               BIGSERIAL PRIMARY KEY,
  number           TEXT           NOT NULL UNIQUE,              -- INV/2026/00001
  subscription_id  BIGINT         REFERENCES subscriptions (id) ON DELETE RESTRICT,
  customer_id      BIGINT         NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  status           invoice_status NOT NULL DEFAULT 'draft',
  period_start     DATE           NOT NULL,
  period_end       DATE           NOT NULL,
  invoice_date     DATE           NOT NULL,
  due_date         DATE           NOT NULL,
  amount_untaxed   BIGINT         NOT NULL CHECK (amount_untaxed >= 0),
  amount_discount  BIGINT         NOT NULL DEFAULT 0 CHECK (amount_discount >= 0),
  amount_tax       BIGINT         NOT NULL CHECK (amount_tax >= 0),
  amount_total     BIGINT         NOT NULL CHECK (amount_total >= 0),
  amount_paid      BIGINT         NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  confirmed_at     TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (due_date >= invoice_date),
  CHECK (amount_paid <= amount_total),
  CHECK (status <> 'paid' OR amount_paid = amount_total)
);
-- "Nothing should be billed twice": one live invoice per subscription per period.
CREATE UNIQUE INDEX invoices_one_per_period
  ON invoices (subscription_id, period_start) WHERE status <> 'cancelled';
CREATE INDEX invoices_customer_idx     ON invoices (customer_id, invoice_date DESC);
CREATE INDEX invoices_subscription_idx ON invoices (subscription_id);
CREATE INDEX invoices_status_idx       ON invoices (status, invoice_date DESC);
CREATE INDEX invoices_open_due_idx     ON invoices (due_date) WHERE status = 'confirmed';

CREATE TABLE invoice_lines (
  id           BIGSERIAL PRIMARY KEY,
  invoice_id   BIGINT NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  product_id   BIGINT REFERENCES products (id) ON DELETE SET NULL,
  description  TEXT   NOT NULL,
  quantity     INT    NOT NULL CHECK (quantity > 0),
  unit_price   BIGINT NOT NULL CHECK (unit_price >= 0),
  discount     BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_rate_bp  INT    NOT NULL DEFAULT 0,
  tax_amount   BIGINT NOT NULL DEFAULT 0,
  subtotal     BIGINT NOT NULL,
  total        BIGINT NOT NULL,
  position     INT    NOT NULL DEFAULT 0
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id);
CREATE INDEX invoice_lines_product_idx ON invoice_lines (product_id);

CREATE TABLE discount_usages (
  id               BIGSERIAL PRIMARY KEY,
  discount_id      BIGINT      NOT NULL REFERENCES discounts (id) ON DELETE CASCADE,
  invoice_id       BIGINT      NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  amount           BIGINT      NOT NULL CHECK (amount > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discount_id, invoice_id)
);
CREATE INDEX discount_usages_invoice_idx ON discount_usages (invoice_id);

CREATE TABLE payments (
  id           BIGSERIAL PRIMARY KEY,
  invoice_id   BIGINT         NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  amount       BIGINT         NOT NULL CHECK (amount > 0),
  method       payment_method NOT NULL,
  paid_on      DATE           NOT NULL,
  note         TEXT,
  recorded_by  BIGINT         REFERENCES users (id),
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice_idx  ON payments (invoice_id);
CREATE INDEX payments_paid_on_idx  ON payments (paid_on DESC);
CREATE INDEX payments_recorder_idx ON payments (recorded_by);

-- ───────────────────────────── Support ─────────────────────────────

-- gap-free yearly document numbers, taken under a row lock
CREATE TABLE document_sequences (
  prefix      TEXT NOT NULL,
  year        INT  NOT NULL,
  last_value  INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year)
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    BIGINT      REFERENCES users (id),
  action      TEXT        NOT NULL,
  entity      TEXT        NOT NULL,
  entity_id   BIGINT,
  data        JSONB,
  request_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_log_actor_idx  ON audit_log (actor_id);
