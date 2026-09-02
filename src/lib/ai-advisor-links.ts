export type AiAdvisorLink = { label: string; url: string };

// Odkazy sú zámerne vyberané iba z pevného zoznamu interných stránok.
// Text zákazníka ani odpoveď modelu nikdy neurčujú cieľovú URL.
export function advisorLinks(advisor: { intent?: unknown; faq?: unknown; sources?: unknown } | null | undefined): AiAdvisorLink[] {
  const intent = String(advisor?.intent || '');
  const faq = String(advisor?.faq || '');

  if (intent === 'calendar_overview' && Array.isArray(advisor?.sources)) {
    return (advisor.sources as any[]).filter((source) =>
      source && typeof source.label === 'string' && String(source.url || '') === '/kalendare/'
    ).slice(0, 1).map((source) => ({ label: source.label, url: source.url }));
  }

  if (intent === 'calendar_diary_overview' && Array.isArray(advisor?.sources)) {
    const allowed = new Set([
      '/kalendare/#/?cat=Di%C3%A1re&sub=daily',
      '/kalendare/#/?cat=Di%C3%A1re&sub=weekly',
      '/kalendare/#/?cat=Di%C3%A1re&sub=monthly',
      '/kalendare/#/?cat=Di%C3%A1re&sub=mini',
    ]);
    return (advisor.sources as any[])
      .filter((source) => source && typeof source.label === 'string' && allowed.has(String(source.url || '')))
      .slice(0, 4)
      .map((source) => ({ label: source.label, url: source.url }));
  }

  // Kalendárová odpoveď nesmie nikdy spadnúť na tonerovú poradňu.
  // Produkty majú vlastné, katalógom dodané URL; tento odkaz je iba bezpečný
  // vstup do celej ponuky.
  if (intent === 'calendar_search' && faq === 'calendar-diary-overview') return [
    { label: 'Zobraziť všetky diáre', url: '/kalendare/#/?cat=Di%C3%A1re' },
  ];
  if (intent === 'calendar_search') return [
    { label: 'Celá ponuka kalendárov a diárov', url: '/kalendare/' },
  ];

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
