import { useCallback, useEffect, useRef, useState } from 'react';

/** Native fullscreen when available, with a full-viewport focus layout as fallback. */
export function useFocusMode(beforeLayout: () => void) {
  const [active, setActive] = useState(false);
  const current = useRef(false), ownsFullscreen = useRef(false);
  const origin = useRef<{ element: HTMLElement | null; top: number }>({ element: null, top: 0 });
  const restoreFrame = useRef(0);
  const latestBeforeLayout = useRef(beforeLayout); latestBeforeLayout.current = beforeLayout;
  const exit = useCallback(() => {
    latestBeforeLayout.current();
    current.current = false;
    setActive(false);
    if (ownsFullscreen.current && document.fullscreenElement === document.documentElement) {
      ownsFullscreen.current = false;
      void document.exitFullscreen().catch(() => {});
    }
    cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = requestAnimationFrame(() => {
      origin.current.element?.focus({ preventScroll: true });
      window.scrollTo({ top: origin.current.top, behavior: 'instant' });
    });
  }, []);
  const enter = useCallback(() => {
    if (current.current) return;
    latestBeforeLayout.current();
    cancelAnimationFrame(restoreFrame.current);
    origin.current = { element: document.activeElement as HTMLElement | null, top: window.scrollY };
    current.current = true;
    setActive(true);
    if (document.fullscreenEnabled && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      ownsFullscreen.current = true;
      void document.documentElement.requestFullscreen().then(() => {
        // An exit can arrive while the browser is still entering fullscreen.
        if (!current.current && document.fullscreenElement === document.documentElement) {
          ownsFullscreen.current = false;
          void document.exitFullscreen().catch(() => {});
        }
      }).catch(() => { ownsFullscreen.current = false; });
    }
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('editor-focus', active);
    return () => document.documentElement.classList.remove('editor-focus');
  }, [active]);
  useEffect(() => {
    const fullscreen = () => {
      if (ownsFullscreen.current && !document.fullscreenElement) {
        ownsFullscreen.current = false;
        if (current.current) exit();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !current.current || document.querySelector('dialog[open]')) return;
      event.preventDefault(); exit();
    };
    document.addEventListener('fullscreenchange', fullscreen);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('fullscreenchange', fullscreen);
      window.removeEventListener('keydown', key);
      cancelAnimationFrame(restoreFrame.current);
      current.current = false;
      if (ownsFullscreen.current && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {});
    };
  }, [exit]);
  return { active, enter, exit };
}
