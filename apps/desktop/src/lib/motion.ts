import type { Transition } from "framer-motion";

/**
 * The "AMP Spring System" — one physics vocabulary for the whole app so every surface settles with
 * the same macOS hand. Springs for anything that moves through space (panels, presses, cards); tuned
 * eased tweens only for pure opacity cross-fades (page swaps), where a spring would jitter mid-flight.
 *
 * Reduced motion is handled globally by <MotionConfig reducedMotion="user"> at the app root, which
 * neutralises transform/layout springs (CSS transitions alone can't catch Framer springs).
 */

// Named springs — damping is high enough to "settle without ringing" (macOS, not a trampoline).
export const spring: Record<"panel" | "pop" | "press" | "toast", Transition> = {
  // Big surfaces: sidebar, queue rail, main content, player bar. Calm and weighty.
  panel: { type: "spring", stiffness: 210, damping: 26, mass: 0.9 },
  // Popovers / context menu / volume flyout. Snappier, lighter.
  pop: { type: "spring", stiffness: 360, damping: 28, mass: 0.7 },
  // Press / hover micro-interactions on buttons, transport, cards.
  press: { type: "spring", stiffness: 480, damping: 30, mass: 0.6 },
  // Toast / notice — a touch of overshoot for personality.
  toast: { type: "spring", stiffness: 420, damping: 24, mass: 0.7 }
};

// Pure cross-fades — page swaps. macOS standard ease-in-out, fast.
export const tween: Record<"page" | "quick", Transition> = {
  page: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
  quick: { duration: 0.16, ease: [0.4, 0, 0.2, 1] }
};

/** Slide-in variants for the shell panels (left sidebar, right queue rail, rising elements). */
export const panelVariants = {
  left: { initial: { x: -20, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: -20, opacity: 0 } },
  right: { initial: { x: 20, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: 20, opacity: 0 } },
  rise: { initial: { y: 14, opacity: 0 }, animate: { y: 0, opacity: 1 }, exit: { y: 10, opacity: 0 } }
} as const;

/** macOS "sheet" — stretches in from slightly small at a focal point, instead of sliding. */
export const modalVariants = {
  initial: { opacity: 0, scale: 0.94, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 10 }
} as const;
