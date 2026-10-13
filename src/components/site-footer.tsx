import Link from 'next/link';
import { siteSettings } from '@/lib/site-settings';

export function SiteFooter() {
  return (
    <footer className="cinema-footer">
      <div className="cinema-container cinema-footer-inner">
        <p>{siteSettings.name} 仅提供影片搜索服务，内容来源于第三方。</p>
        <p className="cinema-footer-links">
          <Link href="/about">关于本站</Link>
        </p>
      </div>
    </footer>
  );
}
