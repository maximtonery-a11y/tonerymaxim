export function faqSchema(faq:any[]){
 return {
  '@context':'https://schema.org',
  '@type':'FAQPage',
  mainEntity:faq.map(f=>({
   '@type':'Question',
   name:f.q,
   acceptedAnswer:{'@type':'Answer',text:f.a}
  }))
 };
}
