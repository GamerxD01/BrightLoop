<div align="center">

# Brightloop

**Subscription management, from quote to cash, without double billing.**

Products and variants, plans, quotations, subscriptions with a guarded lifecycle, GST invoices that bill themselves, discounts, payments, bank statement matching, a live finance dashboard and a self-service customer portal.

![Node.js](https://img.shields.io/badge/Node.js-20.12+-3c873a?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-149eca?logo=react&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-222?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-336791?logo=postgresql&logoColor=white)
![Tests](https://img.shields.io/badge/tests-78%20passing-2ea44f)

[▶ Watch the 6-minute walkthrough](docs/brightloop-walkthrough-full.mp4) · [Run it](#run-it) · [Demo script](docs/DEMO.md) · [Architecture](#architecture) · [Database](#database)

<img src="docs/screenshots/dashboard.jpg" alt="The finance dashboard: active subscriptions, recurring revenue, collected, outstanding and overdue, revenue by month and the overdue list" width="100%">

</div>

Built for the Odoo hackathon problem statement *Subscription Management System*, from scratch: our own REST API, a PostgreSQL schema written by hand, no backend-as-a-service and no paid third-party APIs. Email is optional SMTP; without it, every email is kept in an in-app outbox.

## Walkthrough video

A narrated tour of every function for all three roles (admin, staff and customer): [**docs/brightloop-walkthrough-full.mp4**](docs/brightloop-walkthrough-full.mp4), 6.5 minutes. The two parts are also separate: [the main tour](docs/brightloop-walkthrough.mp4) and [subscribing from the portal](docs/brightloop-plans.mp4).

| Part | Covers |
|---|---|
| Admin | dashboard, products and variants, plans, quotation templates, discounts, a new subscription with live pricing, the lifecycle, the billing run, the GST invoice, bank statement matching, payments, automation, company profile, team and activity log |
| Staff | what staff can and cannot do, enforced by the server, and live updates |
| Customer, part 2 | browsing plans and subscribing from the portal, and staff seeing it at once: [docs/brightloop-plans.mp4](docs/brightloop-plans.mp4) |
| Customer | the portal, accepting quotations, changing seats mid-period with part-period pricing, invoices and PDFs |

## Highlights

<table>
<tr>
<td width="50%"><b>Live pricing, same code as billing</b><br>The price card updates as you type, discount and tax included. The browser and the server run the same pricing engine, so the preview and the invoice can never disagree.<br><br><img src="docs/screenshots/new-subscription.jpg" alt="New subscription form with the live price card"></td>
<td width="50%"><b>Real GST tax invoices</b><br>Logo, both GSTINs, HSN/SAC, CGST + SGST or IGST by place of supply, the total in words and a UPI QR code. PDF download, print and email.<br><br><img src="docs/screenshots/invoice.jpg" alt="An overdue GST tax invoice with the payment panel"></td>
</tr>
<tr>
<td><b>Bank statement matching</b><br>Upload the statement; every line says why it matched (invoice number, part payment, name and amount). Record them all in one click. A bank transaction can pay once, ever.<br><br><img src="docs/screenshots/bank.jpg" alt="Bank statement review with matched lines ticked"></td>
<td><b>Self-service with fair part-period billing</b><br>Customers change seats and add-ons mid-period and see exactly what is charged today and what comes back as credit, before anything is saved.<br><br><img src="docs/screenshots/portal-change.jpg" alt="Customer portal previewing a seat change"></td>
</tr>
<tr>
<td><b>Billing that cannot double-bill</b><br>Runs by itself every day. A partial unique index allows one invoice per subscription per period; the run locks with <code>FOR UPDATE SKIP LOCKED</code>, so two servers are safe too.<br><br><img src="docs/screenshots/billing.jpg" alt="Billing run page"></td>
<td><b>Automation you can see</b><br>Four daily jobs (start subscriptions, billing, renewal notices, overdue reminders at 3, 7 and 14 days), each claiming its day so it runs once.<br><br><img src="docs/screenshots/automation.jpg" alt="Automation page with job history"></td>
</tr>
</table>

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

A step-by-step walkthrough for judging is in [docs/DEMO.md](docs/DEMO.md).

## Three roles

| | Admin | Staff | Customer |
|---|:---:|:---:|:---:|
| Dashboard, customers, subscriptions, invoices, payments, bank statements | ✓ | ✓ | |
| Quotation templates | ✓ | ✓ | |
| Products, variants, plans, taxes, discount rules | ✓ | view only | |
| Company profile, team, activity log | ✓ | | |
| Own subscriptions and invoices, accept quotations, change seats | | | ✓ |
| Browse plans and subscribe from the portal | | | ✓ |

Who may call what is declared once per route mount on the server; the menu only mirrors it. Another customer's record answers 404, not 403.

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

### The subscription lifecycle

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Draft
    Draft --> Quotation: send quotation
    Quotation --> Draft: back to draft
    Quotation --> Confirmed: confirm / customer accepts
    Confirmed --> Active: start date (automatic)
    Active --> Paused: pause (if the plan allows)
    Paused --> Active: resume
    Draft --> Closed
    Quotation --> Closed
    Confirmed --> Closed
    Active --> Closed: close / expiry
    Paused --> Closed
    Closed --> [*]
```

The same transition table lives in `packages/shared` and drives both the buttons the UI shows and the checks the API makes.

## Screens

<table>
<tr>
<td width="33%"><img src="docs/screenshots/subscriptions.jpg" alt="Subscriptions list"><br><sub>Subscriptions, filtered and sorted in SQL</sub></td>
<td width="33%"><img src="docs/screenshots/subscription.jpg" alt="Subscription detail with timeline"><br><sub>A subscription and its timeline</sub></td>
<td width="33%"><img src="docs/screenshots/invoices.jpg" alt="Invoices list"><br><sub>Invoices with overdue filter and CSV export</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/product.jpg" alt="Product with variants"><br><sub>A product, its tax, HSN/SAC and variants</sub></td>
<td><img src="docs/screenshots/plans.jpg" alt="Plans"><br><sub>Plans and their rules</sub></td>
<td><img src="docs/screenshots/discounts.jpg" alt="Discounts"><br><sub>Discount rules (admin only)</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/dashboard-health.jpg" alt="Dashboard renewals and health"><br><sub>Renewal radar and the health of the book</sub></td>
<td><img src="docs/screenshots/company.jpg" alt="Company profile"><br><sub>Company profile and brand, used on every invoice</sub></td>
<td><img src="docs/screenshots/activity.jpg" alt="Activity log"><br><sub>Activity log, linked to request ids</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/portal.jpg" alt="Customer portal"><br><sub>The customer portal</sub></td>
<td><img src="docs/screenshots/login.jpg" alt="Sign in"><br><sub>Sign in</sub></td>
<td align="center"><img src="docs/screenshots/mobile-dashboard.jpg" alt="Dashboard on a phone" width="60%"><br><sub>Every screen works on a phone</sub></td>
</tr>
</table>

## Beyond the brief

- **GST tax invoices**: seller and buyer GSTIN, HSN/SAC per line, place of supply, CGST + SGST within the state and IGST across states, the total in words, and a **UPI QR code** to pay from. Seller details are snapshotted on each invoice, so a later profile edit never rewrites an issued one.
- **Customers subscribe themselves**: the portal's *Plans* page lists the plans on sale today; the customer picks seats, add-ons and a start date, sees the first invoice priced by the server, and subscribes. It appears on staff screens at once, with the whole path (Draft, Quotation, Confirmed, Active) on its timeline, and bills like any other subscription.
- **Customer self-service**: change seats and switch add-ons on or off mid-period. Additions are charged for the days left on an adjustment invoice; removals become account credit, spent automatically on the next invoice.
- **Renewal radar**: subscriptions ending in 30 days, with notices to the customer at 30 and 7 days.
- **Company profile and brand**: logo upload, legal name, address, GSTIN (with its check digit validated), bank and UPI details, used on every invoice and email. Fonts are bundled, so the app looks the same offline.
- **Realtime**: open screens refresh themselves through Server-Sent Events when a customer pays, accepts or changes something.
- **Activity log** for the admin: who changed what, linked to the record and to the request id in the server log.

## Architecture

```mermaid
flowchart LR
    subgraph Browser
      W[React 18 + Vite<br/>TanStack Query]
    end
    subgraph Shared["packages/shared"]
      S[Zod schemas · pricing engine<br/>proration · workflow tables<br/>GST · bank parser · money]
    end
    subgraph API["apps/api · Express 5"]
      R[routes → controller<br/>→ service → repository]
      J[daily jobs<br/>billing · reminders · renewals]
      E[SSE /api/events]
    end
    DB[(PostgreSQL<br/>hand-written SQL)]
    W -- REST + httpOnly cookie --> R
    E -- live events --> W
    W -.uses.-> S
    R -.uses.-> S
    R --> DB
    J --> DB
```

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

- **Modular monolith.** Each area owns its routes, controller, service and repository: auth, users, customers, company, catalog, plans, templates, discounts, subscriptions, changes, credits, invoices, billing, automation, payments, bank, notifications, reports, exports, activity, portal, realtime.
- **One source of truth for rules.** The browser and the API run the same validation schemas, the same pricing engine and the same workflow tables, so a form, a live preview and the saved invoice can never disagree.
- **Realtime without a library.** Services publish an event after their transaction commits; `/api/events` streams it as Server-Sent Events. Customers receive only events about their own records.
- **Automation that is safe to scale out.** Each daily job claims its day through a unique index, so several servers never run it twice; each reminder stage and renewal notice is claimed before its email goes.

## Database

```mermaid
erDiagram
    CUSTOMERS ||--o{ SUBSCRIPTIONS : has
    CUSTOMERS ||--o{ INVOICES : billed
    CUSTOMERS ||--o{ CUSTOMER_CREDITS : holds
    PLANS ||--o{ SUBSCRIPTIONS : priced_by
    PRODUCTS ||--o{ PRODUCT_VARIANTS : sold_as
    SUBSCRIPTIONS ||--o{ SUBSCRIPTION_LINES : contains
    SUBSCRIPTIONS ||--o{ SUBSCRIPTION_EVENTS : timeline
    SUBSCRIPTIONS ||--o{ INVOICES : generates
    DISCOUNTS ||--o{ SUBSCRIPTION_DISCOUNTS : attached
    INVOICES ||--o{ INVOICE_LINES : contains
    INVOICES ||--o{ PAYMENTS : paid_by
    BANK_IMPORTS ||--o{ BANK_LINES : contains
    BANK_LINES |o--o| PAYMENTS : posts
```

| Migration | Adds |
|---|---|
| `001_init.sql` | customers, users, reset tokens, taxes, payment terms, products, attributes, variants, plans, templates, discounts, subscriptions and their lines, discounts and events, invoices and lines, discount usages, payments, document sequences, audit log |
| `002_brand_gst_email.sql` | company profile (one row), GSTIN and state on customers, HSN/SAC, the CGST/SGST/IGST split on invoices, the email outbox |
| `003_automation.sql` | job runs, invoice reminders, renewal notices |
| `004_self_service.sql` | invoice kind (recurring or adjustment), subscription changes, the customer credit ledger |
| `005_bank_imports.sql` | bank imports and their lines |
| `006_list_indexes.sql` | covering indexes for the customer list |

Decisions worth knowing:

- **Money is `BIGINT` paise** and rates are basis points (18% = 1800). No floating point touches an amount.
- **"Nothing billed twice"** is enforced by the database: a partial unique index allows one live recurring invoice per subscription per period. A subscription that missed periods gets one invoice for each.
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
                  # + 48 API tests against a real PostgreSQL
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
