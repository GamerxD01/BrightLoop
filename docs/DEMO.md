# Demo script

About ten minutes, following the billing month in the brief. Each step names the judging criterion it shows.

## Before you start

```bash
npm run setup -- --reset     # fresh demo data, dated around today
npm run dev                  # http://localhost:5173
```

Open two browser windows side by side: **A** signed in as `admin@brightloop.test`, **B** as the customer `iyer.textiles@example.in` (password `Brightloop@2026` for both). Keep the API terminal visible for the request-id step.

## 1. Sign up and roles (security, validation): 1 minute

1. In a private window open **Create an account**. Type a weak password and watch the checklist; submit and see the field error. Then use `admin@brightloop.test` as the email: "Already registered".
2. In A, **Team**: only the admin can add staff. Sign in as staff and the Team and Activity log entries are gone; the API answers 403 too.

## 2. Launch a plan (logic, database design): 1 minute

1. **Products → ERP Connector**: the *Odoo* variant adds ₹560. HSN/SAC and tax per product.
2. **Plans → Business Yearly**: minimum 5 seats, cannot be closed early, cannot be paused. These rules decide which buttons a subscription shows.

## 3. Quote to subscription (workflow, usability): 2 minutes

1. **Subscriptions → New**: customer *Kavya Iyer* (the portal login in window B), *Growth Monthly*, 12 seats, add *ERP Connector (Odoo)*, tick *Bulk seats 10%*. The price card updates as you type, discount and tax included: the same pricing code the server bills with.
2. Set seats to 2 and save: "This plan needs at least 3", from the server, on the field.
3. Create the draft, **Send quotation**. In B, open the quotation and **Accept quotation**: it starts at once. A's screen updates by itself (Server-Sent Events). Open its **History**.

## 4. Billing day (automation, idempotency): 1 minute

1. **Dashboard**: "Billing ran automatically at …". **Automation** lists the four daily jobs and their history.
2. **Billing run → Run billing** twice. The second run creates nothing. The database itself refuses a duplicate period (a partial unique index), so a second server could not double-bill either.

## 5. The invoice (GST, branding): 1 minute

1. **Invoices** → any invoice: the GST tax invoice with logo, GSTINs, HSN/SAC, CGST + SGST or IGST by place of supply, the total in words and a UPI QR code. **Download PDF**.
2. An overdue invoice shows its **Reminders**: polite, firm and final, sent automatically, each once.

## 6. Self-service with fair part-period billing (logic): 1.5 minutes

1. In B open **SUB/2026/00001**. Raise seats from 12 to 15 and untick *Extra Storage*. The preview shows what is invoiced today for the days left and what comes back as credit, before anything is saved.
2. **Confirm change**. B gets a "mid-period change" invoice; A sees the change on the subscription's timeline.

## 7. The money comes in (the bank statement): 1.5 minutes

1. **Bank statements → Download a sample statement** (built from today's open invoices), then **Upload a statement** with that file.
2. Each line says why it matched: invoice number in the narration, part payment, name and amount, two invoices for the same amount (left for a person to choose), rent going out, an unknown sender.
3. **Record payments** (the strong matches are ticked already). Upload the same file again: everything recorded shows *Already recorded*. A bank transaction can pay only once.

## 8. Month end (performance, insights): 1 minute

1. **Dashboard**: revenue, outstanding, overdue, renewal radar, and health (churn, revenue per customer, collection rate, days to get paid). Filter by plan; the URL keeps the filter.
2. **Invoices → Overdue → Export CSV**: the same rows, spreadsheet-safe.
3. Optional, to show scale: in a terminal `npm run db:seed:bulk` (8 seconds), then reload the dashboard. Every page stays well under two seconds with 20,000 subscriptions.

## 9. Debugging (activity log): 30 seconds

**Activity log** → click a request id. The same id is on the HTTP response (`X-Request-Id`), in the API log line and in any error the user saw, so one id traces a problem from the screen to the server.
