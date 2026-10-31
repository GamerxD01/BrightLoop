import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Role } from '@brightloop/shared';
import { AppShell, PortalShell } from './components/AppShell';
import { EmptyState, SkeletonBlock } from './components/States';
import { ButtonLink } from './components/Button';
import { useAuth } from './lib/auth';
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
} from './features/auth/AuthPages';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { SubscriptionsPage } from './features/subscriptions/SubscriptionsPage';
import { SubscriptionDetailPage } from './features/subscriptions/SubscriptionDetailPage';
import { SubscriptionFormPage } from './features/subscriptions/SubscriptionFormPage';
import { InvoicesPage } from './features/invoices/InvoicesPage';
import { InvoiceDetailPage } from './features/invoices/InvoiceDetailPage';
import { PaymentsPage } from './features/payments/PaymentsPage';
import {
  CustomerDetailPage,
  CustomerFormPage,
  CustomersPage,
} from './features/customers/CustomersPages';
import { ProductFormPage, ProductsPage } from './features/catalog/ProductsPages';
import { SettingsPage } from './features/catalog/SettingsPage';
import { PlanFormPage, PlansPage } from './features/plans/PlansPages';
import { TemplateFormPage, TemplatesPage } from './features/templates/TemplatesPages';
import { DiscountFormPage, DiscountsPage } from './features/discounts/DiscountsPages';
import { UsersPage } from './features/users/UsersPage';
import { BillingPage } from './features/billing/BillingPage';
import {
  PortalHomePage,
  PortalInvoicesPage,
  PortalSubscriptionPage,
} from './features/portal/PortalPages';

/** Sends people to sign in, or to the side of the app their role belongs to. */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="boot">
        <SkeletonBlock />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role))
    return <Navigate to={user.role === 'customer' ? '/portal' : '/'} replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to={user.role === 'customer' ? '/portal' : '/'} replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <EmptyState
      title="This page does not exist"
      action={<ButtonLink to="/">Go to the start</ButtonLink>}
    >
      The link may be old, or the record may have been removed.
    </EmptyState>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestOnly>
            <LoginPage />
          </GuestOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <GuestOnly>
            <SignupPage />
          </GuestOnly>
        }
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        path="/portal"
        element={
          <RequireRole roles={['customer']}>
            <PortalShell />
          </RequireRole>
        }
      >
        <Route index element={<PortalHomePage />} />
        <Route path="subscriptions/:id" element={<PortalSubscriptionPage />} />
        <Route path="invoices" element={<PortalInvoicesPage />} />
        <Route path="invoices/:id" element={<InvoiceDetailPage portal />} />
      </Route>

      <Route
        element={
          <RequireRole roles={['admin', 'staff']}>
            <AppShell />
          </RequireRole>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="subscriptions/new" element={<SubscriptionFormPage />} />
        <Route path="subscriptions/:id" element={<SubscriptionDetailPage />} />
        <Route path="subscriptions/:id/edit" element={<SubscriptionFormPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/new" element={<CustomerFormPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="customers/:id/edit" element={<CustomerFormPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/new" element={<ProductFormPage />} />
        <Route path="products/:id" element={<ProductFormPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="plans/new" element={<PlanFormPage />} />
        <Route path="plans/:id" element={<PlanFormPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="templates/new" element={<TemplateFormPage />} />
        <Route path="templates/:id" element={<TemplateFormPage />} />
        <Route path="discounts" element={<DiscountsPage />} />
        <Route path="discounts/new" element={<DiscountFormPage />} />
        <Route path="discounts/:id" element={<DiscountFormPage />} />
        <Route path="taxes" element={<SettingsPage />} />
        <Route
          path="users"
          element={
            <RequireRole roles={['admin']}>
              <UsersPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
