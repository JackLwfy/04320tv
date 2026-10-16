'use client';

import { useEffect, useRef, useState } from 'react';
import { heroForWeather, type HeroConfig, type HeroSlot } from '@/lib/home-hero';

export function useHomeHero(config: HeroConfig, initial: HeroSlot, initialTime: number, kind: 'rain' | 'snow' | 'none' = 'none', pending = false) {
  const [slot, setSlot] = useState<HeroSlot | null>(pending ? null : initial);
  const shown = useRef({ slot: pending ? null : initial as HeroSlot | null, initialTime, started: performance.now() });
  useEffect(() => {
    if (shown.current.initialTime !== initialTime) { shown.current.initialTime = initialTime; shown.current.started = performance.now(); }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request = 0;
    function refresh() {
      const now = initialTime + performance.now() - shown.current.started;
      if (pending) return;
      const next = heroForWeather(config, now, kind);
      const version = ++request;
      if (!shown.current.slot) { shown.current.slot = next; setSlot(next); }
      else if (JSON.stringify(next) !== JSON.stringify(shown.current.slot)) {
        const image = new window.Image();
        image.onload = () => {
          if (!stopped && request === version) { shown.current.slot = next; setSlot(next); }
        };
        // 图片失败时保留上一幕，下一分钟重试，图文始终同步。
        image.src = window.matchMedia('(max-width: 767px)').matches ? next.mobileImage : next.image;
      }
      clearTimeout(timer);
      timer = setTimeout(refresh, 60000 - now % 60000 + 20);
    }
    function visible() { if (document.visibilityState === 'visible') refresh(); }
    refresh();
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [config, initial, initialTime, kind, pending]);
  return slot;
}
