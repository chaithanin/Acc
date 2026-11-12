import type { Metadata, Viewport } from 'next';
import { PwaRegister } from '@/components/pwa-register';
// Self-hosted through npm rather than next/font/google: nothing is fetched from
// Google at build time or by a visitor's browser. Each package's CSS declares
// its subsets with unicode-range, so Thai text pulls the Thai file and a page of
// Latin pulls neither it nor the mono face.
import '@fontsource-variable/urbanist/wght.css';
import '@fontsource-variable/noto-sans-thai/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Global Top Group – Financial Management Dashboard',
  description:
    'Import financial workbooks, recalculate every figure and compare each reporting period with the last.',
  applicationName: 'GTG Finance',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    // iOS ignores the manifest for this and composites transparency against
    // black, so it gets the opaque variant of its own.
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'GTG Finance',
    // The app draws its own light and dark surfaces, so the status bar is
    // left translucent rather than painted a colour that would be wrong in
    // one of the two.
    statusBarStyle: 'default',
  },
  // A dashboard behind a sign-in has nothing to gain from being indexed, and
  // the manifest makes the app's name and icon public either way.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Matches the page background in each scheme, so the system bars meet the
  // app without a seam. The manifest can only carry one value; this is what
  // browsers read per colour scheme.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e7ecf3' },
    { media: '(prefers-color-scheme: dark)', color: '#04070d' },
  ],
  // Installed as an app, the layout should reach under the rounded corners
  // and notches rather than letterbox itself.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applies the saved theme before first paint so a dark-mode user never
          sees a white flash. Kept inline and tiny for that reason.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('gtg-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        {/* Four blurred pools of colour behind everything; see globals.css. */}
        <div className="aurora" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </div>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
