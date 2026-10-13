import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { isLiveEnabled } from '@/lib/env-live-enabled';

export const dynamic = 'force-dynamic';

export default function LiveLayout({ children }: { children: ReactNode }) {
  if (!isLiveEnabled()) redirect('/');
  return children;
}
