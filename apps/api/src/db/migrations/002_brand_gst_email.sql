-- Company profile, GST invoicing and the email log.

-- ───────────────────────────── Company profile (exactly one row) ─────────────────────────────
CREATE TABLE company_settings (
  id              BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
  brand_name      TEXT        NOT NULL DEFAULT 'Brightloop',
  legal_name      TEXT        NOT NULL DEFAULT 'Brightloop Software Private Limited',
  address_line    TEXT,
  city            TEXT,
  state_code      CHAR(2),                           -- GST state code, e.g. 09 Uttar Pradesh
  pincode         TEXT        CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$'),
  gstin           TEXT        CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  email           TEXT,
  phone           TEXT,
  website         TEXT,
  bank_name       TEXT,
  bank_account    TEXT,
  bank_ifsc       TEXT        CHECK (bank_ifsc IS NULL OR bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  upi_id          TEXT        CHECK (upi_id IS NULL OR upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,64}$'),
  invoice_footer  TEXT,
  logo            BYTEA,
  logo_mime       TEXT        CHECK (logo_mime IS NULL OR logo_mime IN ('image/png', 'image/jpeg')),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (gstin IS NULL OR state_code IS NULL OR left(gstin, 2) = state_code),
  CHECK ((logo IS NULL) = (logo_mime IS NULL))
);
INSERT INTO company_settings DEFAULT VALUES;

-- ───────────────────────────── GST on the people and things we bill ─────────────────────────────
ALTER TABLE customers
  ADD COLUMN gstin      TEXT    CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  ADD COLUMN state_code CHAR(2),
  ADD CONSTRAINT customers_gstin_state CHECK (gstin IS NULL OR state_code IS NULL OR left(gstin, 2) = state_code);

ALTER TABLE products ADD COLUMN hsn_sac TEXT CHECK (hsn_sac IS NULL OR hsn_sac ~ '^[0-9]{4,8}$');
ALTER TABLE plans    ADD COLUMN hsn_sac TEXT CHECK (hsn_sac IS NULL OR hsn_sac ~ '^[0-9]{4,8}$');
ALTER TABLE subscription_lines ADD COLUMN hsn_sac TEXT;

-- Same state as the seller: CGST + SGST. Another state: IGST.
CREATE TYPE gst_mode AS ENUM ('intra', 'inter');

ALTER TABLE invoices
  ADD COLUMN gst_mode         gst_mode NOT NULL DEFAULT 'intra',
  ADD COLUMN place_of_supply  CHAR(2),
  ADD COLUMN customer_gstin   TEXT,
  ADD COLUMN amount_cgst      BIGINT   NOT NULL DEFAULT 0 CHECK (amount_cgst >= 0),
  ADD COLUMN amount_sgst      BIGINT   NOT NULL DEFAULT 0 CHECK (amount_sgst >= 0),
  ADD COLUMN amount_igst      BIGINT   NOT NULL DEFAULT 0 CHECK (amount_igst >= 0),
  -- Seller details as they were on the day of issue; a later profile edit never rewrites an issued invoice.
  ADD COLUMN seller           JSONB;

-- Existing rows predate the split: put their whole tax under CGST/SGST.
UPDATE invoices SET amount_cgst = amount_tax / 2, amount_sgst = amount_tax - amount_tax / 2;
-- Only then the rule: the split always adds back up to the tax total.
ALTER TABLE invoices ADD CONSTRAINT invoices_gst_adds_up CHECK (amount_cgst + amount_sgst + amount_igst = amount_tax);

ALTER TABLE invoice_lines
  ADD COLUMN hsn_sac TEXT,
  ADD COLUMN cgst    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN sgst    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN igst    BIGINT NOT NULL DEFAULT 0;
UPDATE invoice_lines SET cgst = tax_amount / 2, sgst = tax_amount - tax_amount / 2;

-- ───────────────────────────── Every email the system sends ─────────────────────────────
CREATE TYPE email_status AS ENUM ('sent', 'logged', 'failed');

CREATE TABLE email_log (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT         NOT NULL,          -- invoice, receipt, reminder, renewal, reset, welcome
  to_address    TEXT         NOT NULL,
  subject       TEXT         NOT NULL,
  body_text     TEXT         NOT NULL,
  body_html     TEXT,
  status        email_status NOT NULL,
  error         TEXT,
  entity        TEXT,
  entity_id     BIGINT,
  customer_id   BIGINT       REFERENCES customers (id) ON DELETE SET NULL,
  attachments   TEXT[]       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX email_log_created_idx  ON email_log (created_at DESC);
CREATE INDEX email_log_entity_idx   ON email_log (entity, entity_id);
CREATE INDEX email_log_customer_idx ON email_log (customer_id);
