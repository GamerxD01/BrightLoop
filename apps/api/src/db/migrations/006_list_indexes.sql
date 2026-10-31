-- The customer list shows each customer's open balance and active subscriptions, and can sort by the balance.
-- These partial, covering indexes let both come straight from the index, with no table reads.
CREATE INDEX invoices_open_by_customer
  ON invoices (customer_id) INCLUDE (amount_total, amount_paid) WHERE status = 'confirmed';
CREATE INDEX subscriptions_active_by_customer
  ON subscriptions (customer_id) WHERE status = 'active';
