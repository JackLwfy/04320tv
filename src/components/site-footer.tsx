import Link from 'next/link';
import type { ReactNode } from 'react';
import { siteSettings } from '@/lib/site-settings';
import { NewsletterEntry } from './newsletter-entry';

export function SiteFooter({ children }: { children?: ReactNode } = {}) {
  return (
    <footer className="cinema-footer">
      <div className="cinema-container cinema-footer-inner">
        <p>{siteSettings.name} 仅提供影片搜索服务，内容来源于第三方。</p>
        <p className="cinema-footer-links">
          <Link href="/about">关于本站</Link>
          <NewsletterEntry />
        </p>
      </div>
      {children && <div className="cinema-container cinema-footer-extra">{children}</div>}
    </footer>
  );
}
