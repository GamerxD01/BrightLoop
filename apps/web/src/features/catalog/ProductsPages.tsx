import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { PRODUCT_TYPES, formatPercent, productSchema } from '@brightloop/shared';
import { Button, ButtonLink } from '../../components/Button';
import { Checkbox, MoneyField, SelectField, TextArea, TextField } from '../../components/Field';
import { Money } from '../../components/Money';
import { PageHeader, Panel, Toolbar } from '../../components/Page';
import { SearchInput } from '../../components/SearchInput';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { ActiveTag } from '../../components/Status';
import { DataTable, EmptyState, Pagination, type Column } from '../../components/Table';
import { api } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { formatMoney } from '../../lib/format';
import { paiseToRupeesInput, rupeesToPaise, useFormSubmit } from '../../lib/forms';
import { useLookups } from '../../lib/queries';
import type { Product } from '../../lib/types';
import { useUrlState } from '../../lib/url-state';

const DEFAULTS = { q: '', type: '', page: '1', sort: 'name', dir: 'asc' };

export function ProductsPage() {
  const user = useUser();
  const [f, set] = useUrlState(DEFAULTS);
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['products', f],
    queryFn: () => api.list<Product>('/catalog/products', { ...f, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: 'Product',
      sortable: true,
      cell: (p) => <Link to={`/products/${p.id}`}>{p.name}</Link>,
    },
    { key: 'type', header: 'Type', cell: (p) => (p.type === 'service' ? 'Service' : 'Goods') },
    {
      key: 'variants',
      header: 'Variants',
      cell: (p) =>
        p.variants.length ? (
          p.variants
            .map((v) => `${v.valueName}${v.extraPrice ? ` +${formatMoney(v.extraPrice)}` : ''}`)
            .join(', ')
        ) : (
          <span className="muted">None</span>
        ),
    },
    { key: 'tax', header: 'Tax', cell: (p) => p.taxName ?? <span className="muted">None</span> },
    { key: 'status', header: 'Status', cell: (p) => <ActiveTag active={p.isActive} /> },
    { key: 'cost', header: 'Cost', align: 'end', cell: (p) => <Money value={p.costPrice} /> },
    {
      key: 'salesPrice',
      header: 'Price',
      sortable: true,
      align: 'end',
      cell: (p) => <Money value={p.salesPrice} />,
    },
  ];
  return (
    <>
      <PageHeader
        title="Products"
        actions={
          user.role === 'admin' && (
            <ButtonLink to="/products/new" variant="primary">
              New product
            </ButtonLink>
          )
        }
      />
      <Toolbar>
        <SearchInput label="Search products" value={f.q} onChange={(q) => set({ q })} />
        <div className="tabs" role="group" aria-label="Type">
          {[
            ['', 'All'],
            ['service', 'Services'],
            ['goods', 'Goods'],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              className="tab"
              aria-pressed={f.type === v}
              onClick={() => set({ type: v })}
            >
              {l}
            </button>
          ))}
        </div>
      </Toolbar>
      <DataTable
        caption="Products"
        columns={columns}
        query={query}
        rowKey={(p) => p.id}
        sort={f.sort}
        dir={f.dir as 'asc' | 'desc'}
        onSort={(key) =>
          set({ sort: key, dir: f.sort === key && f.dir === 'asc' ? 'desc' : 'asc' })
        }
        onRowClick={(p) => navigate(`/products/${p.id}`)}
        empty={
          <EmptyState title="No products found">
            {user.role === 'admin'
              ? 'Add the first product to start selling it.'
              : 'An admin adds products.'}
          </EmptyState>
        }
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

export function ProductFormPage() {
  const user = useUser();
  const id = useParams().id;
  const editing = id ? Number(id) : null;
  const readOnly = user.role !== 'admin';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lookups = useLookups();
  const existing = useQuery({
    queryKey: ['products', editing],
    queryFn: () => api.get<Product>(`/catalog/products/${editing}`),
    enabled: !!editing,
  });
  const [f, setF] = useState({
    name: '',
    type: 'service',
    salesPrice: '',
    costPrice: '',
    notes: '',
    taxId: '',
    hsnSac: '',
    isActive: true,
    variantValueIds: [] as number[],
  });
  useEffect(() => {
    const p = existing.data;
    if (p)
      setF({
        name: p.name,
        type: p.type,
        salesPrice: paiseToRupeesInput(p.salesPrice),
        costPrice: paiseToRupeesInput(p.costPrice),
        notes: p.notes ?? '',
        taxId: p.taxId ? String(p.taxId) : '',
        hsnSac: p.hsnSac ?? '',
        isActive: p.isActive,
        variantValueIds: p.variants.map((v) => v.attributeValueId),
      });
  }, [existing.data]);
  const { errors, pending, submit, formRef } = useFormSubmit(
    productSchema,
    (data) =>
      editing
        ? api.put<Product>(`/catalog/products/${editing}`, data)
        : api.post<Product>('/catalog/products', data),
    {
      success: 'Product saved',
      onDone: (p) => {
        void qc.invalidateQueries({ queryKey: ['products'] });
        navigate(`/products/${p.id}`);
      },
    },
  );
  if ((editing && !existing.data) || !lookups.data)
    return existing.isError ? <ErrorState error={existing.error} /> : <SkeletonBlock />;
  const margin = rupeesToPaise(f.salesPrice) - rupeesToPaise(f.costPrice);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Products', to: '/products' },
          { label: editing ? existing.data!.name : 'New' },
        ]}
        title={editing ? existing.data!.name : 'New product'}
      />
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit({
            ...f,
            salesPrice: rupeesToPaise(f.salesPrice),
            costPrice: rupeesToPaise(f.costPrice),
            taxId: f.taxId ? Number(f.taxId) : null,
          });
        }}
      >
        <fieldset disabled={readOnly} className="bare">
          <Panel title="Product">
            <div className="form-grid">
              <TextField
                label="Name"
                value={f.name}
                error={errors.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
              <SelectField
                label="Type"
                value={f.type}
                error={errors.type}
                onChange={(e) => setF({ ...f, type: e.target.value })}
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === 'service' ? 'Service' : 'Goods'}
                  </option>
                ))}
              </SelectField>
              <MoneyField
                label="Sales price"
                value={f.salesPrice}
                error={errors.salesPrice}
                onChange={(e) => setF({ ...f, salesPrice: e.target.value })}
              />
              <MoneyField
                label="Cost price"
                value={f.costPrice}
                error={errors.costPrice}
                hint={Number.isFinite(margin) ? `Margin ${formatMoney(margin)}` : undefined}
                onChange={(e) => setF({ ...f, costPrice: e.target.value })}
              />
              <SelectField
                label="Tax"
                value={f.taxId}
                error={errors.taxId}
                onChange={(e) => setF({ ...f, taxId: e.target.value })}
              >
                <option value="">No tax</option>
                {lookups.data.taxes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({formatPercent(t.rateBp)})
                  </option>
                ))}
              </SelectField>
              <TextField
                label="HSN/SAC code"
                hint="Printed on GST invoices"
                inputMode="numeric"
                value={f.hsnSac}
                error={errors.hsnSac}
                onChange={(e) => setF({ ...f, hsnSac: e.target.value })}
              />
              <div className="field">
                <span className="field__label">Status</span>
                <Checkbox
                  label="Available to sell"
                  checked={f.isActive}
                  onChange={(e) => setF({ ...f, isActive: e.target.checked })}
                />
              </div>
              <TextArea
                label="Notes"
                className="span-2"
                value={f.notes}
                error={errors.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
              />
            </div>
          </Panel>
          <Panel title="Variants">
            {lookups.data.attributes.length === 0 ? (
              <p className="muted">Add an attribute under Taxes and terms to sell variants.</p>
            ) : (
              <div className="variant-groups">
                {lookups.data.attributes.map((a) => (
                  <fieldset key={a.id} className="checks">
                    <legend className="field__label">{a.name}</legend>
                    {a.values.map((v) => (
                      <Checkbox
                        key={v.id}
                        label={v.name}
                        hint={
                          v.extraPrice ? `Adds ${formatMoney(v.extraPrice)}` : 'No extra charge'
                        }
                        checked={f.variantValueIds.includes(v.id)}
                        onChange={(e) =>
                          setF({
                            ...f,
                            variantValueIds: e.target.checked
                              ? [...f.variantValueIds, v.id]
                              : f.variantValueIds.filter((x) => x !== v.id),
                          })
                        }
                      />
                    ))}
                  </fieldset>
                ))}
              </div>
            )}
            {errors.variantValueIds && <p className="field__error">{errors.variantValueIds}</p>}
          </Panel>
        </fieldset>
        {!readOnly && (
          <div className="form-actions">
            <ButtonLink to="/products">Cancel</ButtonLink>
            <Button type="submit" variant="primary" pending={pending}>
              Save product
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
