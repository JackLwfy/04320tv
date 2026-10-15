'use client';

import { useEffect, useRef, useState } from 'react';
import { heroAt, type HeroConfig, type HeroSlot } from '@/lib/home-hero';

export function useHomeHero(config: HeroConfig, initial: HeroSlot, initialTime: number) {
  const [slot, setSlot] = useState(initial);
  const shown = useRef(initial);
  useEffect(() => {
    const started = performance.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request = 0;
    function refresh() {
      const now = initialTime + performance.now() - started;
      const next = heroAt(config, now);
      const version = ++request;
      if (JSON.stringify(next) !== JSON.stringify(shown.current)) {
        const image = new window.Image();
        image.onload = () => {
          if (!stopped && request === version) { shown.current = next; setSlot(next); }
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
  }, [config, initial, initialTime]);
  return slot;
}
