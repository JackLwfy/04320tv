import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '暗场控制室 · 后台预览',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
