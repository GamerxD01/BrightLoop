import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { amountInWords, formatPercent, stateName, upiPaymentUri } from '@brightloop/shared';
import { formatDate, formatMoney } from '../lib/format';
import type { Invoice } from '../lib/types';
import { BrandMark, useBrand } from './Brand';
import { InvoiceStatusTag } from './Status';

/** UPI QR as inline SVG, built in the browser: no outside service sees the payment details. */
function UpiQr({ uri, label }: { uri: string; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toString(uri, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [uri]);
  if (!svg) return <div className="qr qr--pending" aria-hidden="true" />;
  return (
    <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

/**
 * The record this product is known by: a GST tax invoice on a cotton sheet.
 * Seller details are the ones frozen into the invoice on the day it was
 * issued. When settled, "Paid" is pressed into the stock in coral. The same
 * component prints.
 */
export function InvoiceSheet({ invoice: inv }: { invoice: Invoice }) {
  const brand = useBrand().data;
  const seller = inv.seller;
  const payable = inv.status === 'confirmed' && inv.amountDue > 0;
  const upi =
    seller?.upiId && payable
      ? upiPaymentUri({
          upiId: seller.upiId,
          payeeName: seller.legalName,
          amountPaise: inv.amountDue,
          note: inv.number,
        })
      : null;

  return (
    <article className="sheet stock" aria-label={`Invoice ${inv.number}`}>
      <header className="sheet__head">
        <div className="sheet__brand">
          {brand?.hasLogo ? (
            <img
              className="sheet__logo"
              src={`/api/brand/logo?v=${brand.version}`}
              alt={seller?.brandName ?? ''}
              width={160}
              height={40}
            />
          ) : (
            <span className="sheet__mark">
              <BrandMark size={30} /> {seller?.brandName ?? brand?.brandName}
            </span>
          )}
        </div>
        <div className="sheet__doc">
          <p className="sheet__kind">Tax invoice</p>
          <p className="fig sheet__muted">{inv.number}</p>
          <InvoiceStatusTag status={inv.status} overdue={inv.isOverdue} />
        </div>
      </header>

      <div className="sheet__parties">
        <dl>
          <dt>From</dt>
          <dd>
            <strong>{seller?.legalName}</strong>
            {seller?.address && <span className="sheet__muted">{seller.address}</span>}
            {seller?.gstin && (
              <span className="sheet__muted">
                GSTIN <span className="fig">{seller.gstin}</span>
              </span>
            )}
          </dd>
        </dl>
        <dl>
          <dt>Billed to</dt>
          <dd>
            <strong>{inv.customerName}</strong>
            {inv.customerCompany && <span className="sheet__muted">{inv.customerCompany}</span>}
            {inv.customerAddress && <span className="sheet__muted">{inv.customerAddress}</span>}
            <span className="sheet__muted">
              {inv.customerGstin ? (
                <>
                  GSTIN <span className="fig">{inv.customerGstin}</span>
                </>
              ) : (
                'Not registered for GST'
              )}
            </span>
          </dd>
        </dl>
        <dl>
          <dt>Issued</dt>
          <dd className="fig">{formatDate(inv.invoiceDate)}</dd>
          <dt>Due</dt>
          <dd className="fig">{formatDate(inv.dueDate)}</dd>
          <dt>Period</dt>
          <dd className="fig">
            {formatDate(inv.periodStart)} to {formatDate(inv.periodEnd)}
          </dd>
          <dt>Place of supply</dt>
          <dd>
            {stateName(inv.placeOfSupply) ?? 'Not set'}
            {inv.placeOfSupply && <span className="fig"> ({inv.placeOfSupply})</span>}
          </dd>
        </dl>
      </div>

      <table className="sheet__lines">
        <caption className="visually-hidden">Invoice lines</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">HSN/SAC</th>
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              Rate
            </th>
            <th scope="col" className="num">
              GST
            </th>
            <th scope="col" className="num">
              Taxable
            </th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {l.description}
                {l.discount > 0 && (
                  <span className="sheet__muted">Discount {formatMoney(l.discount)}</span>
                )}
              </td>
              <td className="fig">{l.hsnSac ?? ''}</td>
              <td className="num fig">{l.quantity}</td>
              <td className="num fig">{formatMoney(l.unitPrice)}</td>
              <td className="num fig">{formatPercent(l.taxRateBp)}</td>
              <td className="num fig">{formatMoney(l.subtotal - l.discount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sheet__foot">
        {inv.status === 'paid' && (
          <p className="pressed" aria-label="Paid in full">
            Paid
          </p>
        )}
        <dl className="sheet__totals">
          {inv.amountDiscount > 0 && (
            <>
              <div>
                <dt>Before discount</dt>
                <dd className="fig">{formatMoney(inv.amountUntaxed)}</dd>
              </div>
              <div>
                <dt>
                  Discount
                  {inv.discounts.length ? ` (${inv.discounts.map((d) => d.name).join(', ')})` : ''}
                </dt>
                <dd className="fig">−{formatMoney(inv.amountDiscount)}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Taxable value</dt>
            <dd className="fig">{formatMoney(inv.amountUntaxed - inv.amountDiscount)}</dd>
          </div>
          {inv.gstMode === 'inter' ? (
            <div>
              <dt>IGST</dt>
              <dd className="fig">{formatMoney(inv.amountIgst)}</dd>
            </div>
          ) : (
            <>
              <div>
                <dt>CGST</dt>
                <dd className="fig">{formatMoney(inv.amountCgst)}</dd>
              </div>
              <div>
                <dt>SGST</dt>
                <dd className="fig">{formatMoney(inv.amountSgst)}</dd>
              </div>
            </>
          )}
          <div className="sheet__total">
            <dt>Total</dt>
            <dd className="fig">{formatMoney(inv.amountTotal)}</dd>
          </div>
          {inv.amountPaid > 0 && (
            <div>
              <dt>Paid</dt>
              <dd className="fig">{formatMoney(inv.amountPaid)}</dd>
            </div>
          )}
          {inv.status !== 'cancelled' && (
            <div className="sheet__due">
              <dt>Amount due</dt>
              <dd className="fig">{formatMoney(inv.amountDue)}</dd>
            </div>
          )}
        </dl>
      </div>
      <p className="sheet__words">{amountInWords(inv.amountTotal)}</p>

      <div className="sheet__pay">
        {upi && (
          <div className="sheet__upi">
            <UpiQr
              uri={upi}
              label={`UPI QR code to pay ${formatMoney(inv.amountDue)} for ${inv.number}`}
            />
            <p>
              Scan with any UPI app
              <span className="fig sheet__muted">{seller?.upiId}</span>
            </p>
          </div>
        )}
        {seller?.bank && (
          <dl className="sheet__bank">
            <dt>Bank transfer</dt>
            <dd>{seller.bank.name}</dd>
            <dd>
              A/c <span className="fig">{seller.bank.account}</span>
            </dd>
            {seller.bank.ifsc && (
              <dd>
                IFSC <span className="fig">{seller.bank.ifsc}</span>
              </dd>
            )}
            <dd className="sheet__muted">Quote {inv.number} as the reference.</dd>
          </dl>
        )}
        <div className="sheet__sign">
          <p>For {seller?.legalName}</p>
          <p className="sheet__muted">Authorised signatory</p>
        </div>
      </div>
      {seller?.footer && <p className="sheet__note">{seller.footer}</p>}
    </article>
  );
}
