import './globals.css';
import './operational.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Google Play Deployment Assistant',
  description: 'Inspect Android source, APKs and AABs; prepare evidence-backed Google Play listings, policy work, Data Safety evidence and release-readiness reports without inventing app functionality.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
