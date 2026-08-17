'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Role, User } from '@/lib/types';
import { cx } from './ui/primitives';

/**
 * Navigation shell (requirement 12).
 *
 * Entries are filtered by role, so a Viewer never sees an Import link that
 * would only refuse them. The server enforces the same rules independently —
 * this is convenience, not security.
 */

interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Dashboards',
    items: [
      { href: '/financial', label: 'Financial Dashboard', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/', label: 'Executive Overview', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/projects', label: 'Project Dashboard', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/receivable', label: 'Receivable', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/boq', label: 'BOQ / Construction', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/cashflow', label: 'Cash Flow Forecast', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/ledger', label: 'Ledger & Advances', roles: ['admin', 'finance', 'management', 'viewer'] },
    ],
  },
  {
    title: 'Data',
    items: [
      { href: '/import', label: 'Data Import', roles: ['admin', 'finance'] },
      { href: '/import/history', label: 'Import History', roles: ['admin', 'finance', 'management'] },
      { href: '/reconciliation', label: 'Reconciliation', roles: ['admin', 'finance', 'management'] },
      { href: '/inspector', label: 'Data Inspector', roles: ['admin', 'finance'] },
    ],
  },
  {
    title: 'Settings',
    items: [
      { href: '/settings/budget', label: 'Budget', roles: ['admin', 'finance'] },
      { href: '/settings/projects', label: 'Projects & Aliases', roles: ['admin', 'finance'] },
      { href: '/settings/templates', label: 'Template Mapping', roles: ['admin', 'finance'] },
      { href: '/settings/users', label: 'Users & Roles', roles: ['admin'] },
    ],
  },
];

export interface ActiveCompany {
  id: string;
  companyCode: string;
  displayName: string;
  legalName: string;
  projectCount: number;
}

export function AppShell({
  user,
  company,
  children,
}: {
  user: User;
  company: ActiveCompany;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Navigating on a phone should dismiss the drawer.
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen">
      <aside
        className={cx(
          'no-print fixed inset-y-0 left-0 z-40 w-60 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar',
          'transition-transform lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4">
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sidebar-active text-sm font-bold text-white"
          >
            G
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-sidebar-ink">
              {company.displayName}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-sidebar-ink-muted">
              {company.companyCode} · Financial Management
            </p>
          </div>
        </div>

        <nav className="px-2 py-3">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => item.roles.includes(user.role));
            if (items.length === 0) return null;

            return (
              <div key={group.title} className="mb-4">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-ink-muted">
                  {group.title}
                </p>
                {items.map((item) => {
                  const active =
                    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cx(
                        // The active item carries a left rule as well as a
                        // tint, so position marks it even at a glance.
                        'block rounded-md border-l-2 px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'border-sidebar-active bg-sidebar-hover font-medium text-sidebar-ink'
                          : 'border-transparent text-sidebar-ink-muted hover:bg-sidebar-hover hover:text-sidebar-ink',
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/*
          Leaving the company is its own action at the foot of the navigation
          rather than a menu item among the pages, because it changes which
          data every other link shows.
        */}
        <div className="border-t border-sidebar-border px-2 py-3">
          <Link
            href="/companies"
            className="block rounded-md px-2 py-1.5 text-sm text-sidebar-ink-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink"
          >
            ⇄ Switch Company
          </Link>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} company={company} onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function TopBar({
  user,
  company,
  onMenu,
}: {
  user: User;
  company: ActiveCompany;
  onMenu: () => void;
}) {
  return (
    <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onMenu}
        className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-hover lg:hidden"
        aria-label="Open navigation"
      >
        ☰
      </button>

      {/*
        The company sits in the top bar on every page. Someone reading a figure
        should never have to work out whose figure it is.
      */}
      <Link
        href="/companies"
        className="min-w-0 rounded-md px-2 py-1 transition-colors hover:bg-surface-hover"
        title="Switch company"
      >
        <p className="truncate text-xs font-semibold leading-tight text-ink">
          {company.displayName}
        </p>
        <p className="text-[11px] leading-tight text-ink-muted">Switch company ▾</p>
      </Link>

      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
        <Link
          href="/account"
          className="rounded-md px-2 py-1 text-right transition-colors hover:bg-surface-hover"
          title="Your account and password"
        >
          <p className="text-xs font-medium leading-tight text-ink">{user.name}</p>
          <p className="text-[11px] capitalize leading-tight text-ink-muted">{user.role}</p>
        </Link>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-md border border-border-strong px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('gtg-theme');
    if (stored === 'dark' || stored === 'light') setTheme(stored);
  }, []);

  const toggle = () => {
    const next =
      theme === 'dark'
        ? 'light'
        : theme === 'light'
          ? 'dark'
          : window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'light'
            : 'dark';
    setTheme(next);
    localStorage.setItem('gtg-theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-md border border-border-strong px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
      aria-label="Toggle colour theme"
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
