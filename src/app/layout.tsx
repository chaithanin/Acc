import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Global Top Group – Financial Management Dashboard',
  description:
    'Import financial workbooks, recalculate every figure and compare each reporting period with the last.',
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
      <body>{children}</body>
    </html>
  );
}
