/**
 * Navigation icons.
 *
 * Drawn here rather than pulled from an icon package: twelve marks do not
 * justify a dependency, and hand-drawn paths keep the stroke weight identical
 * across all of them, which is what makes a rail of icons read as one set.
 *
 * All are 24×24, stroked in currentColor, so they take the colour of whatever
 * state the item is in.
 */

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Keyed by nav href, so an item without a match still renders a fallback. */
export const NAV_ICONS: Record<string, React.ReactNode> = {
  '/financial': (
    <svg {...base}>
      <path d="M3 3v18h18" />
      <path d="M7 15l3.5-4 3 2.5L20 7" />
    </svg>
  ),
  '/': (
    <svg {...base}>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  '/projects': (
    <svg {...base}>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9.5 21v-5h5v5" />
    </svg>
  ),
  '/receivable': (
    <svg {...base}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h4" />
    </svg>
  ),
  '/boq': (
    <svg {...base}>
      <path d="M4 21V9l8-5 8 5v12" />
      <path d="M4 13h16" />
      <path d="M12 4v17" />
    </svg>
  ),
  '/cashflow': (
    <svg {...base}>
      <path d="M3 17c3-6 6 2 9-3s6 1 9-4" />
      <path d="M17 3h4v4" />
    </svg>
  ),
  '/ledger': (
    <svg {...base}>
      <path d="M5 4h13a1 1 0 011 1v15a1 1 0 01-1 1H5z" />
      <path d="M5 4a2 2 0 000 4h13" />
      <path d="M9 12h7" />
    </svg>
  ),
  '/import': (
    <svg {...base}>
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </svg>
  ),
  '/import/history': (
    <svg {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  '/reports/customer-card': (
    // A card with a run of instalment ticks down its side — what the report is
    // made of, one line per payment.
    <svg {...base}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7 9h4" />
      <path d="M7 12.5h4" />
      <path d="M7 16h4" />
      <path d="M14.5 10.5l1.6 1.6 3-3.2" />
      <path d="M14.5 16h4" />
    </svg>
  ),
  '/reconciliation': (
    <svg {...base}>
      <path d="M4 7h10" />
      <path d="M10 4l4 3-4 3" />
      <path d="M20 17H10" />
      <path d="M14 14l-4 3 4 3" />
    </svg>
  ),
  '/inspector': (
    <svg {...base}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </svg>
  ),
  '/settings/budget': (
    <svg {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v8.5h8.5" />
    </svg>
  ),
  '/settings/projects': (
    <svg {...base}>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 17l9 4 9-4" />
    </svg>
  ),
  '/settings/templates': (
    <svg {...base}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 9h17" />
      <path d="M9 9v11" />
    </svg>
  ),
  '/settings/companies': (
    <svg {...base}>
      <path d="M3 21V6l7-3v18" />
      <path d="M10 21V10l8 3v8" />
      <path d="M6 9h1M6 13h1M14 15h1" />
    </svg>
  ),
  '/settings/users': (
    <svg {...base}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.5a3.5 3.5 0 010 7M18 20c0-2.2-.9-4.2-2.3-5.6" />
    </svg>
  ),
  '/settings/audit': (
    <svg {...base}>
      <path d="M5 3.5h9l5 5v12H5z" />
      <path d="M14 3.5v5h5" />
      <path d="M8.5 13h7M8.5 16.5h4.5" />
    </svg>
  ),
};

export const FALLBACK_ICON = (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
  </svg>
);
