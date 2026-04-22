import { useEffect, useRef } from 'react';
import type { FingertipState } from './useHandLandmarker';

// Mouse click-and-drag input mirroring the fingertip array produced by
// useHandLandmarker. Single entry with id 'mouse' when the button is
// pressed, empty array otherwise.
export function useMouseInput(enabled: boolean) {
  const fingertipsRef = useRef<FingertipState[]>([]);
  const stateRef = useRef<FingertipState>({
    id: 'mouse',
    x: 0.5,
    y: 0.5,
    vx: 0,
    vy: 0,
    prevX: 0.5,
    prevY: 0.5,
    tPrev: 0,
  });

  useEffect(() => {
    if (!enabled) {
      fingertipsRef.current = [];
      return;
    }
    let down = false;

    const isUi = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      return Boolean(el.closest('.panels') || el.closest('.mode-toggle'));
    };

    const onDown = (e: MouseEvent) => {
      if (isUi(e.target)) return;
      down = true;
      const s = stateRef.current;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      s.x = x;
      s.y = y;
      s.prevX = x;
      s.prevY = y;
      s.vx = 0;
      s.vy = 0;
      s.tPrev = performance.now();
      fingertipsRef.current = [s];
    };

    const onMove = (e: MouseEvent) => {
      if (!down) return;
      const s = stateRef.current;
      const now = performance.now();
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      const dt =
        s.tPrev > 0 ? Math.max((now - s.tPrev) / 1000, 1e-3) : 1 / 60;
      s.prevX = s.x;
      s.prevY = s.y;
      s.vx = (x - s.x) / dt;
      s.vy = (y - s.y) / dt;
      s.x = x;
      s.y = y;
      s.tPrev = now;
    };

    const onUp = () => {
      down = false;
      fingertipsRef.current = [];
    };

    window.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mouseleave', onUp);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mouseleave', onUp);
    };
  }, [enabled]);

  return { fingertipsRef };
}
