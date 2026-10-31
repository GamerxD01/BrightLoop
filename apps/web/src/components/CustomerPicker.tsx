import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Customer } from '../lib/types';

/**
 * Customers can number in the thousands, so they are searched, not listed.
 * An accessible combobox: type, arrow through results, Enter to pick.
 */
export function CustomerPicker({
  value,
  label = 'Customer',
  error,
  onChange,
}: {
  value: { id: number; name: string } | null;
  label?: string;
  error?: string;
  onChange: (c: { id: number; name: string } | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value?.name ?? '');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => setText(value?.name ?? ''), [value]);
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);

  const results = useQuery({
    queryKey: ['customers', 'pick', term],
    queryFn: () =>
      api.list<Customer>('/customers', { q: term, pageSize: 8, sort: 'name', dir: 'asc' }),
    enabled: open,
  });
  const options = results.data?.data ?? [];

  const pick = (c: Customer) => {
    onChange({ id: c.id, name: c.name });
    setText(c.name);
    setOpen(false);
  };

  return (
    <div className={`field combo ${error ? 'field--invalid' : ''}`}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={
          open && options[active] ? `${id}-opt-${options[active]!.id}` : undefined
        }
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-msg`}
        autoComplete="off"
        placeholder="Search by name, email or company"
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (value) onChange(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          }
          if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault();
            pick(options[active]!);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul id={`${id}-list`} role="listbox" className="combo__list">
          {results.isPending && <li className="combo__note">Searching…</li>}
          {!results.isPending && options.length === 0 && (
            <li className="combo__note">No customer matches “{term}”.</li>
          )}
          {options.map((c, i) => (
            <li
              key={c.id}
              id={`${id}-opt-${c.id}`}
              role="option"
              aria-selected={i === active}
              className="combo__option"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <span>{c.name}</span>
              <span className="combo__sub">{c.company ?? c.email}</span>
            </li>
          ))}
        </ul>
      )}
      <p id={`${id}-msg`} className={error ? 'field__error' : 'field__hint'}>
        {error ?? ''}
      </p>
    </div>
  );
}
