'use client';

import { useState, type CSSProperties } from 'react';
import type { HeroSlot } from '@/lib/home-hero';

export function HeroBackdrop({ slot }: { slot: HeroSlot }) {
  const [failed, setFailed] = useState(false);
  const fallback = '/images/cinema-coast.webp';
  return <picture key={slot.id} className="cinema-hero-picture" style={{ '--hero-position': slot.position, '--hero-mobile-position': slot.mobilePosition, '--hero-shade': slot.shade / 100 } as CSSProperties}>
    <source media="(max-width: 767px)" srcSet={failed ? fallback : slot.mobileImage} />
    <img src={failed ? fallback : slot.image} alt="" className="cinema-hero-art" fetchPriority="high" onError={() => setFailed(true)} />
  </picture>;
}
