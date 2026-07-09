# TM Async Order Queue v1

Cieľ: zákazník pri dobierke, prevode vopred a faktúre nečaká na pomalé WooCommerce vytvorenie objednávky.

Zmena:
- `/api/order-create` po validácii uloží objednávku do `.tm-cache/async-orders/pending`.
- Odpoveď zákazníkovi sa vráti okamžite so stavom `queued: true` a HTTP 202.
- WooCommerce objednávka sa vytvorí na pozadí.
- Ak Woo zlyhá, úloha zostane vo fronte a skúsi sa opakovane spracovať.

Bezpečnostná brzda:
- Ak chceš dočasne vypnúť async režim, nastav v Coolify:
  `TM_ASYNC_WOO_ORDERS=0`
- Potom sa `/api/order-create` vráti k pôvodnému synchronnému vytváraniu Woo objednávky.

Dôležité:
- Online platby GoPay / Apple Pay / Google Pay táto úprava nemení.
- Táto verzia zrýchľuje hlavne platby: dobierka, prevod vopred, faktúra pre firmu.
- Build prešiel úspešne.
