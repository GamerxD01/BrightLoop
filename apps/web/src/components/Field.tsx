import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

interface FieldShell {
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
}

/** Label, control, then hint or error in a reserved line so the layout never jumps. */
function Shell({
  label,
  error,
  hint,
  className = '',
  id,
  children,
}: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={`field ${error ? 'field--invalid' : ''} ${className}`}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      {children}
      <p id={`${id}-msg`} className={error ? 'field__error' : 'field__hint'}>
        {error ?? hint ?? ''}
      </p>
    </div>
  );
}

function aria(id: string, error?: string) {
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': `${id}-msg` } as const;
}

export function TextField({
  label,
  error,
  hint,
  className,
  ...input
}: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Shell label={label} error={error} hint={hint} className={className} id={id}>
      <input className="input" {...aria(id, error)} {...input} />
    </Shell>
  );
}

/** Rupee amounts: a ₹ prefix, decimal keypad on phones, tabular figures. */
export function MoneyField({
  label,
  error,
  hint,
  className,
  ...input
}: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Shell label={label} error={error} hint={hint} className={className} id={id}>
      <div className="input-affix">
        <span aria-hidden="true">₹</span>
        <input
          className="input input--figure"
          inputMode="decimal"
          autoComplete="off"
          {...aria(id, error)}
          {...input}
        />
      </div>
    </Shell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  className,
  children,
  ...select
}: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Shell label={label} error={error} hint={hint} className={className} id={id}>
      <select className="input select" {...aria(id, error)} {...select}>
        {children}
      </select>
    </Shell>
  );
}

export function TextArea({
  label,
  error,
  hint,
  className,
  ...area
}: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Shell label={label} error={error} hint={hint} className={className} id={id}>
      <textarea className="input textarea" rows={3} {...aria(id, error)} {...area} />
    </Shell>
  );
}

export function Checkbox({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="check">
      <input
        type="checkbox"
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...input}
      />
      <label htmlFor={id}>
        {label}
        {hint && (
          <span id={`${id}-hint`} className="check__hint">
            {hint}
          </span>
        )}
      </label>
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="form-error" role="alert">
      {message}
    </p>
  );
}
