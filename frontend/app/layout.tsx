import type { Metadata, Viewport } from 'next';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import './globals.css';

/**
 * Fraunces for display, Instrument Sans for everything else.
 *
 * Fraunces carries the warmth the product needs — a soft, slightly odd old-style
 * serif whose variable SOFT and WONK axes give headlines a handmade quality no
 * grotesk provides. Instrument Sans handles UI and body copy, where character
 * has to give way to legibility at 13px.
 *
 * `display: 'swap'` so text stays readable during the font fetch: this page's
 * whole job is to get someone to press a button, and invisible text does not.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  axes: ['SOFT', 'WONK', 'opsz'],
});

const instrument = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument',
});

export const metadata: Metadata = {
  title: {
    default: 'Solar Consultation Assistant',
    template: '%s · Solar Consultation Assistant',
  },
  description:
    'A short conversation to see whether your home qualifies for a savings consultation.',
  // The widget is not a public marketing page and the dashboard is admin-only.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#fbf9f5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${instrument.variable}`}>
      <body>{children}</body>
    </html>
  );
}
