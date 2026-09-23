/** Naplánuje iba najskorší požadovaný termín a nespustí tú istú úlohu dvakrát. */
export function createEarliestTask(run: () => Promise<void>, onError: (error: unknown) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = Infinity;

  return (delayMs = 0) => {
    const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    const nextDueAt = Date.now() + delay;
    if (timer && nextDueAt >= dueAt) return;
    if (timer) clearTimeout(timer);

    dueAt = nextDueAt;
    timer = setTimeout(() => {
      timer = undefined;
      dueAt = Infinity;
      void run().catch(onError);
    }, delay);

    if (typeof timer.unref === "function") timer.unref();
  };
}
