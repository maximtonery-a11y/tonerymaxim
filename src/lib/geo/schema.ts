export function breadcrumbSchema(items:any[]){
 return {
  '@context':'https://schema.org',
  '@type':'BreadcrumbList',
  itemListElement:items.map((i,idx)=>({
   '@type':'ListItem',
   position:idx+1,
   name:i.name,
   item:i.url
  }))
 }
}
export function itemListSchema(urls:string[]){
 return {
  '@context':'https://schema.org',
  '@type':'ItemList',
  itemListElement:urls.map((u,i)=>({'@type':'ListItem',position:i+1,url:u}))
 }
}
