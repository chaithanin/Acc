'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Role, User } from '@/lib/types';
import { FALLBACK_ICON, NAV_ICONS } from './nav-icons';
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

/** What is reachable while the session is looking at the group. */
const GROUP_PAGES = new Set(['/group', '/account']);

/**
 * Sections whose pages are siblings of one another — things used together, not
 * separate destinations. Each is one entry in the sidebar, and its pages are
 * a strip of pills above whichever of them is open. Twenty entries do not fit
 * in a sidebar the height of a laptop screen; eleven do.
 *
 * Dashboards stay as individual entries: they are the destinations.
 */
const STRIP_SECTIONS = new Set(['Data', 'Settings']);

/**
 * The page the visitor is on: the MOST specific href that matches. A plain
 * `startsWith` made /import/history count as a visit to /import as well, so
 * two entries lit up at once.
 */
function activeItem(pathname: string, items: NavItem[]): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of items) {
    const hit =
      item.href === '/'
        ? pathname === '/'
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Dashboards',
    items: [
      { href: '/group', label: 'Group', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/', label: 'Executive Overview', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/financial', label: 'Financial Dashboard', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/projects', label: 'Project Dashboard', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/receivable', label: 'Receivable', roles: ['admin', 'finance', 'management', 'viewer'] },
      { href: '/payable', label: 'Payable', roles: ['admin', 'finance', 'management', 'viewer'] },
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
      { href: '/reports/customer-card', label: 'Customer Card Report', roles: ['admin', 'finance'] },
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
      { href: '/settings/companies', label: 'Companies', roles: ['admin'] },
      { href: '/settings/users', label: 'Users & Roles', roles: ['admin'] },
      { href: '/settings/audit', label: 'Activity Log', roles: ['admin'] },
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
  group = null,
  children,
}: {
  user: User;
  /** Null when the session is looking at the group rather than one company. */
  company: ActiveCompany | null;
  group?: { companyCount: number } | null;
  children: React.ReactNode;
}) {
  // One shape for whatever this session is looking at, so the places that
  // render it do not each have to know whether it is a company or the group.
  const scope = company
    ? {
        name: company.displayName,
        code: company.companyCode,
        detail: `${company.projectCount} ${company.projectCount === 1 ? 'project' : 'projects'}`,
      }
    : {
        name: 'Group',
        code: 'ALL',
        detail: `${group?.companyCount ?? 0} companies, consolidated`,
      };

  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Navigating on a phone should dismiss the drawer.
  useEffect(() => setMobileOpen(false), [pathname]);

  // Read after mount rather than during render: the server has no way to know
  // this preference, and rendering the wrong width first would show the
  // sidebar snapping on every page load.
  useEffect(() => {
    setCollapsed(localStorage.getItem('gtg-nav-collapsed') === '1');
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      localStorage.setItem('gtg-nav-collapsed', value ? '0' : '1');
      return !value;
    });
  };

  // The remembered rail is a preference for a desktop sidebar. On a phone the
  // sidebar is a drawer that is open to read, so every `rail` rule below is
  // scoped to `lg:` and the drawer always shows its labels.
  const rail = collapsed;

  const visibleSections = NAV_GROUPS.map((section) => ({
    section,
    items: section.items
      .filter((item) => item.roles.includes(user.role))
      // The group view is a consolidation, not a company: the pages that read
      // one company's snapshot have nothing to show while it is on, so they
      // are not offered.
      .filter((item) => !group || GROUP_PAGES.has(item.href)),
  })).filter(({ items }) => items.length > 0);

  // The strip of siblings for whichever sibling section the visitor is in.
  const strip = visibleSections.find(
    ({ section, items }) =>
      STRIP_SECTIONS.has(section.title) && items.length > 1 && activeItem(pathname, items),
  );

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-plane"
      >
        Skip to content
      </a>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="no-print fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      {/* A floating glass sheet rather than a wall: inset from the edges so the
          aurora shows round it. */}
      <aside
        className={cx(
          // An open drawer is an overlay, so it takes the near-solid tier: the
          // scrim behind it greys whatever the glass sits over, and muted text
          // on a 64% sheet over a dimmed page is 4.2:1; on the near-solid tier it is 6.0:1.
          'no-print fixed bottom-4 left-4 top-4 z-40 flex w-64 flex-col rounded-[var(--radius-card)] p-3',
          mobileOpen ? 'glass-pop' : 'glass-bar',
          'transition-[width,transform] duration-300 ease-[var(--ease-glass)]',
          rail && 'lg:w-[5.25rem]',
          mobileOpen ? 'translate-x-0' : '-translate-x-[120%] lg:translate-x-0',
        )}
      >
        <div
          className={cx(
            'flex items-center gap-2.5 px-1 pb-3 pt-1',
            rail && 'lg:justify-center lg:px-0',
          )}
        >
          {/* The application's own mark. Which COMPANY is open is in the top bar
              and in the card at the foot, where it already was twice. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo.png"
            alt=""
            width={320}
            height={258}
            className={cx('h-10 w-auto shrink-0', rail && 'lg:h-9')}
          />
          <div className={cx('min-w-0', rail && 'lg:hidden')}>
            <p className="truncate text-[15px] font-bold leading-tight tracking-tight text-ink">
              Global Top Group
            </p>
            <p className="mt-0.5 truncate text-[11px] leading-tight text-sidebar-ink-muted">
              Financial Management
            </p>
          </div>
        </div>

        <nav aria-label="Primary" className="thin-scroll -mx-1 flex-1 overflow-y-auto px-1 py-1">
          {visibleSections.map(({ section, items }) => {
            // A sibling section is one entry here and a strip on the page.
            if (STRIP_SECTIONS.has(section.title) && items.length > 1) {
              const first = items[0]!;
              const active = Boolean(activeItem(pathname, items));
              return (
                <div key={section.title} className="mb-1">
                  <div
                    className={cx('mx-3 mb-2 mt-2 border-t border-sidebar-border', rail && 'lg:mx-2')}
                  />
                  <NavEntry
                    href={first.href}
                    label={section.title}
                    icon={NAV_ICONS[first.href] ?? FALLBACK_ICON}
                    active={active}
                    rail={rail}
                  />
                </div>
              );
            }

            return (
              <div key={section.title} className="mb-3">
                {/* A rule instead of a word on the rail: the grouping still
                    reads, and a truncated label would read as a mistake. */}
                <div
                  className={cx('mx-3 mb-2 hidden border-t border-sidebar-border', rail && 'lg:block')}
                />
                <p
                  className={cx(
                    'px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-ink-muted',
                    rail && 'lg:hidden',
                  )}
                >
                  {section.title}
                </p>
                {items.map((item) => (
                  <NavEntry
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={NAV_ICONS[item.href] ?? FALLBACK_ICON}
                    active={activeItem(pathname, items)?.href === item.href}
                    rail={rail}
                  />
                ))}
              </div>
            );
          })}
        </nav>

        {/*
          Leaving the company is its own action at the foot of the navigation
          rather than a menu item among the pages, because it changes which
          data every other link shows.
        */}
        <div className="mt-2 border-t border-sidebar-border pt-3">
          <Link
            href="/companies"
            title="Switch company"
            className={cx(
              'hidden h-10 items-center justify-center rounded-xl text-sidebar-ink transition-colors hover:bg-sidebar-hover',
              rail && 'lg:flex',
            )}
          >
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 7h13" />
              <path d="M14 4l3 3-3 3" />
              <path d="M20 17H7" />
              <path d="M10 14l-3 3 3 3" />
            </svg>
            <span className="sr-only">Switch company</span>
          </Link>

          <div className={cx('rounded-xl bg-surface-sunken p-3', rail && 'lg:hidden')}>
            <p className="truncate text-xs font-semibold text-ink">{scope.name}</p>
            <p className="mt-0.5 text-[11px] text-sidebar-ink-muted">{scope.detail}</p>
            <Link
              href="/companies"
              className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              Switch company
            </Link>
          </div>

          <button
            type="button"
            onClick={toggleCollapsed}
            className={cx(
              'mt-2 hidden h-9 w-full items-center gap-2 rounded-xl text-xs font-semibold text-sidebar-ink-muted',
              'transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink lg:flex',
              rail ? 'justify-center' : 'px-3',
            )}
            aria-label={rail ? 'Expand navigation' : 'Collapse navigation'}
          >
            <span aria-hidden className="text-base leading-none">
              {rail ? '»' : '«'}
            </span>
            {rail ? null : <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div
        className={cx(
          'flex min-h-screen min-w-0 flex-col transition-[margin] duration-300 ease-[var(--ease-glass)] print:ml-0',
          rail ? 'lg:ml-[7.25rem]' : 'lg:ml-[18rem]',
        )}
      >
        <TopBar user={user} company={company} group={group} onMenu={() => setMobileOpen(true)} />
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {strip ? (
            <SectionTabs
              label={strip.section.title}
              items={strip.items}
              active={activeItem(pathname, strip.items)?.href}
            />
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

/** One entry in the sidebar. */
function NavEntry({
  href,
  label,
  icon,
  active,
  rail,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  rail: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      // The label is the accessible name whether or not it is drawn, so a
      // collapsed rail is still navigable by screen reader, and it doubles as
      // the hover tooltip.
      title={rail ? label : undefined}
      className={cx(
        'group relative mb-0.5 flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold',
        'transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-glass)]',
        rail && 'lg:justify-center lg:px-0',
        active
          ? 'bg-sidebar-active text-white shadow-[0_8px_20px_-8px_var(--accent-glow)]'
          : 'text-sidebar-ink hover:bg-sidebar-hover',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className={cx('truncate', rail && 'lg:sr-only')}>{label}</span>
    </Link>
  );
}

/**
 * The pages of a sibling section, as pills above whichever of them is open.
 * Swipes sideways on a phone rather than wrapping into a block.
 */
function SectionTabs({
  label,
  items,
  active,
}: {
  label: string;
  items: NavItem[];
  active: string | undefined;
}) {
  return (
    <nav aria-label={`${label} pages`} className="no-print mb-5">
      <div className="glass-bar thin-scroll inline-flex max-w-full gap-1 overflow-x-auto rounded-full p-1">
        {items.map((item) => {
          const here = item.href === active;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={here ? 'page' : undefined}
              className={cx(
                'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors',
                here
                  ? 'bg-accent-fill text-white shadow-[0_6px_16px_-8px_var(--accent-glow)]'
                  : 'text-ink-secondary hover:bg-surface-hover hover:text-ink',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function TopBar({
  user,
  company,
  group = null,
  onMenu,
}: {
  user: User;
  company: ActiveCompany | null;
  group?: { companyCount: number } | null;
  onMenu: () => void;
}) {
  return (
    <header className="no-print glass-bar sticky top-4 z-20 mx-4 mt-4 flex items-center gap-3 rounded-[var(--radius-card)] px-3 py-2 sm:mx-6 lg:mx-8">
      <button
        type="button"
        onClick={onMenu}
        className="grid h-9 w-9 place-items-center rounded-full text-ink-secondary transition-colors hover:bg-surface-hover lg:hidden"
        aria-label="Open navigation"
      >
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {/*
        The company is named on every page. Someone reading a figure should
        never have to work out whose figure it is.
      */}
      <Link
        href="/companies"
        className="min-w-0 rounded-xl px-2.5 py-1 transition-colors hover:bg-surface-hover"
        title="Switch company"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold text-ink">
            {company?.displayName ?? 'Group'}
          </span>
          <span aria-hidden className="text-[10px] text-ink-muted">
            ▾
          </span>
        </span>
        <span className="block text-[11px] leading-tight text-ink-muted">
          {company?.companyCode ?? `${group?.companyCount ?? 0} companies`}
        </span>
      </Link>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}

/**
 * The account menu.
 *
 * Sign out moved in here from the top bar, where it sat as a permanently
 * visible button next to everything else — one stray click from ending
 * someone's session mid-task.
 */
function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Any navigation closes it, including a click on one of its own entries.
  useEffect(() => setOpen(false), [pathname]);

  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Escape and a click elsewhere both close it, which is what a menu is
    // expected to do and what a bare dropdown does not do on its own.
    //
    // "Elsewhere" has to mean outside the menu. This used to close it on every
    // click and rely on the wrapper's stopPropagation to shield its own
    // contents, which cannot work: React listens on the document itself, the
    // same node as this listener, and stopPropagation does not stop other
    // listeners on the node it is already at. So the menu closed on a click
    // inside it. For a link that is invisible, because the navigation has
    // already started. For Log out it was fatal: a submit button's form is
    // sent as the click's default action, after dispatch, by which time the
    // menu — and the form — had been unmounted, and the browser dropped the
    // submission ("the form is not connected"). Signing out never happened.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [open]);

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-surface-hover"
      >
        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-full bg-accent-fill text-xs font-bold text-white shadow-[0_6px_16px_-6px_var(--accent-glow)]"
        >
          {initials || '?'}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-medium leading-tight text-ink">{user.name}</span>
          <span className="block text-[11px] capitalize leading-tight text-ink-muted">
            {user.role}
          </span>
        </span>
        <span aria-hidden className="text-[10px] text-ink-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="glass-pop absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-[var(--radius-card)]"
        >
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
          </div>

          <Link
            href="/account"
            role="menuitem"
            className="mx-1.5 my-0.5 block rounded-lg px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            Profile settings
          </Link>
          <Link
            href="/companies"
            role="menuitem"
            className="mx-1.5 my-0.5 block rounded-lg px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            Switch company
          </Link>

          <form action="/api/auth/logout" method="post" className="border-t border-border">
            <button
              type="submit"
              role="menuitem"
              className="mx-1.5 my-1 block w-[calc(100%-0.75rem)] rounded-lg px-3 py-2 text-left text-sm font-semibold text-critical-ink transition-colors hover:bg-critical/10"
            >
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
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
      className="grid h-9 w-9 place-items-center rounded-full text-ink-secondary transition-colors hover:bg-surface-hover"
      aria-label="Toggle colour theme"
    >
      <svg
        width={17}
        height={17}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {theme === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
          </>
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
        )}
      </svg>
    </button>
  );
}
