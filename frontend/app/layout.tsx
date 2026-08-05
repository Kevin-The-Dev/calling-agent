import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

/**
 * Geist for everything, Geist Mono for figures.
 *
 * One family, two weights of emphasis. The previous pairing put a display serif
 * over a second sans, which is two typefaces doing the work that weight and
 * tracking do better: Geist has a tight, engineered fit that holds at 44px and
 * stays legible at 12px, so the hierarchy comes from scale and colour rather
 * than from switching faces halfway down the page.
 *
 * Mono is not decoration. Timers, bills, scores and durations change in place,
 * and proportional figures make them jump.
 *
 * `display: 'swap'` so text stays readable during the font fetch: this page's
 * whole job is to get someone to press a button, and invisible text does not.
 */
const geist = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
});

const title = 'Solarsetter';
const description =
  'Talk to our assistant for two minutes. If your home qualifies, it books a free consultation with an engineer.';

export const metadata: Metadata = {
  title: { default: `${title}: solar consultation assistant`, template: `%s · ${title}` },
  description,
  applicationName: title,
  // The widget is not a public marketing page and the dashboard is admin-only.
  robots: { index: false, follow: false },
  openGraph: {
    title: `${title}: solar consultation assistant`,
    description,
    type: 'website',
    siteName: title,
  },
  twitter: { card: 'summary_large_image', title, description },
  icons: {
    // Inline so the tab mark needs no request and no binary in the repo.
    icon: [
      {
        url:
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='18' fill='%231b4dd8'/%3E%3Crect x='11' y='16' width='3' height='8' rx='1.5' fill='white'/%3E%3Crect x='18' y='11' width='3' height='18' rx='1.5' fill='white'/%3E%3Crect x='25' y='15' width='3' height='10' rx='1.5' fill='white'/%3E%3C/svg%3E",
        type: 'image/svg+xml',
      },
    ],
  },
};

export const viewport: Viewport = {
  // One per scheme, so the browser chrome matches the page it is framing.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1015' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        {/* The console is the only thing on this page anyone came for, and it is
            below a nav. Keyboard users should not have to walk through it. */}
        <a href="#console" className="skip-link">
          Skip to the call
        </a>
        {children}
      </body>
    </html>
  );
}
