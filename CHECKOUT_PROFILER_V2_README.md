# Checkout Profiler v2

Súbory na výmenu:
- `src/lib/checkout-profiler.ts`
- `src/pages/admin/performance.astro`

Použitie:
1. Nahrať súbory.
2. Deploy/reštart.
3. Odoslať testovaciu objednávku.
4. Otvoriť `/admin/performance`.

Ak máš nastavený `TM_ANALYTICS_ADMIN_KEY` alebo `ADMIN_API_SECRET`, otvor:
`/admin/performance?key=TVOR_KLUC`

Profiler ukladá posledných 200 meraní do `.tm-cache/checkout-profiler.json`.
