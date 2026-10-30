/** Temporary owner import authorization: synthetic records and isolated in-memory D1 only. */
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {env} from './worker-env';
import {testDatabase} from './d1';
const auth=vi.hoisted(()=>({user:null as null|{userId:string;email:string;displayName:string;fullName:null}}));
vi.mock('../app/chatgpt-auth',()=>({getChatGPTUser:async()=>auth.user}));
vi.mock('../lib/server/market',()=>({eventPrice:vi.fn(async()=>100),latestQuote:vi.fn(async(symbol:string)=>({symbol,price:100,status:'fresh'})),parallelMap:async<T,R>(items:T[],fn:(i:T)=>Promise<R>)=>Promise.all(items.map(fn))}));
import {importOwnerPayload as POST} from '../lib/server/owner-import';
import {mutate,validateBackup} from '../lib/server/service';
import {readLedger,listBackups} from '../lib/server/store';
import {replay,summarize,emptyLedger} from '../lib/ledger/engine';
const key='synthetic-ephemeral-key-not-a-production-credential';
const backup=()=>({version:1,partners:[{id:'a',name:'A'}],entries:[{id:'d',type:'DEPOSIT',tradeDate:'2026-01-01',grossAmount:1234,partnerId:'a'}]});
const body=()=>JSON.stringify({revision:1,backup:backup()});
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function request(text=body(),secret=key){return new Request('https://ledger.test/api/owner-import',{method:'POST',headers:{'content-type':'application/json','x-ledger-import-key':secret},body:text});}
async function authorize(text=body()){env.OWNER_IMPORT_USER_ID='owner';env.OWNER_IMPORT_KEY_HASH=await hash(key);env.OWNER_IMPORT_PAYLOAD_HASH=await hash(text);env.OWNER_IMPORT_EXPIRES_AT=new Date(Date.now()+600000).toISOString();}
beforeEach(async()=>{env.DB=testDatabase();delete env.OWNER_IMPORT_USER_ID;delete env.OWNER_IMPORT_KEY_HASH;delete env.OWNER_IMPORT_PAYLOAD_HASH;delete env.OWNER_IMPORT_EXPIRES_AT;auth.user=null;await mutate('owner',{action:'partner',revision:0,key:'initialize',id:'self',name:'Owner'});});
describe('payload-pinned owner service import',()=>{
 it('is disabled without temporary runtime authorization',async()=>{expect((await POST(request())).status).toBe(401);expect((await readLedger('owner')).revision).toBe(1);});
 it('rejects missing/wrong credentials and an expired or overlong authorization window',async()=>{
  await authorize();expect((await POST(request(body(),'wrong'))).status).toBe(401);
  env.OWNER_IMPORT_EXPIRES_AT=new Date(Date.now()-1000).toISOString();expect((await POST(request())).status).toBe(401);
  env.OWNER_IMPORT_EXPIRES_AT=new Date(Date.now()+7200000).toISOString();expect((await POST(request())).status).toBe(401);
 });
 it('rejects a different exact payload, cross-origin request or another authenticated user',async()=>{
  await authorize();expect((await POST(request(body()+' '))).status).toBe(422);
  const cross=request();cross.headers.set('origin','https://other.test');expect((await POST(cross)).status).toBe(401);
  auth.user={userId:'other',email:'other@example.test',displayName:'Other',fullName:null};expect((await POST(request())).status).toBe(401);
  expect((await readLedger('other')).revision).toBe(0);
 });
 it('backs up and atomically writes the exact owner record, retries without duplication, and stops after config removal',async()=>{
  await authorize();const response=await POST(request());expect(response.status).toBe(200);expect((await response.json() as {revision:number}).revision).toBe(2);
  const saved=await readLedger('owner');expect(saved.ledger.entries).toHaveLength(1);expect(saved.ledger.entries[0].grossAmount).toBe(1234);expect((await listBackups('owner')).some(b=>b.revision===1)).toBe(true);
  expect((await POST(request())).status).toBe(200);expect((await readLedger('owner')).revision).toBe(2);
  delete env.OWNER_IMPORT_KEY_HASH;expect((await POST(request())).status).toBe(401);
 });
 it('cannot target an uninitialized user, overwrite a newer revision, or partially apply invalid data',async()=>{
  await authorize();env.OWNER_IMPORT_USER_ID='missing';expect((await POST(request())).status).toBe(409);expect((await readLedger('missing')).revision).toBe(0);
  env.OWNER_IMPORT_USER_ID='owner';const invalid=JSON.stringify({revision:1,backup:{...backup(),entries:[...backup().entries,{id:'bad',type:'SELL',tradeDate:'2026-01-02',symbol:'TEST',quantity:10,grossAmount:100}]}});await authorize(invalid);expect((await POST(request(invalid))).status).toBe(422);expect((await readLedger('owner')).revision).toBe(1);
  const stale=JSON.stringify({revision:0,backup:backup()});await authorize(stale);expect((await POST(request(stale))).status).toBe(409);
 });
});
describe('disclosed estimated reconstruction',()=>{
 it('retains unfunded early activity without creating deposits and preserves the owner assumption',async()=>{
  const input={version:1,partners:[{id:'a',name:'A'},{id:'b',name:'B'}],cashPolicy:'reconstruction',reconciliation:{estimated:true,openingOwnerId:'a',notes:['Synthetic missing opening cash; owner assumption disclosed.'],cashVerified:false,asOf:'2026-10-29'},entries:[{id:'old','type':'BUY',tradeDate:'2018-01-01',symbol:'TEST',quantity:1,grossAmount:10},{id:'sell','type':'SELL',tradeDate:'2019-01-01',symbol:'TEST',quantity:1,grossAmount:5},{id:'d',type:'DEPOSIT',tradeDate:'2020-01-01',grossAmount:1000,partnerId:'a'}]};
  const saved=await validateBackup(input);const state=summarize(saved,{});expect(state.cash).toBe(995);expect(state.netDeposits).toBe(1000);expect(saved.entries.filter(e=>e.type==='DEPOSIT')).toHaveLength(1);expect(state.partners[0].value).toBe(995);expect(saved.reconciliation?.cashVerified).toBe(false);
  await expect(validateBackup({...input,entries:[...input.entries.slice(0,2),{...input.entries[2],partnerId:'b'}]})).rejects.toThrow('opening-owner');
  await expect(validateBackup({...input,reconciliation:undefined})).rejects.toThrow('requires explicit');
 });
 it('records a noncash reward once with unknown basis and no extra cash or units',()=>{
  const l=replay({...emptyLedger(),entries:[{id:'d',type:'DEPOSIT',tradeDate:'2026-01-01',grossAmount:100,partnerId:'self',allocations:[]},{id:'r',type:'REWARD',tradeDate:'2026-01-02',grossAmount:0,symbol:'USDC',quantity:1,basisUnknown:true,allocations:[]}]});
  const state=summarize(l,{USDC:{symbol:'USDC',price:1,status:'fresh',marketTime:null,fetchedAt:null}});expect(state.cash).toBe(100);expect(state.units).toBe(100);expect(state.totalValue).toBe(101);expect(state.holdings[0].costBasis).toBeNull();expect(state.holdings[0].gain).toBeNull();
 });
});
