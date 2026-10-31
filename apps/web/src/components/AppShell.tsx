import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { LABELS } from '@brightloop/shared';
import { useAuth, useUser } from '../lib/auth';
import { useRealtime, type LiveState } from '../lib/realtime';
import { Wordmark } from './Brand';

interface NavItem {
  to: string;
  label: string;
  adminOnly?: boolean;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Grouped by the job: selling, getting paid, what is sold, who can sign in. */
const NAV: NavGroup[] = [
  { label: 'Overview', items: [{ to: '/', label: 'Dashboard' }] },
  {
    label: 'Sales',
    items: [
      { to: '/subscriptions', label: 'Subscriptions' },
      { to: '/customers', label: 'Customers' },
      { to: '/templates', label: 'Quotation templates' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/invoices', label: 'Invoices' },
      { to: '/payments', label: 'Payments' },
      { to: '/bank', label: 'Bank statements' },
      { to: '/billing', label: 'Billing run' },
      { to: '/automation', label: 'Automation' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { to: '/products', label: 'Products' },
      { to: '/plans', label: 'Plans' },
      { to: '/discounts', label: 'Discounts' },
      { to: '/taxes', label: 'Taxes and terms' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/company', label: 'Company profile', adminOnly: true },
      { to: '/users', label: 'Team', adminOnly: true },
      { to: '/outbox', label: 'Emails sent' },
      { to: '/activity', label: 'Activity log', adminOnly: true },
    ],
  },
];

const LIVE_TEXT: Record<LiveState, string> = {
  live: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline',
};

function UserBlock({ live }: { live: LiveState }) {
  const user = useUser();
  const { logout } = useAuth();
  return (
    <div className="userblock">
      <div className="userblock__who">
        <span className="userblock__name">{user.fullName}</span>
        <span className="userblock__role">
          {LABELS.role[user.role]} <span className={`live live--${live}`}>{LIVE_TEXT[live]}</span>
        </span>
      </div>
      <button type="button" className="btn btn--quiet" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  );
}

/** Back office: a sidebar on wide screens, a menu button under 60rem. */
export function AppShell() {
  const user = useUser();
  const live = useRealtime(true);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="shell__bar">
        <Wordmark />
        <button
          type="button"
          className="btn btn--quiet shell__menu"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close menu' : 'Menu'}
        </button>
      </header>
      <aside id="sidebar" className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar__brand">
          <Wordmark />
        </div>
        <nav aria-label="Main">
          {NAV.map((group) => {
            const items = group.items.filter((i) => !i.adminOnly || user.role === 'admin');
            if (!items.length) return null;
            return (
              <div key={group.label} className="navgroup">
                <p className="navgroup__label">{group.label}</p>
                <ul>
                  {items.map((item) => (
                    <li key={item.to}>
                      <NavLink to={item.to} end={item.to === '/'} className="navlink">
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <UserBlock live={live} />
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}

/** The customer portal: a plain top bar, two destinations. */
export function PortalShell() {
  const location = useLocation();
  const live = useRealtime(true);
  return (
    <div className="portal">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="portal__bar">
        <div className="portal__inner">
          <Wordmark to="/portal" />
          <nav aria-label="Portal" className="portal__nav">
            <NavLink to="/portal" end className="navlink">
              My subscriptions
            </NavLink>
            <NavLink to="/portal/plans" className="navlink">
              Plans
            </NavLink>
            <NavLink to="/portal/invoices" className="navlink">
              Invoices
            </NavLink>
          </nav>
          <UserBlock live={live} />
        </div>
      </header>
      <main id="main" className="portal__main" tabIndex={-1}>
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}

export function AuthLayout({
  children,
  title,
  aside,
}: {
  children: ReactNode;
  title: string;
  aside?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} | Brightloop`;
  }, [title]);
  return (
    <div className="authpage">
      <div className="authpage__form">
        <Wordmark to="/login" label="Sign in" />
        <h1>{title}</h1>
        {children}
      </div>
      <div className="authpage__desk desk" aria-hidden="true">
        {aside}
      </div>
    </div>
  );
}
