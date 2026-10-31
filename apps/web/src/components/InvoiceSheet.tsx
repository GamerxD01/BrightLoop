import { formatPercent } from '@brightloop/shared';
import { formatDate, formatMoney } from '../lib/format';
import type { Invoice } from '../lib/types';
import { InvoiceStatusTag } from './Status';

/**
 * The record this product is known by: the invoice as a cotton sheet on the
 * desk. When it is settled, "Paid" is pressed into the stock in coral. The same
 * component prints.
 */
export function InvoiceSheet({ invoice }: { invoice: Invoice }) {
  return (
    <article className="sheet stock" aria-label={`Invoice ${invoice.number}`}>
      <header className="sheet__head">
        <div>
          <p className="sheet__from">Brightloop Software</p>
          <p className="sheet__muted">Lucknow, India</p>
        </div>
        <InvoiceStatusTag status={invoice.status} overdue={invoice.isOverdue} />
      </header>

      <h2 className="sheet__title">
        Invoice <span className="fig">{invoice.number}</span>
      </h2>

      <div className="sheet__parties">
        <dl>
          <dt>Billed to</dt>
          <dd>
            {invoice.customerName}
            {invoice.customerCompany && (
              <span className="sheet__muted">{invoice.customerCompany}</span>
            )}
            {invoice.customerAddress && (
              <span className="sheet__muted">{invoice.customerAddress}</span>
            )}
          </dd>
        </dl>
        <dl>
          <dt>Issued</dt>
          <dd className="fig">{formatDate(invoice.invoiceDate)}</dd>
          <dt>Due</dt>
          <dd className="fig">{formatDate(invoice.dueDate)}</dd>
        </dl>
        <dl>
          <dt>Period</dt>
          <dd className="fig">
            {formatDate(invoice.periodStart)} to {formatDate(invoice.periodEnd)}
          </dd>
          {invoice.subscriptionNumber && (
            <>
              <dt>Subscription</dt>
              <dd className="fig">{invoice.subscriptionNumber}</dd>
            </>
          )}
        </dl>
      </div>

      <table className="sheet__lines">
        <caption className="visually-hidden">Invoice lines</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              Unit price
            </th>
            <th scope="col" className="num">
              Tax
            </th>
            <th scope="col" className="num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {l.description}
                {l.discount > 0 && (
                  <span className="sheet__muted">Discount {formatMoney(l.discount)}</span>
                )}
              </td>
              <td className="num fig">{l.quantity}</td>
              <td className="num fig">{formatMoney(l.unitPrice)}</td>
              <td className="num fig">{formatPercent(l.taxRateBp)}</td>
              <td className="num fig">{formatMoney(l.subtotal - l.discount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sheet__foot">
        <dl className="sheet__totals">
          <div>
            <dt>Subtotal</dt>
            <dd className="fig">{formatMoney(invoice.amountUntaxed)}</dd>
          </div>
          {invoice.amountDiscount > 0 && (
            <div>
              <dt>
                Discount
                {invoice.discounts.length
                  ? ` (${invoice.discounts.map((d) => d.name).join(', ')})`
                  : ''}
              </dt>
              <dd className="fig">−{formatMoney(invoice.amountDiscount)}</dd>
            </div>
          )}
          <div>
            <dt>Tax</dt>
            <dd className="fig">{formatMoney(invoice.amountTax)}</dd>
          </div>
          <div className="sheet__total">
            <dt>Total</dt>
            <dd className="fig">{formatMoney(invoice.amountTotal)}</dd>
          </div>
          {invoice.amountPaid > 0 && (
            <div>
              <dt>Paid</dt>
              <dd className="fig">{formatMoney(invoice.amountPaid)}</dd>
            </div>
          )}
          {invoice.status !== 'cancelled' && (
            <div className="sheet__due">
              <dt>Amount due</dt>
              <dd className="fig">{formatMoney(invoice.amountDue)}</dd>
            </div>
          )}
        </dl>
        {invoice.status === 'paid' && (
          <p className="pressed" aria-label="Paid in full">
            Paid
          </p>
        )}
      </div>
      <p className="sheet__note">Pay by bank transfer or UPI, quoting {invoice.number}.</p>
    </article>
  );
}
