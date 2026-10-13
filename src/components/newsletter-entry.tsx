'use client';

import { useState } from 'react';
import { NewsletterDialog } from './newsletter-dialog';
import { siteSettings } from '@/lib/site-settings';

export function NewsletterEntry() {
  const [open, setOpen] = useState(false);
  if (!siteSettings.newsletterEnabled) return null;
  return <><button type="button" onClick={() => setOpen(true)}>订阅光影来信</button>{open && <NewsletterDialog style={siteSettings.newsletterStyle} onClose={() => setOpen(false)} />}</>;
}
