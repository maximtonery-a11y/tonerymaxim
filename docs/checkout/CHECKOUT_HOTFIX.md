# Checkout hotfix

Oprava chyby na `/pokladna`:

- problém bol v `src/pages/pokladna.astro`
- Astro `define:vars` malo nesprávny zápis
- pôvodne: `<script define:vars={ checkoutCustomer }>`
- opravené: `<script define:vars={{ checkoutCustomer }}>`

Build po oprave prešiel úspešne.

Výkonové úpravy produktov zostali zachované, checkout výpočty, kupóny, body a objednávkový JS neboli menené.
