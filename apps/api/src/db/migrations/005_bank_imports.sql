-- Bank statement imports: each uploaded file, its lines, and what each line was matched to.

CREATE TYPE bank_line_status AS ENUM ('matched', 'suggested', 'unmatched', 'ignored', 'duplicate', 'posted');

CREATE TABLE bank_imports (
  id           BIGSERIAL PRIMARY KEY,
  filename     TEXT        NOT NULL,
  columns      JSONB       NOT NULL,
  uploaded_by  BIGINT      REFERENCES users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bank_imports_created_idx ON bank_imports (created_at DESC);
CREATE INDEX bank_imports_user_idx    ON bank_imports (uploaded_by);

CREATE TABLE bank_lines (
  id           BIGSERIAL PRIMARY KEY,
  import_id    BIGINT           NOT NULL REFERENCES bank_imports (id) ON DELETE CASCADE,
  line_no      INT              NOT NULL,
  txn_date     DATE             NOT NULL,
  description  TEXT             NOT NULL,
  reference    TEXT,
  amount       BIGINT           NOT NULL CHECK (amount > 0),
  direction    TEXT             NOT NULL CHECK (direction IN ('in', 'out')),
  -- Same date, amount, reference and text: the same bank transaction, whichever file it came in.
  fingerprint  TEXT             NOT NULL,
  status       bank_line_status NOT NULL,
  invoice_id   BIGINT           REFERENCES invoices (id) ON DELETE SET NULL,
  reason       TEXT,
  payment_id   BIGINT           REFERENCES payments (id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CHECK (status <> 'posted' OR payment_id IS NOT NULL)
);
CREATE INDEX bank_lines_import_idx      ON bank_lines (import_id, line_no);
CREATE INDEX bank_lines_invoice_idx     ON bank_lines (invoice_id);
CREATE INDEX bank_lines_payment_idx     ON bank_lines (payment_id);
-- A bank transaction can be turned into a payment once, ever.
CREATE UNIQUE INDEX bank_lines_posted_once  ON bank_lines (fingerprint) WHERE status = 'posted';
CREATE INDEX bank_lines_fingerprint_idx ON bank_lines (fingerprint);
