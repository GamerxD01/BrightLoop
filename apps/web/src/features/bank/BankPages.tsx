import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { Money } from '../../components/Money';
import { PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { DataTable, EmptyState } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { formatDate, formatDateTime, formatMoney, plural } from '../../lib/format';

type LineStatus = 'matched' | 'suggested' | 'unmatched' | 'ignored' | 'duplicate' | 'posted';

interface BankLine {
  id: number;
  lineNo: number;
  txnDate: string;
  description: string;
  reference: string | null;
  amount: number;
  direction: 'in' | 'out';
  status: LineStatus;
  reason: string | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  invoiceCustomer: string | null;
  invoiceDue: number | null;
}

interface BankImport {
  id: number;
  filename: string;
  createdAt: string;
  uploadedBy: string | null;
  lines: BankLine[];
  skipped?: { lineNo: number; message: string }[];
}

interface ImportRow {
  id: number;
  filename: string;
  createdAt: string;
  uploadedBy: string | null;
  lines: number;
  posted: number;
  toReview: number;
  unmatched: number;
  postedAmount: number;
}

const STATUS_TEXT: Record<LineStatus, string> = {
  matched: 'Matched',
  suggested: 'Check',
  unmatched: 'No match',
  ignored: 'Set aside',
  duplicate: 'Already recorded',
  posted: 'Recorded',
};
const STATUS_TAG: Record<LineStatus, string> = {
  matched: 'tag--confirmed',
  suggested: 'tag--quotation',
  unmatched: 'tag--overdue',
  ignored: 'tag--closed',
  duplicate: 'tag--closed',
  posted: 'tag--paid',
};

/** Upload a statement, or try the sample built from today's open invoices. */
export function BankImportsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const imports = useQuery({
    queryKey: ['bank-imports'],
    queryFn: () => api.get<ImportRow[]>('/bank-imports'),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 2_000_000)
        throw new ApiError(413, 'TOO_LARGE', 'Files up to about 2 MB, please');
      return api.post<BankImport>('/bank-imports', {
        filename: file.name,
        content: await file.text(),
      });
    },
    onSuccess: (imp) => {
      void qc.invalidateQueries({ queryKey: ['bank-imports'] });
      const skipped = imp.skipped?.length ?? 0;
      toast.show(
        `Read ${plural(imp.lines.length, 'transaction')}${skipped ? `; ${skipped} unreadable line${skipped === 1 ? '' : 's'} skipped` : ''}`,
      );
      navigate(`/bank/${imp.id}`);
    },
    onError: (err) =>
      toast.show(err instanceof ApiError ? err.message : 'The file could not be read', 'error'),
    onSettled: () => {
      if (fileRef.current) fileRef.current.value = '';
    },
  });

  return (
    <>
      <PageHeader title="Bank statements" />
      <Panel title="Match a statement to invoices">
        <div className="upload">
          <p className="lead-text">
            Export a statement from your bank as CSV and upload it. Each money-in line is matched to
            an invoice by the invoice number in its narration, its amount, or the customer&rsquo;s
            name. You check the matches, then record them as payments in one go.
          </p>
          <div className="upload__actions">
            <input
              ref={fileRef}
              id="statement-file"
              type="file"
              accept=".csv,text/csv"
              className="visually-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
              }}
            />
            <Button
              variant="primary"
              pending={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              Upload a statement
            </Button>
            <a className="btn btn--secondary" href="/api/bank-imports/sample" download>
              Download a sample statement
            </a>
          </div>
          <p className="muted upload__note">
            Works with HDFC, SBI, ICICI and most bank exports: a date column, a narration, and
            deposit and withdrawal columns or one amount column.
          </p>
        </div>
      </Panel>
      <Panel title="Earlier statements">
        <DataTable
          caption="Uploaded statements"
          query={imports}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/bank/${r.id}`)}
          columns={[
            {
              key: 'f',
              header: 'File',
              cell: (r) => <Link to={`/bank/${r.id}`}>{r.filename}</Link>,
            },
            {
              key: 'w',
              header: 'Uploaded',
              cell: (r) => <span className="fig">{formatDateTime(r.createdAt)}</span>,
            },
            { key: 'b', header: 'By', cell: (r) => r.uploadedBy ?? 'Not set' },
            {
              key: 'l',
              header: 'Lines',
              align: 'end',
              cell: (r) => <span className="fig">{r.lines}</span>,
            },
            {
              key: 'r',
              header: 'To review',
              align: 'end',
              cell: (r) => <span className="fig">{r.toReview}</span>,
            },
            {
              key: 'p',
              header: 'Recorded',
              align: 'end',
              cell: (r) => <Money value={r.postedAmount} />,
            },
          ]}
          empty={
            <EmptyState title="No statements yet">
              Upload one above, or start with the sample.
            </EmptyState>
          }
        />
      </Panel>
    </>
  );
}

/** One line's invoice, editable: type a number to point it elsewhere. */
function LineInvoice({ line, importId }: { line: BankLine; importId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(line.invoiceNumber ?? '');
  const [error, setError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (body: { invoiceNumber?: string | null; ignore?: boolean }) =>
      api.patch<BankLine>(`/bank-imports/${importId}/lines/${line.id}`, body),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['bank-import', importId] });
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(Object.values(err.fieldErrors)[0] ?? err.message);
      else toast.show('Could not update the line', 'error');
    },
  });
  const locked =
    line.status === 'posted' || line.status === 'duplicate' || line.direction === 'out';

  if (editing) {
    return (
      <form
        className="line-edit"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ invoiceNumber: value });
        }}
      >
        <input
          className="input input--figure"
          aria-label="Invoice number"
          placeholder="INV/2026/00012"
          value={value}
          aria-invalid={error ? true : undefined}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" pending={update.isPending}>
          Use
        </Button>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </button>
        {error && <p className="field__error line-edit__error">{error}</p>}
      </form>
    );
  }
  return (
    <div className="line-invoice">
      {line.invoiceId ? (
        <>
          <Link to={`/invoices/${line.invoiceId}`} className="fig">
            {line.invoiceNumber}
          </Link>
          <span className="cell-sub">
            {line.invoiceCustomer}
            {line.invoiceDue !== null && line.status !== 'posted'
              ? `, owes ${formatMoney(line.invoiceDue)}`
              : ''}
          </span>
        </>
      ) : (
        <span className="muted">None</span>
      )}
      {!locked && (
        <span className="line-invoice__actions">
          <button type="button" className="btn btn--quiet" onClick={() => setEditing(true)}>
            {line.invoiceId ? 'Change' : 'Choose'}
          </button>
          {line.status !== 'ignored' && (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => update.mutate({ ignore: true })}
            >
              Set aside
            </button>
          )}
        </span>
      )}
    </div>
  );
}

export function BankImportPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const toast = useToast();
  const imp = useQuery({
    queryKey: ['bank-import', id],
    queryFn: () => api.get<BankImport>(`/bank-imports/${id}`),
  });
  const postable = useMemo(
    () =>
      imp.data?.lines.filter(
        (l) => (l.status === 'matched' || l.status === 'suggested') && l.invoiceId,
      ) ?? [],
    [imp.data],
  );
  // Strong matches start ticked; ones to check start unticked.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    setSelected(new Set(postable.filter((l) => l.status === 'matched').map((l) => l.id)));
  }, [postable]);

  const post = useMutation({
    mutationFn: () =>
      api.post<{ posted: number; failed: { lineId: number; message: string }[] }>(
        `/bank-imports/${id}/post`,
        { lineIds: [...selected] },
      ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['bank-import', id] });
      void qc.invalidateQueries({ queryKey: ['bank-imports'] });
      toast.show(
        r.failed.length
          ? `Recorded ${plural(r.posted, 'payment')}; ${r.failed.length} need another look`
          : `Recorded ${plural(r.posted, 'payment')}`,
        r.failed.length ? 'error' : 'info',
      );
    },
    onError: (err) =>
      toast.show(err instanceof ApiError ? err.message : 'Could not record the payments', 'error'),
  });

  if (imp.isError) return <ErrorState error={imp.error} onRetry={() => void imp.refetch()} />;
  if (!imp.data) return <SkeletonBlock lines={8} />;
  const lines = imp.data.lines;
  const total = (s: LineStatus[]) =>
    lines.filter((l) => s.includes(l.status)).reduce((a, l) => a + l.amount, 0);
  const selectedAmount = lines
    .filter((l) => selected.has(l.id))
    .reduce((a, l) => a + Math.min(l.amount, l.invoiceDue ?? 0), 0);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Bank statements', to: '/bank' }, { label: imp.data.filename }]}
        title={imp.data.filename}
        meta={`Uploaded ${formatDateTime(imp.data.createdAt)}${imp.data.uploadedBy ? ` by ${imp.data.uploadedBy}` : ''}`}
        actions={
          <Button
            variant="primary"
            disabled={selected.size === 0}
            pending={post.isPending}
            onClick={() => post.mutate()}
          >
            {selected.size
              ? `Record ${plural(selected.size, 'payment')}, ${formatMoney(selectedAmount)}`
              : 'Record payments'}
          </Button>
        }
      />
      <dl className="stats stats--4">
        <div className="stat">
          <dt>Matched or to check</dt>
          <dd className="fig">{formatMoney(total(['matched', 'suggested']))}</dd>
        </div>
        <div className="stat">
          <dt>Recorded</dt>
          <dd className="fig">{formatMoney(total(['posted']))}</dd>
        </div>
        <div className="stat">
          <dt>No match</dt>
          <dd className={`fig ${total(['unmatched']) ? 'is-alert' : ''}`}>
            {formatMoney(total(['unmatched']))}
          </dd>
        </div>
        <div className="stat">
          <dt>Set aside or repeated</dt>
          <dd className="fig">{formatMoney(total(['ignored', 'duplicate']))}</dd>
        </div>
      </dl>
      <DataTable
        caption="Statement lines"
        query={{ ...imp, data: lines } as never}
        rowKey={(l: BankLine) => l.id}
        columns={[
          {
            key: 'pick',
            header: 'Record',
            cell: (l: BankLine) =>
              postable.includes(l) ? (
                <input
                  type="checkbox"
                  className="pick"
                  aria-label={`Record line ${l.lineNo}`}
                  checked={selected.has(l.id)}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(l.id);
                      else next.delete(l.id);
                      return next;
                    })
                  }
                />
              ) : null,
          },
          {
            key: 'd',
            header: 'Date',
            cell: (l: BankLine) => <span className="fig">{formatDate(l.txnDate)}</span>,
          },
          {
            key: 'n',
            header: 'Narration',
            cell: (l: BankLine) => (
              <>
                {l.description}
                {l.reference && <span className="cell-sub fig">{l.reference}</span>}
              </>
            ),
          },
          {
            key: 'a',
            header: 'Amount',
            align: 'end',
            cell: (l: BankLine) => (
              <span className={l.direction === 'out' ? 'muted' : undefined}>
                {l.direction === 'out' ? '−' : ''}
                <Money value={l.amount} />
              </span>
            ),
          },
          {
            key: 'i',
            header: 'Invoice',
            cell: (l: BankLine) => <LineInvoice line={l} importId={id} />,
          },
          {
            key: 's',
            header: 'Status',
            cell: (l: BankLine) => (
              <>
                <span className={`tag ${STATUS_TAG[l.status]}`}>{STATUS_TEXT[l.status]}</span>
                {l.reason && <span className="cell-sub">{l.reason}</span>}
              </>
            ),
          },
        ]}
        empty={<EmptyState title="No lines in this statement" />}
      />
    </>
  );
}
