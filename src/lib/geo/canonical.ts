export function canonicalUrl(path:string, base='https://www.tonerymaxim.sk'){
 return `${base}${path.startsWith('/')?'':'/'}${path}`;
}
export function alternateLanguages(path:string){
 return [{lang:'sk',url:canonicalUrl(path)}];
}
