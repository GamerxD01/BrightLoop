import { createRequire } from 'node:module';
import * as fontkit from 'fontkit';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { amountInWords, formatPercent, stateName, upiPaymentUri } from '@brightloop/shared';
import { companyService } from '../company/company.service';
import type { InvoiceDetail } from './invoices.repository';

const require = createRequire(import.meta.url);
const FONTS = {
  sans: require.resolve('@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff'),
  sansMedium:
    require.resolve('@fontsource/instrument-sans/files/instrument-sans-latin-500-normal.woff'),
  sansBold:
    require.resolve('@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff'),
  mono: require.resolve('@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff'),
  // latin-ext holds the ₹ outline; the latin subset holds the digits.
  monoExt: require.resolve('@fontsource/geist-mono/files/geist-mono-latin-ext-400-normal.woff'),
};

const INK = '#241e1a';
const MUTED = '#6d645e';
const RULE = '#e3dcd5';
const CORAL = '#c2563f';

const figure = (p: number) =>
  (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The ₹ outline straight from Geist Mono. PDFKit drops this glyph when it
 * subsets the font, so it is drawn as a vector path instead.
 */
const rupee = (() => {
  const font = fontkit.openSync(FONTS.monoExt) as fontkit.Font;
  const glyph = font.glyphForCodePoint(0x20b9);
  return {
    d: glyph.path.toSVG(),
    advance: glyph.advanceWidth,
    upm: font.unitsPerEm,
    ascent: font.ascent,
  };
})();

/** Draws "₹1,234.00" aligned inside [x, x + width]. */
function money(
  doc: PDFKit.PDFDocument,
  paise: number,
  x: number,
  y: number,
  width: number,
  opts: { size: number; align?: 'left' | 'right'; prefix?: string; color?: string },
) {
  const digits = `${opts.prefix ?? ''}${figure(paise)}`;
  doc.fontSize(opts.size).fillColor(opts.color ?? INK);
  const scale = opts.size / rupee.upm;
  const symbolW = rupee.advance * scale;
  const digitsW = doc.font('mono').widthOfString(digits);
  const start = opts.align === 'left' ? x : x + width - symbolW - digitsW;
  doc
    .save()
    .translate(start, y + rupee.ascent * scale)
    .scale(scale, -scale)
    .path(rupee.d)
    .fill(opts.color ?? INK)
    .restore();
  doc
    .font('mono')
    .fillColor(opts.color ?? INK)
    .text(digits, start + symbolW, y, { lineBreak: false });
}
const date = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The default mark: an open loop with a dot where it closes. Drawn as vectors so it stays crisp. */
function drawMark(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  const r = size / 2 - size * 0.09;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const start = (-60 * Math.PI) / 180;
  const end = (250 * Math.PI) / 180;
  doc
    .save()
    .lineWidth(size * 0.16)
    .lineCap('round')
    .strokeColor(INK);
  doc
    .path(
      `M ${cx + r * Math.cos(start)} ${cy + r * Math.sin(start)} A ${r} ${r} 0 1 1 ${cx + r * Math.cos(end)} ${cy + r * Math.sin(end)}`,
    )
    .stroke();
  doc
    .circle(
      cx + r * Math.cos(-75 * (Math.PI / 180)) + size * 0.02,
      cy + r * Math.sin(-75 * (Math.PI / 180)),
      size * 0.09,
    )
    .fill(CORAL);
  doc.restore();
}

/** A4 GST tax invoice, the same content as the on-screen sheet. */
export async function renderInvoicePdf(inv: InvoiceDetail): Promise<Buffer> {
  const seller = inv.seller ?? (await companyService.snapshot());
  const logo = await companyService.logo();
  const qr =
    seller.upiId && inv.status === 'confirmed' && inv.amountDue > 0
      ? await QRCode.toBuffer(
          upiPaymentUri({
            upiId: seller.upiId,
            payeeName: seller.legalName,
            amountPaise: inv.amountDue,
            note: inv.number,
          }),
          { type: 'png', margin: 1, width: 240, color: { dark: INK, light: '#ffffff' } },
        )
      : null;

  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    info: { Title: `Invoice ${inv.number}`, Author: seller.legalName },
  });
  doc
    .registerFont('sans', FONTS.sans)
    .registerFont('sans-m', FONTS.sansMedium)
    .registerFont('sans-b', FONTS.sansBold)
    .registerFont('mono', FONTS.mono);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const L = 48;
  const R = doc.page.width - 48;
  const W = R - L;

  // ── Header: brand left, document right
  if (logo?.logo) doc.image(logo.logo, L, 44, { fit: [140, 40] });
  else {
    drawMark(doc, L, 44, 28);
    doc
      .font('sans-b')
      .fontSize(18)
      .fillColor(INK)
      .text(seller.brandName, L + 36, 48);
  }
  doc
    .font('sans-b')
    .fontSize(20)
    .fillColor(INK)
    .text('Tax invoice', L, 44, { width: W, align: 'right' });
  doc
    .font('mono')
    .fontSize(10)
    .fillColor(MUTED)
    .text(inv.number, L, 70, { width: W, align: 'right' });

  // ── Parties
  let y = 110;
  const col = W / 3;
  const block = (x: number, title: string, lines: (string | null | undefined)[]) => {
    doc
      .font('sans-m')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(title, x, y, { width: col - 12 });
    doc.font('sans').fontSize(9.5).fillColor(INK);
    lines.filter(Boolean).forEach((line, i) => {
      if (i === 0) doc.font('sans-b');
      doc.text(line!, x, doc.y + (i === 0 ? 3 : 1), { width: col - 12 });
      doc.font('sans');
    });
    return doc.y;
  };
  const yA = block(L, 'From', [
    seller.legalName,
    seller.address,
    seller.gstin ? `GSTIN ${seller.gstin}` : null,
    seller.email,
    seller.phone,
  ]);
  const yB = block(L + col, 'Billed to', [
    inv.customerName,
    inv.customerCompany,
    inv.customerAddress,
    inv.customerGstin ? `GSTIN ${inv.customerGstin}` : 'Unregistered',
  ]);
  const yC = block(L + 2 * col, 'Details', [
    `Issued ${date(inv.invoiceDate)}`,
    `Due ${date(inv.dueDate)}`,
    `Period ${date(inv.periodStart)} to ${date(inv.periodEnd)}`,
    `Place of supply ${stateName(inv.placeOfSupply) ?? 'Not set'}${inv.placeOfSupply ? ` (${inv.placeOfSupply})` : ''}`,
    inv.subscriptionNumber ? `Subscription ${inv.subscriptionNumber}` : null,
  ]);
  y = Math.max(yA, yB, yC) + 22;

  // ── Lines
  const cols = [
    { k: 'Item', w: 0.34, a: 'left' as const },
    { k: 'HSN/SAC', w: 0.1, a: 'left' as const },
    { k: 'Qty', w: 0.06, a: 'right' as const },
    { k: 'Rate', w: 0.13, a: 'right' as const },
    { k: 'Discount', w: 0.11, a: 'right' as const },
    { k: 'GST', w: 0.08, a: 'right' as const },
    { k: 'Taxable', w: 0.18, a: 'right' as const },
  ];
  const drawRow = (
    cells: (string | { paise: number; prefix?: string } | null)[],
    opts: { head?: boolean } = {},
  ) => {
    let x = L;
    const top = y;
    let h = 0;
    cells.forEach((cell, i) => {
      const c = cols[i]!;
      const w = c.w * W - (i < cols.length - 1 ? 8 : 0);
      if (cell && typeof cell === 'object') {
        money(doc, cell.paise, x, top, w, { size: 9, align: 'right', prefix: cell.prefix });
        h = Math.max(h, 11);
      } else if (cell) {
        doc
          .font(opts.head ? 'sans-m' : i === 0 || i === 1 ? 'sans' : 'mono')
          .fontSize(opts.head ? 8.5 : 9)
          .fillColor(opts.head ? MUTED : INK);
        h = Math.max(h, doc.heightOfString(cell, { width: w }));
        doc.text(cell, x, top, { width: w, align: c.a });
      }
      x += c.w * W;
    });
    y = top + h + 7;
    doc
      .moveTo(L, y - 3)
      .lineTo(R, y - 3)
      .lineWidth(opts.head ? 1.2 : 0.5)
      .strokeColor(opts.head ? INK : RULE)
      .stroke();
    y += 4;
  };
  drawRow(
    cols.map((c) => c.k),
    { head: true },
  );
  for (const l of inv.lines) {
    if (y > doc.page.height - 200) {
      doc.addPage();
      y = 48;
    }
    drawRow([
      l.description,
      l.hsnSac ?? '',
      String(l.quantity),
      { paise: l.unitPrice },
      l.discount ? { paise: l.discount } : null,
      formatPercent(l.taxRateBp),
      { paise: l.subtotal - l.discount },
    ]);
  }

  // ── Totals, right
  y += 6;
  const tx = L + W * 0.55;
  const tw = W * 0.45;
  const totalsTop = y;
  const total = (label: string, value: number, strong = false) => {
    doc
      .font(strong ? 'sans-b' : 'sans')
      .fontSize(strong ? 11 : 9.5)
      .fillColor(strong ? INK : MUTED)
      .text(label, tx, y, { width: tw * 0.55 });
    money(doc, value, tx + tw * 0.45, y, tw * 0.55, { size: strong ? 11 : 9.5, align: 'right' });
    y += strong ? 18 : 15;
  };
  total('Taxable value', inv.amountUntaxed - inv.amountDiscount);
  if (inv.gstMode === 'inter') total(`IGST`, inv.amountIgst);
  else {
    total('CGST', inv.amountCgst);
    total('SGST', inv.amountSgst);
  }
  doc.moveTo(tx, y).lineTo(R, y).lineWidth(1.2).strokeColor(INK).stroke();
  y += 6;
  total('Total', inv.amountTotal, true);
  if (inv.amountPaid > 0) total('Paid', inv.amountPaid);
  if (inv.status !== 'cancelled') total('Amount due', inv.amountDue, true);

  // Settled: pressed into the page beside the totals, never over them.
  if (inv.status === 'paid') {
    doc.save().rotate(-8, { origin: [L + 90, totalsTop + 30] });
    doc
      .font('sans-b')
      .fontSize(40)
      .fillColor(CORAL)
      .fillOpacity(0.85)
      .text('Paid', L + 30, totalsTop + 6, { lineBreak: false });
    doc.restore();
  }

  doc
    .font('sans')
    .fontSize(9)
    .fillColor(INK)
    .text(amountInWords(inv.amountTotal), L, y + 6, { width: W });
  y = doc.y + 18;

  // ── Pay: QR and bank, left. Signatory, right.
  const payTop = y;
  if (qr) {
    doc.image(qr, L, payTop, { width: 92 });
    doc
      .font('sans-m')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text('Scan to pay with any UPI app', L + 100, payTop + 4, { width: 160 });
    doc
      .font('mono')
      .fontSize(9)
      .fillColor(INK)
      .text(seller.upiId!, L + 100, doc.y + 2, { width: 160 });
  }
  if (seller.bank) {
    const bx = qr ? L + 100 : L;
    const by = qr ? payTop + 40 : payTop;
    doc.font('sans-m').fontSize(8.5).fillColor(MUTED).text('Bank transfer', bx, by, { width: 200 });
    doc
      .font('sans')
      .fontSize(9)
      .fillColor(INK)
      .text(
        [
          seller.bank.name,
          `A/c ${seller.bank.account}`,
          seller.bank.ifsc ? `IFSC ${seller.bank.ifsc}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        bx,
        doc.y + 2,
        { width: 200 },
      );
    doc
      .font('sans')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(`Quote ${inv.number} as the reference.`, bx, doc.y + 2, { width: 200 });
  }
  doc
    .font('sans')
    .fontSize(9)
    .fillColor(INK)
    .text(`For ${seller.legalName}`, L + W * 0.6, payTop + 4, { width: W * 0.4, align: 'right' });
  doc
    .font('sans')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text('Authorised signatory', L + W * 0.6, payTop + 62, { width: W * 0.4, align: 'right' });

  if (inv.status === 'cancelled') {
    doc.font('sans-b').fontSize(14).fillColor(CORAL).text('Cancelled', L, 92);
  }

  // ── Footer
  const footer = [seller.footer, 'This is a computer-generated invoice.']
    .filter(Boolean)
    .join('  ');
  doc
    .font('sans')
    .fontSize(8)
    .fillColor(MUTED)
    .text(footer, L, doc.page.height - 64, { width: W, align: 'center' });

  doc.end();
  return done;
}
