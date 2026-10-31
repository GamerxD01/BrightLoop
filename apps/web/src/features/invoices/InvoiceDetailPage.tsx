import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LABELS,
  PAYMENT_METHODS,
  invoiceActionBlocker,
  paymentSchema,
  todayIso,
  type InvoiceAction,
} from '@brightloop/shared';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MoneyField, SelectField, TextField } from '../../components/Field';
import { InvoiceSheet } from '../../components/InvoiceSheet';
import { Money } from '../../components/Money';
import { Facts, PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { paiseToRupeesInput, rupeesToPaise, useFormSubmit } from '../../lib/forms';
import type { Invoice } from '../../lib/types';

function RecordPayment({ invoice }: { invoice: Invoice }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    amount: paiseToRupeesInput(invoice.amountDue),
    method: 'bank_transfer',
    paidOn: todayIso(),
    note: '',
  });
  const { errors, pending, submit, formRef } = useFormSubmit(
    paymentSchema,
    (data) => api.post<Invoice>('/payments', data),
    {
      success: 'Payment recorded',
      onDone: (updated) => {
        qc.setQueryData(['invoice', invoice.id], updated);
        setF((s) => ({ ...s, amount: paiseToRupeesInput(updated.amountDue), note: '' }));
      },
    },
  );

  return (
    <Panel title="Record a payment">
      <form
        ref={formRef}
        noValidate
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit({
            invoiceId: invoice.id,
            amount: rupeesToPaise(f.amount),
            method: f.method,
            paidOn: f.paidOn,
            note: f.note,
          });
        }}
      >
        <MoneyField
          label="Amount"
          value={f.amount}
          error={errors.amount}
          hint={`Up to ${paiseToRupeesInput(invoice.amountDue)} is owed`}
          onChange={(e) => setF({ ...f, amount: e.target.value })}
        />
        <SelectField
          label="Method"
          value={f.method}
          error={errors.method}
          onChange={(e) => setF({ ...f, method: e.target.value })}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {LABELS.paymentMethod[m]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Received on"
          type="date"
          max={todayIso()}
          value={f.paidOn}
          error={errors.paidOn}
          onChange={(e) => setF({ ...f, paidOn: e.target.value })}
        />
        <TextField
          label="Note"
          value={f.note}
          error={errors.note}
          hint="Bank reference, cheque number"
          onChange={(e) => setF({ ...f, note: e.target.value })}
        />
        <Button type="submit" variant="primary" pending={pending}>
          Record payment
        </Button>
      </form>
    </Panel>
  );
}

export function InvoiceDetailPage({ portal = false }: { portal?: boolean }) {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const base = portal ? '/portal/invoices' : '/invoices';
  const invoice = useQuery({
    queryKey: [portal ? 'portal' : 'invoice', id],
    queryFn: () => api.get<Invoice>(`${portal ? '/portal' : ''}/invoices/${id}`),
  });

  const act = useMutation({
    mutationFn: (action: InvoiceAction) => api.post<Invoice>(`/invoices/${id}/actions`, { action }),
    onSuccess: (updated, action) => {
      setCancelling(false);
      qc.setQueryData(['invoice', id], updated);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.show(
        {
          confirm: 'Invoice confirmed',
          cancel: 'Invoice cancelled',
          send: `Invoice sent to ${updated.customerEmail}`,
        }[action],
      );
    },
    onError: (err) =>
      toast.show(err instanceof ApiError ? err.message : 'That did not work', 'error'),
  });

  if (invoice.isError)
    return <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />;
  if (!invoice.data) return <SkeletonBlock lines={10} />;
  const inv = invoice.data;
  const can = (a: InvoiceAction) =>
    !portal && invoiceActionBlocker(a, inv.status, inv.amountPaid) === null;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Invoices', to: base }, { label: inv.number }]}
        title={<span className="fig">{inv.number}</span>}
        meta={`${inv.customerName}, due ${formatDate(inv.dueDate)}`}
        actions={
          <>
            <Button onClick={() => window.print()}>Print</Button>
            {can('cancel') && (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                Cancel invoice
              </Button>
            )}
            {can('send') && (
              <Button
                onClick={() => act.mutate('send')}
                pending={act.isPending && act.variables === 'send'}
              >
                {inv.sentAt ? 'Send again' : 'Send to customer'}
              </Button>
            )}
            {can('confirm') && (
              <Button
                variant="primary"
                onClick={() => act.mutate('confirm')}
                pending={act.isPending && act.variables === 'confirm'}
              >
                Confirm invoice
              </Button>
            )}
          </>
        }
      />
      <div className="detail detail--sheet">
        <div className="detail__main desk desk--pad">
          <InvoiceSheet invoice={inv} />
        </div>
        <aside className="detail__side no-print">
          {!portal && inv.status === 'confirmed' && <RecordPayment invoice={inv} />}
          {!portal && inv.status === 'draft' && (
            <Panel title="Draft">
              <p>Confirm this invoice to send it and start taking payments against it.</p>
            </Panel>
          )}
          <Panel title="Payments">
            {inv.payments.length === 0 ? (
              <p className="muted">No payments yet.</p>
            ) : (
              <table className="table table--compact">
                <caption className="visually-hidden">Payments received</caption>
                <tbody>
                  {inv.payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="fig">{formatDate(p.paidOn)}</span>
                        <span className="cell-sub">
                          {LABELS.paymentMethod[p.method]}
                          {p.note ? `, ${p.note}` : ''}
                        </span>
                      </td>
                      <td className="num">
                        <Money value={p.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          {!portal && (
            <Panel title="Details">
              <Facts
                items={[
                  [
                    'Customer',
                    <Link key="c" to={`/customers/${inv.customerId}`}>
                      {inv.customerName}
                    </Link>,
                  ],
                  [
                    'Subscription',
                    inv.subscriptionId ? (
                      <Link key="s" to={`/subscriptions/${inv.subscriptionId}`} className="fig">
                        {inv.subscriptionNumber}
                      </Link>
                    ) : (
                      'Not set'
                    ),
                  ],
                  ['Sent', inv.sentAt ? formatDateTime(inv.sentAt) : 'Not yet'],
                ]}
              />
            </Panel>
          )}
        </aside>
      </div>
      <ConfirmDialog
        open={cancelling}
        title={`Cancel ${inv.number}?`}
        confirmLabel="Cancel invoice"
        pending={act.isPending}
        onCancel={() => setCancelling(false)}
        onConfirm={() => act.mutate('cancel')}
      >
        <p>
          The invoice stays on record as cancelled. Any discount use it took is given back, and the
          period can be billed again.
        </p>
      </ConfirmDialog>
    </>
  );
}
