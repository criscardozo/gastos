"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A flag that goes up and comes back down on its own — "Copiado", "Guardado",
 * a button held off while a request lands.
 *
 * Three components each did this with a bare `setTimeout(() => set(false))`,
 * which outlives the component: leave the screen inside the window and the
 * timer sets state on something unmounted, and raising it twice let the first
 * timer lower the second one early. Here the timer is owned — cleared on
 * unmount, and replaced rather than stacked when the flag is raised again.
 *
 * `raise(ms)` puts it up for `ms` from now. Raising it while it is up just
 * moves the moment it comes down, which is how a caller holds it for an
 * operation of unknown length: raise with a generous cap, raise again with
 * the real tail when the operation settles.
 */
export function useTransientFlag(): [boolean, (ms: number) => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const raise = useCallback((ms: number) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setOn(false);
    }, ms);
  }, []);
  return [on, raise];
}
