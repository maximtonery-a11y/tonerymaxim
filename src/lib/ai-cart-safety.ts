const normalize = (value: unknown) => String(value || '')
  .toLocaleLowerCase('sk-SK')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * A negative cart instruction always wins over a buying verb in the same
 * message. Keep this predicate shared by the router, API and browser client.
 */
export function forbidsCartMutation(value: unknown) {
  const text = normalize(value);
  // Zachytávame rozkazovací spôsob, neurčitok aj zdvorilé množné číslo:
  // „nepridávaj“, „nepridať“, „nepridávajte“, „nevložil“, „nedali“.
  const negativeVerb = /\b(?:nepridav|nepridaj|nepridat|nevklad|nevkladaj|nevloz|nedavaj|nedat|nedal|neobjednav|neobjednaj|neobjednat|nekup|nemen|nezmen|neuprav|nedotyk|nevytvar)\w*\b/;
  const cartTarget = /\b(?:kosik|nakup|objednavk|polozk)\w*\b/;
  const mutationWord = /\b(?:pridav|pridat|pridani|vloz|vklad|vlozeni|dav|dat|objednav|objednat|objednani|kup|nakup|zmen|uprav|manipulaci|vytvor)\w*\b/;
  const explicitNothing = /\b(?:nic|ziadn)\w*\b(?:\s+\w+){0,6}\s+\b(?:nepridav|nepridaj|nepridat|nevklad|nevkladaj|nevloz|nedavaj|nedat|neobjednav|neobjednaj|neobjednat|nekup)\w*\b/;
  const withoutMutation = /\bbez\b(?:\s+\w+){0,8}\s+\b(?:pridav|pridat|pridani|vloz|vklad|vlozeni|zmen|uprav|manipulaci|objednav|objednat|objednani|nakup)\w*\b(?:\s+\w+){0,6}\s+\b(?:kosik|nakup|objednavk)\w*\b/;
  const negativeObject = /\b(?:nepridav|nepridaj|nepridat|nevklad|nevkladaj|nevloz|nedavaj|nedat|nedal|neobjednav|neobjednaj|neobjednat|nekup)\w*\b(?:\s+\w+){0,5}\s+\b(?:ho|ju|ich|to|produkt|toner|napln|sadu|polozk)\w*\b/;
  const doesNotWantMutation = /\bnechcem\b(?:\s+\w+){0,10}\s+\b(?:pridav|pridat|vloz|vklad|dat|dali|objednav|objednat|kup|menit|zmenit|uprav)\w*\b/;
  const keepUnchanged = /\b(?:kosik|nakup|objednavk)\w*\b(?:\s+\w+){0,5}\s+\b(?:ponech|nechaj|nechat)\w*\b(?:\s+\w+){0,3}\s+\bbez\s+zmen\w*\b/;
  const noTouch = /\b(?:kosik|nakup|objednavk)\w*\b(?:\s+\w+){0,4}\s+\bnedotyk\w*\b/;
  const nounBan = /\bziadn\w*\s+(?:pridav|vklad|vloz|zmen|uprav|manipulaci|objednav|nakup)\w*\b(?:\s+\w+){0,6}\s+\b(?:kosik|nakup|objednavk)\w*\b/;
  const explicitBan = /\b(?:zakaz|zakazujem)\w*\b(?:\s+\w+){0,7}\s+\b(?:kosik|nakup|objednavk|pridav|vloz|vklad|zmen|uprav|manipulaci)\w*\b/;
  const informationalOnly = /\b(?:iba|len)\b(?:\s+\w+){0,4}\s+\b(?:informativ|informaci|cenu|porovnat|ukaz|zobraz)\w*\b(?:\s+\w+){0,5}\s+\bbez\s+(?:nakup|objednav)\w*\b/;
  const standaloneNegativeAction = /\b(?:nepridav|nepridaj|nepridat|nevklad|nevkladaj|nevloz|neobjednav|neobjednaj|neobjednat|nekup)\w*\b/;
  const notMutation = /\bnie\b(?:\s+\w+){0,4}\s+\b(?:pridav|vloz|vklad|objednav|kup|zmen|uprav)\w*\b/;
  const doesNotWish = /\bnezelam\s+si\b(?:\s+\w+){0,8}\s+\b(?:pridav|pridat|vloz|vklad|dat|objednav|kup|zmen|uprav)\w*\b/;
  const noCartWork = /\bnic\b(?:\s+\w+){0,4}\s+\b(?:kosik|nakup|objednavk)\w*\b(?:\s+\w+){0,4}\s+\b(?:nerob|nemen|neuprav|nezasah)\w*\b/;
  const passiveUnchanged = /\b(?:kosik|nakup|objednavk)\w*\b(?:\s+\w+){0,5}\s+\b(?:nesmie|nema)\b(?:\s+\w+){0,3}\s+\b(?:zmen|uprav)\w*\b/;
  const leaveAlone = /\b(?:nechaj|ponech)\w*\b(?:\s+\w+){0,5}\s+\b(?:kosik|nakup|objednavk)\w*\b(?:\s+\w+){0,3}\s+\b(?:tak|nedotknut|bez\s+zmen)\w*\b/;
  const noInterference = /\bnezasah\w*\b(?:\s+\w+){0,5}\s+\b(?:kosik|nakup|objednavk)\w*\b/;
  return explicitNothing.test(text)
    || withoutMutation.test(text)
    || negativeObject.test(text)
    || doesNotWantMutation.test(text)
    || keepUnchanged.test(text)
    || noTouch.test(text)
    || nounBan.test(text)
    || explicitBan.test(text)
    || informationalOnly.test(text)
    || standaloneNegativeAction.test(text)
    || notMutation.test(text)
    || doesNotWish.test(text)
    || noCartWork.test(text)
    || passiveUnchanged.test(text)
    || leaveAlone.test(text)
    || noInterference.test(text)
    || (/\bbez\s+(?:nakup|objednav)\w*\b/.test(text) && mutationWord.test(text))
    || (negativeVerb.test(text) && cartTarget.test(text));
}

export function isCartChangingAction(kind: unknown) {
  return ['ADD_TO_CART', 'ADD_BUNDLE_TO_CART', 'OPEN_QUANTITY', 'OPEN_CART', 'OPEN_CHECKOUT']
    .includes(String(kind || ''));
}
