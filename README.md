# Brightloop — Subscription Management System

One system that runs a subscription business: products and variants, plans, quotations, subscriptions with a guarded lifecycle, GST invoices that bill themselves, discounts, payments, bank statement matching, a live finance dashboard and a self-service customer portal.

Built for the Odoo hackathon problem statement *Subscription Management System*, from scratch: our own REST API, a PostgreSQL schema written by hand, no backend-as-a-service and no paid third-party APIs. Email is optional SMTP; without it, every email is kept in an in-app outbox.

## Run it

Needs **Node.js 20.12+** and **PostgreSQL 14+**.

```bash
git clone https://github.com/GamerxD01/BrightLoop.git
cd BrightLoop
npm install

# Point the API at your PostgreSQL (put your password in DATABASE_URL)
copy apps\api\.env.example apps\api\.env      # Windows
cp apps/api/.env.example apps/api/.env        # macOS / Linux

npm run setup        # creates the database, migrates, loads demo data
npm run dev          # API on :4000, web app on http://localhost:5173
```

- `npm run setup -- --reset` wipes and reloads the demo data (its dates are relative to today, so reload on demo day).
- `npm run db:seed:bulk` adds 5,000 customers, 20,000 subscriptions and a year of invoices and payments in about 8 seconds, to try the app at scale.
- `npm start` builds the web app and serves everything from one port, http://localhost:4000.

| Sign in as | Email | Password |
|---|---|---|
| Admin | `admin@brightloop.test` | `Brightloop@2026` |
| Staff | `staff@brightloop.test` | `Brightloop@2026` |
| Customer (portal) | `iyer.textiles@example.in` | `Brightloop@2026` |

A walkthrough for judging is in [docs/DEMO.md](docs/DEMO.md).

## The billing month, scene by scene

| Scene in the brief | What Brightloop does |
|---|---|
| **A new customer signs up** | One account per email. Passwords need more than 8 characters, an upper and a lower case letter and a special character, checked live in the form and again by the API. "Forgot password" emails a single-use link that expires in 30 minutes. Admin, staff and customer roles; only the admin adds staff; customers see only their own records. |
| **Launching a new plan** | Products with name, type, sales and cost price, notes, tax and HSN/SAC, sold in variants (the *Odoo* brand adds ₹560). Plans set the price per seat, the period (daily, weekly, monthly, yearly, every *n*), minimum seats, availability dates, and whether subscriptions auto-close, close early, pause or renew. |
| **Turning a quote into a subscription** | Quotation templates (plan, lines, validity in days). Each subscription has a number, customer, plan, start and expiry dates, payment terms and priced lines; it moves **Draft → Quotation → Confirmed → Active → Closed** (plus Paused) and every step is on its timeline. Customers accept quotations themselves in the portal. |
| **Billing day** | Billing runs **by itself every day**: it starts confirmed subscriptions on their start date, invoices everything due with lines, taxes and discounts filled in, confirms the invoices and emails them with a PDF. A period can never be billed twice or skipped. Invoices go **Draft → Confirmed → Paid**, and can be cancelled, sent, printed and downloaded. |
| **A customer asks for a better price** | Only the admin creates discount rules: fixed or percentage, minimum purchase or quantity, start and end dates, a use limit, on products or whole subscriptions. Attached to a subscription, a discount appears on each invoice by itself and stops when it expires or runs out. |
| **The money comes in** | Payments with method, amount, date and note, part payments allowed, overpayment refused. **Upload the bank statement** and each line is matched to its invoice; record them all in one click. Overdue invoices are **chased automatically**: polite at 3 days, firm at 7, final at 14. |
| **The finance lead, at month end** | One live dashboard: active subscriptions, monthly recurring revenue, collected, outstanding and overdue, revenue by month and plan, the renewal radar, and the book's health (churn, revenue per customer, collection rate, days to get paid). Filters by date and plan; every list exports to CSV. Every page answers well under the 2-second target with 20,000 subscriptions. |

Beyond the brief, things a real billing month needs:

- **GST tax invoices**: seller and buyer GSTIN, HSN/SAC per line, place of supply, CGST + SGST within the state and IGST across states, the total in words, and a **UPI QR code** to pay from. Seller details are snapshotted on each invoice, so a later profile edit never rewrites an issued one.
- **Customer self-service**: change seats and switch add-ons on or off mid-period. Additions are charged for the days left on an adjustment invoice; removals become account credit, spent automatically on the next invoice. The portal previews the exact amounts first.
- **Renewal radar**: subscriptions ending in 30 days, with notices to the customer at 30 and 7 days.
- **Company profile and brand**: logo upload, legal name, address, GSTIN (with its check digit validated), bank and UPI details, used on every invoice and email. Fonts are bundled, so the app looks the same offline.
- **Activity log** for the admin: who changed what, linked to the record and to the request id in the server log.

## Architecture

```
apps/
  api/          Express 5 + TypeScript, PostgreSQL through node-postgres (raw SQL)
    src/modules/<area>/        routes → controller → service → repository
    src/db/migrations/         hand-written SQL, applied in order at start-up
  web/          React 18 + Vite + TanStack Query, plain CSS with design tokens
packages/
  shared/       rules both sides run: Zod schemas, pricing and part-period
                engines, workflow tables, GST, bank statement parser, money and dates
```

- **Modular monolith.** Each area owns its routes, controller, service and repository: auth, users, customers, company, catalog, plans, templates, discounts, subscriptions, changes, credits, invoices, billing, automation, payments, bank, notifications, reports, exports, activity, portal, realtime. Who may call what is declared once, per mount, in `routes.ts`.
- **One source of truth for rules.** The browser and the API run the same validation schemas, the same pricing engine and the same workflow tables, so a form, a live preview and the saved invoice can never disagree.
- **Realtime without a library.** Services publish an event after their transaction commits; `/api/events` streams it as Server-Sent Events, and open screens refresh themselves. Customers receive only events about their own records.
- **Automation that is safe to scale out.** Each daily job claims its day through a unique index, so several servers never run it twice; each reminder stage and renewal notice is claimed before its email goes.

## Database

Migrations in `apps/api/src/db/migrations`:

| File | Adds |
|---|---|
| `001_init.sql` | customers, users, reset tokens, taxes, payment terms, products, attributes, variants, plans, templates, discounts, subscriptions and their lines, discounts and events, invoices and lines, discount usages, payments, document sequences, audit log |
| `002_brand_gst_email.sql` | company profile (one row), GSTIN and state on customers, HSN/SAC, the CGST/SGST/IGST split on invoices, the email outbox |
| `003_automation.sql` | job runs, invoice reminders, renewal notices |
| `004_self_service.sql` | invoice kind (recurring or adjustment), subscription changes, the customer credit ledger |
| `005_bank_imports.sql` | bank imports and their lines |
| `006_list_indexes.sql` | covering indexes for the customer list |

Decisions worth knowing:

- **Money is `BIGINT` paise** and rates are basis points (18% = 1800). No floating point touches an amount.
- **"Nothing billed twice"** is enforced by the database: a partial unique index allows one live recurring invoice per subscription per period. The billing run locks its batch with `FOR UPDATE SKIP LOCKED`, so re-running it, or running it on two servers, is safe. A subscription that missed periods gets one invoice for each.
- **A bank transaction can pay once, ever**: a partial unique index on the line's fingerprint where it was posted.
- **CHECK constraints** stop overpayment, a Paid invoice that is not fully paid, discount overuse, a GST split that does not add up to the tax, a negative price, a bad GSTIN, IFSC, UPI id or pincode, and bad date ranges. Statuses are PostgreSQL enums.
- **Prices are snapshotted** onto subscription and invoice lines, so a later catalog change never rewrites history.
- **Every foreign key and every list filter is indexed**, including partial indexes on the billing run's and the renewal radar's only query paths.

## Security

- Passwords hashed with bcrypt (cost 12). The session is a signed JWT in an **httpOnly, SameSite=Lax** cookie, never readable by scripts.
- Every request re-checks the user, so deactivating an account or resetting a password ends existing sessions at once.
- Customers are scoped to their own records everywhere; another customer's record answers 404, not 403.
- Reset tokens are random, stored only as SHA-256, single-use and short-lived. "Forgot password" answers the same for known and unknown emails, and login takes the same time either way.
- Sign-in is rate-limited, all SQL is parameterised, and sort columns come from an allow-list. Helmet sets security headers; request bodies are capped at 100 KB (2.5 MB for bank statements). Uploaded logos are checked by their file signature, not their name.
- CSV exports quote every cell and neutralise anything a spreadsheet would run as a formula.

## Performance

Measured with the bulk data loaded (20,016 subscriptions, 114,209 invoices, 105,552 payments):

| Screen | API time |
|---|---|
| Dashboard (every figure, the 12-month chart, health, renewals) | 0.2–0.4 s |
| Subscriptions list, filtered and sorted | 0.02 s |
| Invoices, overdue filter | 0.03 s |
| Payments list | 0.3 s |
| Customers sorted by balance owed | 0.05 s |
| Export every invoice to CSV (114,209 rows) | about 1 s |

Lists are paged and filtered in SQL; dashboard figures are single aggregate queries; queries slower than 200 ms are logged.

## Quality

```bash
npm test          # 30 unit tests: pricing, part-period charges, workflow, GST, money, dates, bank parsing
                  # + 44 API tests against a real PostgreSQL
npm run lint
npm run typecheck
```

The API tests use a separate `brightloop_test` database (set `TEST_DATABASE_URL` to change it). They cover the password policy and unique emails, reset tokens ending sessions, role checks, the subscription workflow, billing idempotency, discount use limits, GST splits and PDFs, payments, portal isolation, the daily jobs running once, reminder escalation, renewal notices, mid-period changes and credit, bank matching and double-posting, CSV safety, the activity log and the delete rules.

**Debugging.** Every response carries an `X-Request-Id`; the same id is in the structured server log (pino), in error bodies and in the activity log, so one click on an entry finds the request. Errors share one shape: `{ error: { code, message, fieldErrors, requestId } }`. Every change of status is on the subscription's timeline; every email is in the outbox.

## Configuration

`apps/api/.env` (copied from `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/brightloop` | your PostgreSQL |
| `JWT_SECRET` | a development-only value | required, at least 32 characters, in production |
| `APP_URL` | `http://localhost:5173` | used in email links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | not set | send real email; without them emails are kept in the outbox |
| `AUTOMATION_ENABLED` | `true` | run the daily jobs on this server |
| `AUTOMATION_INTERVAL_MINUTES` | `10` | how often the server checks for today's jobs |
