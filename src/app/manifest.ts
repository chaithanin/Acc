import type { MetadataRoute } from 'next';

/**
 * The installable-app description, served at /manifest.webmanifest.
 *
 * `background_color` is the splash screen behind the icon while the app
 * starts, and is white because the artwork was drawn against white. The
 * `theme_color` is the page background instead, so the system bars meet the
 * app without a seam. Only one value can be given here; the dark-mode
 * counterpart is declared in the root layout's viewport, which browsers
 * honour per colour scheme.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable identity, so a change of start_url later does not register as
    // a different app and leave the installed one orphaned.
    id: '/',
    name: 'Global Top Group – Financial Management Dashboard',
    short_name: 'GTG Finance',
    description:
      'Import financial workbooks, recalculate every figure and compare each reporting period with the last.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#f4f5f7',
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      // `any` keeps its transparency: the browser composites it against its
      // own chrome, which it knows the colour of and we do not.
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // `maskable` is opaque and inset, because the platform crops it to
      // whatever shape it likes and fills the whole tile with what remains.
      {
        src: '/icons/maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
