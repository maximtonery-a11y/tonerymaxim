let starting: Promise<void> | undefined;

/**
 * Načíta objednávkový worker až po prvej HTTP požiadavke a nikdy naň nečaká
 * pri odpovedi. Po neúspešnom importe dovolí ďalšej požiadavke nový pokus.
 */
export function startOrderWorker(): void {
  if (process.env.TM_DISABLE_BACKGROUND_WORKERS === "1" || starting) return;

  starting = import("./async-order-queue")
    .then(({ ensureAsyncOrderQueueStarted }) => {
      ensureAsyncOrderQueueStarted();
    })
    .catch((error) => {
      starting = undefined;
      console.error("[TM async order queue] startup failed", error instanceof Error ? error.message : error);
    });
}
