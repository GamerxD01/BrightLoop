/**
 * A UPI payment link (NPCI deep-link format). Any UPI app that scans the QR
 * opens with payee, amount and the invoice number already filled in.
 */
export function upiPaymentUri(input: {
  upiId: string;
  payeeName: string;
  amountPaise: number;
  note: string;
}): string {
  const params = new URLSearchParams({
    pa: input.upiId,
    pn: input.payeeName.slice(0, 50),
    am: (input.amountPaise / 100).toFixed(2),
    cu: 'INR',
    tn: input.note.slice(0, 80),
  });
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}
