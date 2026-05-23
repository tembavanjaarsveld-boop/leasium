"use client";

import { useEffect, useState } from "react";

/**
 * useUnmountDelay — keep a component mounted long enough for its exit
 * animation to play, then unmount.
 *
 * Usage pattern:
 *
 *   const { shouldRender, isClosing } = useUnmountDelay(open, 200);
 *   if (!shouldRender) return null;
 *   return (
 *     <div className={cn(
 *       "...",
 *       isClosing
 *         ? "animate-leasium-drawer-out-right"
 *         : "animate-leasium-drawer-in-right",
 *     )} />
 *   );
 *
 * `open` is the consumer's source-of-truth visibility flag. When it
 * flips from true to false, this hook keeps `shouldRender` true for
 * `delayMs` so the exit keyframe has time to play, then unmounts.
 *
 * `isClosing` is `shouldRender && !open` — true exactly during the
 * exit-animation window. Consumers branch on it to swap the enter
 * class for the matching exit class.
 *
 * Delay should match the Codex motion duration of the exit animation
 * applied to the element. For drawers / modals on the Base 200ms scale
 * pass 200; for Slow 300ms drawers pass 300. Per Codex SoT §5,
 * exits can be ~75% of enter, but matching the duration is the
 * simplest correct default.
 *
 * The `prefers-reduced-motion` global rule in globals.css collapses
 * the actual animation to 0.01ms; the delay still fires but the
 * visual is instant. Keep the delay number aligned with the motion
 * token so unmount timing stays consistent across both states.
 */
export function useUnmountDelay(
  open: boolean,
  delayMs: number,
): { shouldRender: boolean; isClosing: boolean } {
  const [shouldRender, setShouldRender] = useState(open);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      return undefined;
    }
    const timeout = setTimeout(() => setShouldRender(false), delayMs);
    return () => clearTimeout(timeout);
  }, [open, delayMs]);

  return {
    shouldRender,
    isClosing: shouldRender && !open,
  };
}
