import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LABELS, createStaffSchema } from '@brightloop/shared';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Field';
import { PageHeader, Panel, Toolbar } from '../../components/Page';
import { SearchInput } from '../../components/SearchInput';
import { ActiveTag } from '../../components/Status';
import { DataTable, EmptyState, Pagination } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useFormSubmit } from '../../lib/forms';
import type { StaffUser } from '../../lib/types';
import { useUrlState } from '../../lib/url-state';

const DEFAULTS = { q: '', role: '', page: '1' };

function AddStaff({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ fullName: '', email: '', password: '' });
  const { errors, pending, submit, formRef } = useFormSubmit(
    createStaffSchema,
    (d) => api.post<StaffUser>('/users', d),
    {
      success: 'Staff account created. Share the password with them privately.',
      onDone: () => {
        void qc.invalidateQueries({ queryKey: ['users'] });
        onDone();
      },
    },
  );
  return (
    <Panel title="Add a member of staff">
      <form
        ref={formRef}
        noValidate
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(f);
        }}
      >
        <TextField
          label="Full name"
          autoComplete="off"
          value={f.fullName}
          error={errors.fullName}
          onChange={(e) => setF({ ...f, fullName: e.target.value })}
        />
        <TextField
          label="Work email"
          type="email"
          autoComplete="off"
          value={f.email}
          error={errors.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
        <TextField
          label="Starting password"
          type="password"
          autoComplete="new-password"
          value={f.password}
          error={errors.password}
          hint="More than 8 characters with upper, lower and a special character"
          onChange={(e) => setF({ ...f, password: e.target.value })}
        />
        <div className="form-actions">
          <Button onClick={onDone}>Cancel</Button>
          <Button type="submit" variant="primary" pending={pending}>
            Create account
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Admin only: who can sign in. Only the admin adds staff. */
export function UsersPage() {
  const me = useUser();
  const toast = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [f, set] = useUrlState(DEFAULTS);
  const query = useQuery({
    queryKey: ['users', f],
    queryFn: () => api.list<StaffUser>('/users', { ...f, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const toggle = useMutation({
    mutationFn: (u: StaffUser) => api.patch(`/users/${u.id}`, { isActive: !u.isActive }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast.show('Access updated');
    },
    onError: (err) =>
      toast.show(err instanceof ApiError ? err.message : 'Could not update', 'error'),
  });

  return (
    <>
      <PageHeader
        title="Team and logins"
        actions={
          !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add staff
            </Button>
          )
        }
      />
      {adding && <AddStaff onDone={() => setAdding(false)} />}
      <Toolbar>
        <SearchInput label="Search name or email" value={f.q} onChange={(q) => set({ q })} />
        <div className="tabs" role="group" aria-label="Role">
          {[
            ['', 'Everyone'],
            ['admin', 'Admins'],
            ['staff', 'Staff'],
            ['customer', 'Customers'],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              className="tab"
              aria-pressed={f.role === v}
              onClick={() => set({ role: v })}
            >
              {l}
            </button>
          ))}
        </div>
      </Toolbar>
      <DataTable
        caption="Users"
        query={query}
        rowKey={(u) => u.id}
        columns={[
          { key: 'n', header: 'Name', cell: (u) => u.fullName },
          { key: 'e', header: 'Email', cell: (u) => u.email },
          { key: 'r', header: 'Role', cell: (u) => LABELS.role[u.role] },
          {
            key: 'l',
            header: 'Last sign-in',
            cell: (u) =>
              u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="muted">Never</span>,
          },
          {
            key: 's',
            header: 'Status',
            cell: (u) => <ActiveTag active={u.isActive} off="Deactivated" />,
          },
          {
            key: 'a',
            header: 'Access',
            align: 'end',
            cell: (u) =>
              u.id === me.id ? (
                <span className="muted">You</span>
              ) : (
                <button
                  type="button"
                  className="btn btn--quiet"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(u)}
                >
                  {u.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              ),
          },
        ]}
        empty={<EmptyState title="No one matches" />}
      />
      {query.data && (
        <Pagination
          page={Number(f.page)}
          pageSize={25}
          total={query.data.meta.total}
          onPage={(p) => set({ page: String(p) }, { resetPage: false })}
        />
      )}
    </>
  );
}
