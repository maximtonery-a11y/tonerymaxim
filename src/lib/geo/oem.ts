export function getOemEntity(code:string){
 return {
   code:code.toUpperCase(),
   description:`Kompatibilné a originálne tonery pre ${code.toUpperCase()}.`,
   printers:[],
   products:[],
   faq:[]
 }
}
