/** Shared API authentication, same-origin mutation policy and safe error responses. */
import { ZodError } from 'zod';
import { getChatGPTUser, type ChatGPTUser } from '../../app/chatgpt-auth';
import { ConflictError } from './store';
import { LedgerError } from '../ledger/engine';
/** Authenticate before accessing data; reject cross-origin writes and non-JSON mutation bodies. */
export async function protect(request:Request,action:(user:ChatGPTUser)=>Promise<Response>):Promise<Response> {
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:'Sign in with ChatGPT to access your ledger.'},{status:401,headers:{'Cache-Control':'no-store'}});
  if(!['GET','HEAD'].includes(request.method)) {
    const origin=request.headers.get('origin');
    if((origin && origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Cross-site writes are not allowed.'},{status:403});
    if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Send an application/json request.'},{status:415});
  }
  try { const response=await action(user);response.headers.set('Cache-Control','no-store');return response; }
  catch(error) {
    const status=error instanceof ConflictError?409:error instanceof ZodError?400:error instanceof LedgerError?422:500;
    const message=error instanceof ZodError?error.issues.map(i=>i.message).join(' '):status<500 && error instanceof Error?error.message:'The request could not be completed. Your saved ledger has not been replaced. Please try again.';
    if(status===500)console.error('Ledger request failed',error instanceof Error?error.message:'Unknown error');
    return Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
  }
}
/** Bound parsed input sizes before validation; return a useful client error for malformed JSON. */
export async function jsonBody(request:Request):Promise<unknown> {
  const text=await request.text();if(text.length>1_500_000)throw new LedgerError('Request is too large. Import at most 2,000 rows per batch.');
  try{return JSON.parse(text);}catch{throw new LedgerError('Invalid JSON. Reload and try again.');}
}
