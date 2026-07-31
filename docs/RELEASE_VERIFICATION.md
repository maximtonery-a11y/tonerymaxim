# Výsledok kontroly zdrojového projektu

Dátum kontroly: 31. júl 2026

Kontrolovaný bol výhradne projekt z poslednej dodanej zálohy
`tonerymaxim-backup(2).zip`. Opravy boli aplikované nad pôvodným projektom;
produktový katalóg ani e-shop neboli vytvorené nanovo.

## Výsledok

- 47 automatizovaných testov prešlo.
- Testy vyhľadávania HP 650, 652, 652XL, 655 a HP M652 prešli.
- Pevný limit 7 000 produktov bol odstránený. Úplnosť cache sa kontroluje voči
  skutočnému počtu produktov hlásenému WooCommerce.
- Premenné nastavené za behu v Coolify majú prednosť pred lokálnymi hodnotami,
  ktoré boli prítomné pri builde.
- SEO, sitemap, Merchant feed, produktové identifikátory a GEO landing pages
  prešli zdrojovými testami.
- Migračná logika 301/404/410, ochrana pred 302 fallbackom a samotný Migration
  Gate prešli integračnými testami.
- Produkčný Astro build prešiel na Node.js 22.
- `npm audit --omit=dev` našiel 0 zraniteľností.
- Produkčný HTTP test s 120-produktovým katalógom overil `/api/readiness`,
  produktové API, HP 652 vyhľadávanie, tlačiarne, zoznam produktov, detail
  produktu, Merchant feed, robots.txt a sitemap index.
- `.env`, cache, build, závislosti a migračné reporty sú ignorované Gitom a
  nie sú súčasťou distribučného ZIP-u.

## Čo musí byť overené až po nasadení

Skutočný lokálny katalóg z vašich WooCommerce údajov overí
`OVERIT_LOKALNY_KATALOG.bat`. Bez bežiaceho Coolify prostredia nemožno pravdivo
potvrdiť SMTP, GoPay, SSL, DNS ani skutočné HTTP odpovede všetkých starých URL.
Túto poslednú kontrolu vykonáva `OVERIT_NASADENIE_INFO.bat` na `.info` ešte pred
zmenou DNS a `OVERIT_PO_PREPNUTI_DNS_SK.bat` po prepnutí.

Za schválenie nasadenia sa považuje iba finálne hlásenie:

```text
TECHNICKÉ NASADENIE JE OVERENÉ.
```
