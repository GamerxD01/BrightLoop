import type { ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  pending?: boolean;
}

/** One filled primary per screen; everything else is a cotton card or plain text. */
export function Button({
  variant = 'secondary',
  pending,
  children,
  disabled,
  type = 'button',
  className = '',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`btn btn--${variant} ${className}`}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}

export function ButtonLink({
  variant = 'secondary',
  className = '',
  ...rest
}: LinkProps & { variant?: Variant }) {
  return <Link className={`btn btn--${variant} ${className}`} {...rest} />;
}
