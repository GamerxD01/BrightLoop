import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { DataTable, EmptyState } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { formatDate, formatDateTime } from '../../lib/format';

interface JobRun {
  id: number;
  job: string;
  runDate: string;
  trigger: 'schedule' | 'manual';
  status: 'running' | 'done' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string | null;
}

interface AutomationStatus {
  enabled: boolean;
  intervalMinutes: number;
  jobs: { key: string; name: string; description: string }[];
  runs: JobRun[];
}

const RESULT_LABELS: Record<string, string> = {
  started: 'started',
  invoicesCreated: 'invoices created',
  invoicesEmailed: 'emailed',
  autoClosed: 'closed at expiry',
  noticesSent: 'renewal notices',
  endingSoon: 'ending soon',
  remindersSent: 'reminders sent',
  overdue: 'overdue',
};

/** "12 invoices created, 12 emailed" from a job's result. */
export function summarise(result: Record<string, unknown> | null): string {
  if (!result) return '';
  return Object.entries(RESULT_LABELS)
    .filter(([k]) => typeof result[k] === 'number' && (result[k] as number) > 0)
    .map(([k, label]) => `${result[k]} ${label}`)
    .join(', ');
}

/** What runs by itself every day, when it last ran, and a way to run it now. */
export function AutomationPage() {
  const admin = useUser().role === 'admin';
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: ['automation'],
    queryFn: () => api.get<AutomationStatus>('/automation'),
    refetchInterval: 30_000,
  });
  const run = useMutation({
    mutationFn: (job: string) =>
      api.post<{ status: string; result?: Record<string, unknown>; error?: string }>(
        `/automation/${job}/run`,
      ),
    onSuccess: (r) => {
      toast.show(
        r.status === 'done'
          ? `Done: ${summarise(r.result ?? null) || 'nothing to do'}`
          : `Failed: ${r.error}`,
        r.status === 'done' ? 'info' : 'error',
      );
      void qc.invalidateQueries({ queryKey: ['automation'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) =>
      toast.show(err instanceof ApiError ? err.message : 'Could not run the job', 'error'),
  });

  if (status.isError)
    return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  if (!status.data) return <SkeletonBlock />;
  const s = status.data;
  const last = (job: string) => s.runs.find((r) => r.job === job);

  return (
    <>
      <PageHeader
        title="Automation"
        meta={
          s.enabled
            ? `On. Each job runs once a day; the server checks every ${s.intervalMinutes} minutes.`
            : 'Off on this server (AUTOMATION_ENABLED=false). Jobs can still be run by hand.'
        }
      />
      <Panel title="Daily jobs, in the order they run">
        <ol className="jobs">
          {s.jobs.map((j) => {
            const r = last(j.key);
            return (
              <li key={j.key} className="job">
                <div className="job__text">
                  <h3>{j.name}</h3>
                  <p className="muted">{j.description}</p>
                  <p className="job__last">
                    {r ? (
                      <>
                        Last run {formatDateTime(r.startedAt)} (
                        {r.trigger === 'manual' ? `by ${r.triggeredBy}` : 'scheduled'}):{' '}
                        {r.status === 'failed' ? (
                          <span className="is-alert">failed, {r.error}</span>
                        ) : (
                          summarise(r.result) || 'nothing to do'
                        )}
                      </>
                    ) : (
                      'Not run yet'
                    )}
                  </p>
                </div>
                {admin && (
                  <Button
                    onClick={() => run.mutate(j.key)}
                    pending={run.isPending && run.variables === j.key}
                    disabled={run.isPending}
                  >
                    Run now
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </Panel>
      <Panel title="History">
        <DataTable
          caption="Job history"
          query={{ ...status, data: s.runs } as never}
          rowKey={(r: JobRun) => r.id}
          columns={[
            {
              key: 'when',
              header: 'Started',
              cell: (r: JobRun) => <span className="fig">{formatDateTime(r.startedAt)}</span>,
            },
            {
              key: 'job',
              header: 'Job',
              cell: (r: JobRun) => s.jobs.find((j) => j.key === r.job)?.name ?? r.job,
            },
            {
              key: 'day',
              header: 'For',
              cell: (r: JobRun) => <span className="fig">{formatDate(r.runDate)}</span>,
            },
            {
              key: 'how',
              header: 'Started by',
              cell: (r: JobRun) => (r.trigger === 'manual' ? r.triggeredBy : 'Schedule'),
            },
            {
              key: 'out',
              header: 'Outcome',
              cell: (r: JobRun) =>
                r.status === 'failed' ? (
                  <span className="is-alert">{r.error}</span>
                ) : (
                  summarise(r.result) || 'Nothing to do'
                ),
            },
          ]}
          empty={
            <EmptyState title="No runs yet">
              The first scheduled pass starts a few seconds after the server does.
            </EmptyState>
          }
        />
      </Panel>
    </>
  );
}
