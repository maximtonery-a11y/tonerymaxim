export type AiAdvisorLink = { label: string; url: string };

// Odkazy sú zámerne vyberané iba z pevného zoznamu interných stránok.
// Text zákazníka ani odpoveď modelu nikdy neurčujú cieľovú URL.
export function advisorLinks(advisor: { intent?: unknown; faq?: unknown } | null | undefined): AiAdvisorLink[] {
  const intent = String(advisor?.intent || '');
  const faq = String(advisor?.faq || '');

  if (faq === 'ucet-heslo') return [
    { label: 'Obnoviť heslo', url: '/zabudnute-heslo' },
    { label: 'Prejsť na prihlásenie', url: '/prihlasenie' },
  ];
  if (faq === 'ucet-profil-heslo') return [{ label: 'Otvoriť profil a heslo', url: '/ucet/profil' }];
  if (faq === 'ucet-funkcie') return [{ label: 'Otvoriť zákaznícky účet', url: '/ucet' }];
  if (faq === 'registracia-zlava' || faq === 'registracia-co-uklada') return [
    { label: 'Vytvoriť účet', url: '/registracia' },
    { label: 'Výhody registrácie', url: '/vyhody-registracie' },
  ];
  if (intent === 'account') return [
    { label: 'Prihlásenie', url: '/prihlasenie' },
    { label: 'Registrácia', url: '/registracia' },
  ];

  if (faq === 'objednavka-konkretny-stav') return [
    { label: 'Moje objednávky', url: '/ucet/objednavky' },
    { label: 'Kontaktovať nás', url: '/kontakt' },
  ];
  if (faq === 'storno-objednavky') return [{ label: 'Kontaktovať nás', url: '/kontakt' }];
  if (intent === 'order') return [{ label: 'Doprava a doručenie', url: '/doprava-a-platba' }];

  if (['vratenie-tovaru', 'odstupenie-vratenie-penazi'].includes(faq)) return [
    { label: 'Odstúpenie od zmluvy', url: '/odstupenie-od-zmluvy' },
    { label: 'Reklamácie a vrátenie', url: '/reklamacie' },
  ];
  if (intent === 'claim') return [
    { label: 'Online reklamácia', url: '/reklamacia-online' },
    { label: 'Reklamácie a vrátenie', url: '/reklamacie' },
  ];

  if (intent === 'shipping' || intent === 'payment' || /doprava|platba/.test(faq)) {
    return [{ label: 'Doprava a platba', url: '/doprava-a-platba' }];
  }
  if (intent === 'loyalty' || /vernost/.test(faq)) return [
    { label: 'Vernostný program', url: '/vernostny-program' },
    { label: 'Moje odmeny', url: '/ucet/odmeny' },
  ];

  if (faq === 'obchodne-podmienky') return [{ label: 'Obchodné podmienky', url: '/obchodne-podmienky' }];
  if (faq === 'cookies-nastavenie') return [{ label: 'Cookies', url: '/cookies' }];
  if (faq === 'predavajuci-firma') return [{ label: 'O nás', url: '/o-nas' }];
  if (intent === 'legal') return [{ label: 'Ochrana osobných údajov', url: '/ochrana-osobnych-udajov' }];
  if (intent === 'contact' || faq === 'kontakt') return [{ label: 'Kontakt', url: '/kontakt' }];
  if (faq === 'recyklacia-tonerov') return [{ label: 'Spätný odber tonerov', url: '/spatny-odber-tonerov' }];
  if (intent === 'support' || intent === 'diagnostic' || intent === 'compatibility') {
    return [{ label: 'Odborná poradňa', url: '/poradna' }];
  }
  return [];
}
