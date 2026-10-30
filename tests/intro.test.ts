import { describe, expect, it } from 'vitest';
import {
  INTRO_SEEN_FLAG,
  introSeen,
  isIntroDismissKey,
  markIntroSeen,
  type KeyValueStore,
} from '../src/ui/intro.js';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { throws: boolean } {
  const map = new Map(Object.entries(initial));
  const store = {
    throws: false,
    getItem(key: string): string | null {
      if (store.throws) throw new Error('storage blocked');
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (store.throws) throw new Error('storage blocked');
      map.set(key, value);
    },
  };
  return store;
}

describe('intro flag', () => {
  it('is unseen when the flag is absent', () => {
    expect(introSeen(memoryStore())).toBe(false);
  });

  it('is unseen when the flag holds another value', () => {
    expect(introSeen(memoryStore({ [INTRO_SEEN_FLAG]: '0' }))).toBe(false);
  });

  it('is seen after markIntroSeen', () => {
    const store = memoryStore();
    markIntroSeen(store);
    expect(store.getItem(INTRO_SEEN_FLAG)).toBe('1');
    expect(introSeen(store)).toBe(true);
  });

  it('treats an unreadable store as never seen', () => {
    const store = memoryStore();
    store.throws = true;
    expect(introSeen(store)).toBe(false);
  });

  it('never throws when the store rejects writes (private mode)', () => {
    const store = memoryStore();
    store.throws = true;
    expect(() => markIntroSeen(store)).not.toThrow();
  });

  it('dismisses on Escape only', () => {
    expect(isIntroDismissKey('Escape')).toBe(true);
    expect(isIntroDismissKey('Tab')).toBe(false);
    expect(isIntroDismissKey('Enter')).toBe(false);
  });
});
