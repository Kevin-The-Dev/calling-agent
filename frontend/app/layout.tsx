import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Solar Consultation Assistant',
  description: 'Speak with our team about lowering your electricity bill.',
  // The widget is not a public marketing page and the dashboard is admin-only.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
