# TM Ads Export v1

Doplnené sú iba nové exportné endpointy. Existujúce stránky, košík, pokladňa, GoPay, účet ani synchronizácia produktov sa nemenia.

## Endpointy

- `/api/ads-products.json` – detailný JSON zoznam kompatibilných tonerov a atramentových náplní, predvolene iba skladom.
- `/api/ads-products.json?include_out_of_stock=1` – vrátane vypredaných produktov.
- `/api/dsa-page-feed.csv` – DSA page feed pre Google Ads, iba kompatibilné tonery a náplne skladom.

## Zdroj údajov

Endpointy používajú rovnakú lokálnu Astro produktovú cache ako aktuálny e-shop. Nevytvárajú nové spojenie na WooCommerce a nemenia synchronizáciu.

## Nasadenie

Skopírujte nové súbory do projektu so zachovaním priečinkov a spustite bežný deployment.
