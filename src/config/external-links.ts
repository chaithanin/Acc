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
    /*
     * The service's own address. Linked at the root rather than at the sign-in
     * URL it redirects to: that URL carries a callbackUrl of its own, and
     * pinning a link to someone else's login route means it breaks the day
     * they change it. Sent to the front door, IT BOX decides where to put
     * whoever arrives — including straight through, if they are already
     * signed in.
     *
     * If portal.chaithanin.com is pointed at this service, change it here and
     * nowhere else.
     */
    href: 'https://itbox-ppjbzqdu3q-as.a.run.app',
    description: 'IT BOX — opens in a new tab',
  },
];
