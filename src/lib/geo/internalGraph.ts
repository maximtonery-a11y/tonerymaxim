export function buildInternalGraph(entity:any){
 return {
   printers:entity.printers??[],
   products:entity.products??[],
   relatedOem:entity.relatedOem??[],
   categories:entity.categories??[]
 };
}
