export function generateSeoContent(entity:any){
 return {
  aiSummary:`Model ${entity.name} používa OEM ${entity.oem||''}. Vyberte kompatibilné alebo originálne tonery podľa požadovanej výťažnosti.`,
  intro:`Pre ${entity.name} ponúkame kompatibilné, originálne aj renovované náplne.`,
  faq:[
   {q:'Aký toner potrebujem?',a:`Použite OEM ${entity.oem||''}.`},
   {q:'Sú kompatibilné tonery bezpečné?',a:'Áno, pri overenom výrobcovi.'}
  ]
 };
}
