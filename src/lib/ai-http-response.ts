class AiResponseError extends Error {}
const unavailable='Teraz sa mi nepodarilo načítať odpoveď. Skúste otázku odoslať znova.';

/** Proxies can return plain text or HTML instead of our JSON envelope. */
export async function readAiJson(response:Response){
  if(response.status>=500)throw new AiResponseError(unavailable);
  if(response.status===429)throw new AiResponseError('Prosím, chvíľu počkajte a skúste otázku odoslať znova.');
  const data=await response.json().catch(()=>{throw new AiResponseError(unavailable);});
  if(!data||typeof data!=='object'||Array.isArray(data))throw new AiResponseError(unavailable);
  return data;
}
export function aiRequestErrorMessage(error:unknown,fallback=unavailable){
  return error instanceof AiResponseError?error.message:fallback;
}
