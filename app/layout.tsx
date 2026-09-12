import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Google Play Deployment Assistant',
  description: 'Evidence-first Google Play deployment preparation, policy readiness, store listing, privacy, assets, and release assistance.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
