import { useEffect, useState } from 'react';

/** Search box that waits for typing to settle before updating the URL. */
export function SearchInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = window.setTimeout(() => onChange(text.trim()), 300);
    return () => window.clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <div className="search">
      <label className="visually-hidden" htmlFor="list-search">
        {label}
      </label>
      <input
        id="list-search"
        className="input"
        type="search"
        placeholder={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
    </div>
  );
}
