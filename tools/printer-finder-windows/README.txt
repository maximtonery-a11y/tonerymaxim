TONERYMAXIM PRINTER FINDER PRE WINDOWS - V4.6
===========================================

ČO ROBÍ
-------
Po vašom kliknutí zistí tlačiarne nainštalované vo Windows. Číta názov
fronty a názov ovládača, takže vie pracovať s USB, Wi-Fi aj sieťovými
tlačiarňami, ak sú vo Windows nainštalované.

INŠTALÁCIA
----------
1. Rozbaľte ZIP do priečinka.
2. Spustite INSTALOVAT.cmd.
3. Administrátorské práva nie sú potrebné.
4. Inštalátor najprv urobí self-test čítania tlačiarní.
5. Po úspechu sa otvorí testovacia stránka ToneryMaxim.

SÚKROMIE A BEZPEČNOSŤ
---------------------
- Pomocník nebeží ako služba na pozadí.
- Spustí sa iba po kliknutí na ToneryMaxim.
- Neotvára localhost ani iný lokálny sieťový port.
- Názvy tlačiarní sa nikdy nevkladajú do URL ani histórie prehliadača.
- Pomocník ich pošle cez HTTPS iba na tonerymaxim.sk alebo tonerymaxim.info.
- Pred čítaním tlačiarní helper najprv bez údajov overí krátkodobý jednorazový token vytvorený webom.
- Až po úspešnom overení číta a odosiela názov tlačovej fronty a ovládača.
- Server drží výsledok relácie iba krátko v pamäti; nepíše ho do súboru.
- Virtuálne tlačiarne typu Microsoft Print to PDF/Fax sa ignorujú.
- ToneryMaxim automaticky prijme iba konzervatívnu jednoznačnú zhodu.

ODINŠTALÁCIA
------------
Spustite ODINSTALOVAT.cmd.
