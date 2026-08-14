export const EXPERT_NAME = "Roman Babčan";
export const EXPERT_PATH = "/autor/roman-babcan";
export const EXPERT_ROLE = "Odborný poradca pre tonery a tlačiarne";
export const EXPERT_EXPERIENCE = "17+ rokov skúseností";

export function expertPersonJsonLd(origin = "https://www.tonerymaxim.sk") {
  const url = new URL(EXPERT_PATH, origin).toString();
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${url}#person`,
    name: EXPERT_NAME,
    url,
    jobTitle: EXPERT_ROLE,
    description: "Odborný garant obsahu ToneryMaxim.sk so skúsenosťami s výberom tonerov, OEM označeniami a kompatibilitou tlačiarní.",
    knowsAbout: [
      "tonery do tlačiarní",
      "OEM označenia kaziet",
      "kompatibilita tonerov a tlačiarní",
      "atramentové náplne",
      "optické valce",
    ],
    worksFor: { "@id": `${origin}/#organization` },
  };
}
