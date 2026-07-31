export function breadcrumbs(entity:any){
 return [
  {name:'Domov',url:'/'},
  {name:entity.brand||'Značka',url:`/znacky/${entity.brandSlug||''}`},
  {name:entity.name,url:''}
 ];
}
