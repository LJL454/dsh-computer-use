import { performance } from 'node:perf_hooks';

/** Measure gaps between this plugin's calls, not model inference or host turns.
 * Only idle sessions are retained, in a bounded LRU; overlapping calls have no gap.
 * The clock is monotonic so a system time correction cannot invent a long pause.
 */
export function createCallCadence({ now = () => performance.now(), limit = 100 } = {}) {
  const idle = new Map();
  const active = new Map();
  const capacity = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;
  let disposed = false;
  return {
    begin(sessionId) {
      const key = String(sessionId ?? '');
      if (disposed || key === '') return { observation: {}, finish() {} };
      const at = now();
      const count = active.get(key) ?? 0;
      const previous = idle.get(key);
      const observation = count > 0
        ? { overlappedCall: true }
        : previous === undefined ? {} : { gapBeforeMs: Math.max(0, Math.round(at - previous)) };
      idle.delete(key);
      active.set(key, count + 1);
      let finished = false;
      return {
        observation,
        finish() {
          if (finished || disposed) return;
          finished = true;
          const remaining = (active.get(key) ?? 1) - 1;
          if (remaining > 0) {
            active.set(key, remaining);
            return;
          }
          active.delete(key);
          idle.delete(key);
          idle.set(key, now());
          while (idle.size > capacity) idle.delete(idle.keys().next().value);
        },
      };
    },
    dispose() {
      disposed = true;
      idle.clear();
      active.clear();
    },
  };
}
