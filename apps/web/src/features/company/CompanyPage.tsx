import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { INDIAN_STATES, LOGO_MAX_BYTES, companySchema } from '@brightloop/shared';
import { BrandMark } from '../../components/Brand';
import { Button } from '../../components/Button';
import { SelectField, TextArea, TextField } from '../../components/Field';
import { PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { useFormSubmit } from '../../lib/forms';
import type { Company } from '../../lib/types';

type Form = Record<Exclude<keyof Company, 'hasLogo' | 'updatedAt'>, string>;

const EMPTY: Form = {
  brandName: '',
  legalName: '',
  addressLine: '',
  city: '',
  stateCode: '',
  pincode: '',
  gstin: '',
  email: '',
  phone: '',
  website: '',
  bankName: '',
  bankAccount: '',
  bankIfsc: '',
  upiId: '',
  invoiceFooter: '',
};

function LogoPanel({ company }: { company: Company }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = new Date(company.updatedAt).getTime();

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['company'] });
    void qc.invalidateQueries({ queryKey: ['brand'] });
  };

  const upload = async (file: File) => {
    setError(null);
    if (!['image/png', 'image/jpeg'].includes(file.type))
      return setError('Choose a PNG or JPEG file');
    if (file.size > LOGO_MAX_BYTES) return setError('The logo must be 512 KB or smaller');
    setBusy(true);
    try {
      const res = await fetch('/api/company/logo', {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; fieldErrors?: Record<string, string> };
        } | null;
        throw new ApiError(
          res.status,
          'UPLOAD',
          body?.error?.fieldErrors?.logo ?? body?.error?.message ?? 'Upload failed',
        );
      }
      toast.show('Logo updated everywhere');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await fetch('/api/company/logo', { method: 'DELETE', credentials: 'same-origin' });
      toast.show('Using the default mark');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Logo">
      <div className="logo-edit">
        <div className="logo-edit__preview stock">
          {company.hasLogo ? (
            <img src={`/api/brand/logo?v=${version}`} alt="Current logo" width={200} height={56} />
          ) : (
            <span className="sheet__mark">
              <BrandMark size={30} /> {company.brandName}
            </span>
          )}
        </div>
        <div className="stack">
          <p className="muted">
            Shown in the app, the portal, every invoice, PDF and email. PNG or JPEG, up to 512 KB; a
            wide logo on a light background prints best.
          </p>
          <input
            ref={input}
            id="logo-file"
            type="file"
            accept="image/png,image/jpeg"
            className="visually-hidden"
            onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
          />
          <div className="form-actions form-actions--start">
            <Button onClick={() => input.current?.click()} pending={busy}>
              {company.hasLogo ? 'Replace logo' : 'Upload a logo'}
            </Button>
            {company.hasLogo && (
              <Button variant="quiet" onClick={() => void remove()} disabled={busy}>
                Use the default mark
              </Button>
            )}
          </div>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** Admin: who the business is. Everything here prints on new invoices and emails. */
export function CompanyPage() {
  const qc = useQueryClient();
  const company = useQuery({ queryKey: ['company'], queryFn: () => api.get<Company>('/company') });
  const [f, setF] = useState<Form>(EMPTY);
  useEffect(() => {
    const c = company.data;
    if (c)
      setF(
        Object.fromEntries(
          Object.keys(EMPTY).map((k) => [k, (c[k as keyof Form] as string | null) ?? '']),
        ) as Form,
      );
  }, [company.data]);
  const { errors, pending, submit, formRef } = useFormSubmit(
    companySchema,
    (d) => api.put<Company>('/company', d),
    {
      success: 'Company profile saved. New invoices use it from now on.',
      onDone: () => {
        void qc.invalidateQueries({ queryKey: ['company'] });
        void qc.invalidateQueries({ queryKey: ['brand'] });
      },
    },
  );
  if (company.isError)
    return <ErrorState error={company.error} onRetry={() => void company.refetch()} />;
  if (!company.data) return <SkeletonBlock />;
  const field = (key: keyof Form) => ({
    value: f[key],
    error: errors[key],
    onChange: (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value }),
  });

  return (
    <>
      <PageHeader
        title="Company profile"
        meta="Issued invoices keep the details they were issued with."
      />
      <LogoPanel company={company.data} />
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(f);
        }}
      >
        <Panel title="Business">
          <div className="form-grid">
            <TextField
              label="Brand name"
              hint="Shown in the app and emails"
              {...field('brandName')}
            />
            <TextField label="Legal name" hint="Printed on invoices" {...field('legalName')} />
            <TextField
              label="Address"
              className="span-2"
              autoComplete="street-address"
              {...field('addressLine')}
            />
            <TextField label="City" autoComplete="address-level2" {...field('city')} />
            <SelectField label="State" {...field('stateCode')}>
              <option value="">Choose a state</option>
              {INDIAN_STATES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </SelectField>
            <TextField
              label="PIN code"
              inputMode="numeric"
              autoComplete="postal-code"
              {...field('pincode')}
            />
            <TextField
              label="GSTIN"
              hint="Sets CGST + SGST for customers in your state, IGST for others"
              autoCapitalize="characters"
              {...field('gstin')}
            />
            <TextField label="Billing email" type="email" {...field('email')} />
            <TextField label="Phone" type="tel" {...field('phone')} />
            <TextField label="Website" type="url" hint="Optional" {...field('website')} />
          </div>
        </Panel>
        <Panel title="How customers pay you">
          <div className="form-grid">
            <TextField
              label="UPI ID"
              hint="Puts a scan-to-pay QR on every open invoice"
              {...field('upiId')}
            />
            <TextField label="Bank name" {...field('bankName')} />
            <TextField label="Account number" inputMode="numeric" {...field('bankAccount')} />
            <TextField label="IFSC" autoCapitalize="characters" {...field('bankIfsc')} />
            <TextArea
              label="Invoice footer"
              className="span-2"
              hint="Payment terms or a thank-you line"
              {...field('invoiceFooter')}
            />
          </div>
        </Panel>
        <div className="form-actions">
          <Button type="submit" variant="primary" pending={pending}>
            Save profile
          </Button>
        </div>
      </form>
    </>
  );
}
