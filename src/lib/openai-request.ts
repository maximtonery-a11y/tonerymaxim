export type OpenAiFailureStatus='authentication_failed'|'permission_denied'|'model_unavailable'|'quota_exceeded'|'credit_balance_exhausted'|'organization_usage_limit_exceeded'|'organization_spend_limit_exceeded'|'project_spend_limit_exceeded'|'rate_limited'|'provider_limited'|'request_rejected'|'provider_unavailable';
type Failure={status:OpenAiFailureStatus;retryAfterSeconds?:number};
type Result={response:Response;failure:null}|{response:null;failure:Failure};
// Only provider status and a deadline are shared. Never cache a customer's
// message or model answer. The key stays in server memory and is not emitted.
let cooldown:{key:string;until:number;status:OpenAiFailureStatus;attempts:number}|null=null;
const billingCodes=new Set(['credit_balance_exhausted','organization_usage_limit_exceeded','organization_spend_limit_exceeded','project_spend_limit_exceeded']);

function limitedStatus(payload:any):OpenAiFailureStatus{
  const code=payload?.error?.code,type=payload?.error?.type;
  if(billingCodes.has(code))return code as OpenAiFailureStatus;
  if(code==='insufficient_quota'||code==='billing_hard_limit_reached'||type==='insufficient_quota')return 'quota_exceeded';
  if(code==='rate_limit_exceeded'||code==='slow_down'||type==='rate_limit_error')return 'rate_limited';
  return 'provider_limited';
}
function delayMs(value:string|null,attempts:number){
  const seconds=value===null?NaN:Number(value);
  if(Number.isFinite(seconds)&&seconds>0)return Math.ceil(seconds*1000);
  const date=value===null?NaN:Date.parse(value);
  if(Number.isFinite(date)&&date>Date.now())return date-Date.now();
  return Math.min(300000,30000*2**Math.min(attempts-1,4))+Math.floor(Math.random()*1000);
}

/** One attempt only. Both conversation interpretation and prose fallback
 * respect the same upstream Retry-After instead of retrying each other. */
export async function requestOpenAi(options:{apiKey:string;body:string;signal:AbortSignal}):Promise<Result>{
  if(cooldown?.key===options.apiKey&&cooldown.until>Date.now())return {response:null,failure:{status:cooldown.status,retryAfterSeconds:Math.ceil((cooldown.until-Date.now())/1000)}};
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json'},body:options.body,signal:options.signal});
  if(response.ok){if(cooldown?.key===options.apiKey&&cooldown.until<=Date.now())cooldown=null;return {response,failure:null};}
  if(response.status===429){
    const status=limitedStatus(await response.json().catch(()=>null));
    const attempts=cooldown?.key===options.apiKey?cooldown.attempts+1:1;
    const delay=delayMs(response.headers.get('retry-after'),attempts);
    cooldown={key:options.apiKey,until:Date.now()+delay,status,attempts};
    return {response:null,failure:{status,retryAfterSeconds:Math.ceil(delay/1000)}};
  }
  const status=response.status===401?'authentication_failed':response.status===403?'permission_denied':response.status===404?'model_unavailable':response.status>=500?'provider_unavailable':'request_rejected';
  return {response:null,failure:{status}};
}
