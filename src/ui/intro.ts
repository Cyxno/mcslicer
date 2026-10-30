/**
 * Intro-overlay flag logic (pure; the DOM wiring lives in main.ts).
 *
 * The intro shows on first visit only. The flag lives in localStorage and
 * must never break the app: private-mode Safari and hardened profiles throw
 * on setItem/getItem — that only means the intro returns on the next visit.
 */

export const INTRO_SEEN_FLAG = 'mcslicer-intro-seen';

/** Minimal storage surface (localStorage or a test double). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** True when the visitor dismissed the intro before. */
export function introSeen(store: KeyValueStore): boolean {
  try {
    return store.getItem(INTRO_SEEN_FLAG) === '1';
  } catch {
    return false; // unreadable storage counts as "never seen"
  }
}

/** Record the dismissal; a failing store is silently ignored by design. */
export function markIntroSeen(store: KeyValueStore): void {
  try {
    store.setItem(INTRO_SEEN_FLAG, '1');
  } catch {
    // storage unavailable (private mode): intro just shows again next visit
  }
}

/** Keys that dismiss the intro (Esc); buttons handle Enter/Space natively. */
export function isIntroDismissKey(key: string): boolean {
  return key === 'Escape';
}
