export async function getPrinterModel(slug:string){
 return {
  slug,
  name: slug.replace(/-/g,' ').toUpperCase(),
  metaDescription:'Kompatibilné a originálne tonery pre model tlačiarne.',
  aiSummary:'Pre tento model odporúčame kompatibilné aj originálne tonery podľa požiadaviek na cenu a výťažnosť.',
  oems:[]
 };
}
