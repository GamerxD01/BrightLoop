import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  PASSWORD_RULES,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from '@brightloop/shared';
import { AuthLayout } from '../../components/AppShell';
import { LoginScene } from '../../components/LoginScene';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Field';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFormSubmit } from '../../lib/forms';
import type { User } from '../../lib/types';

const home = (u: User) => (u.role === 'customer' ? '/portal' : '/');

/** Live checklist under the password field: the same rules the server enforces. */
function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="pwrules" aria-label="Checklist for a strong password">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.message} className={ok ? 'is-met' : undefined}>
            <span className="visually-hidden">{ok ? 'Done: ' : 'Needed: '}</span>
            {r.message}
          </li>
        );
      })}
    </ul>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const { errors, pending, submit, formRef } = useFormSubmit(loginSchema, login, {
    onDone: (u) => navigate(home(u), { replace: true }),
  });

  return (
    <AuthLayout title="Sign in" aside={<LoginScene />}>
      <form
        ref={formRef}
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(form);
        }}
      >
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={form.email}
          error={errors.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={form.password}
          error={errors.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <Button type="submit" variant="primary" pending={pending}>
          Sign in
        </Button>
      </form>
      <p className="authpage__links">
        <Link to="/forgot-password">Forgot your password?</Link>
        <span>
          New here? <Link to="/signup">Create an account</Link>
        </span>
      </p>
      <details className="demo">
        <summary>Demo accounts</summary>
        <p>
          Admin <code>admin@brightloop.test</code>, staff <code>staff@brightloop.test</code>,
          customer <code>iyer.textiles@example.in</code>. Password <code>Brightloop@2026</code>.
        </p>
      </details>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', company: '', email: '', password: '' });
  const { errors, pending, submit, formRef } = useFormSubmit(signupSchema, signup, {
    onDone: (u) => navigate(home(u), { replace: true }),
  });

  return (
    <AuthLayout title="Create your account" aside={<LoginScene />}>
      <form
        ref={formRef}
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(form);
        }}
      >
        <TextField
          label="Your name"
          name="name"
          autoComplete="name"
          value={form.name}
          error={errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <TextField
          label="Company"
          hint="Optional"
          name="organization"
          autoComplete="organization"
          value={form.company}
          error={errors.company}
          onChange={(e) => setForm({ ...form, company: e.target.value })}
        />
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={form.email}
          error={errors.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <TextField
          label="Password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={form.password}
          error={errors.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <PasswordRules value={form.password} />
        <Button type="submit" variant="primary" pending={pending}>
          Create account
        </Button>
      </form>
      <p className="authpage__links">
        <span>
          Already have an account? <Link to="/login">Sign in</Link>
        </span>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { errors, pending, submit, formRef } = useFormSubmit(
    forgotPasswordSchema,
    (data) => api.post('/auth/forgot-password', data),
    { onDone: () => setSent(true) },
  );

  return (
    <AuthLayout title="Reset your password" aside={<LoginScene />}>
      {sent ? (
        <div className="stack">
          <p>
            If {email} has an account, a reset link is on its way. It works once and expires in 30
            minutes.
          </p>
          <Link to="/login">Back to sign in</Link>
        </div>
      ) : (
        <form
          ref={formRef}
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit({ email });
          }}
        >
          <p>
            Enter the email you signed up with and we will send you a link to choose a new password.
          </p>
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            error={errors.email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" variant="primary" pending={pending}>
            Send reset link
          </Button>
          <Link to="/login">Back to sign in</Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const { errors, pending, submit, formRef } = useFormSubmit(
    resetPasswordSchema,
    (data) => api.post('/auth/reset-password', data),
    {
      success: 'Password updated. Sign in with your new password.',
      onDone: () => navigate('/login', { replace: true }),
    },
  );

  return (
    <AuthLayout title="Choose a new password" aside={<LoginScene />}>
      {!token ? (
        <div className="stack">
          <p>This page needs the link from your reset email.</p>
          <Link to="/forgot-password">Ask for a new link</Link>
        </div>
      ) : (
        <form
          ref={formRef}
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit({ token, password });
          }}
        >
          <TextField
            label="New password"
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={password}
            error={errors.password ?? errors.token}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordRules value={password} />
          <Button type="submit" variant="primary" pending={pending}>
            Save password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
