/**
 * Other systems this dashboard links out to.
 *
 * Kept as data rather than written into the navigation component, for the same
 * reason project names are: a URL that moves should be one edit in a config
 * file, not a hunt through a component.
 */

export interface ExternalLink {
  label: string;
  href: string;
  /** Shown as the link's title, so what sits behind it is not a guess. */
  description: string;
}

export const EXTERNAL_LINKS: ExternalLink[] = [
  {
    label: 'IT BOX',
    href: 'https://portal.chaithanin.com',
    description: 'Chaithanin IT portal — opens in a new tab',
  },
];
