/** In-memory D1 integration tests: isolation, atomic writes, retries, revision conflicts and recovery. */
import { beforeEach,describe,it,expect,vi } from 'vitest';
import { env } from './worker-env';
import { testDatabase } from './d1';
const auth=vi.hoisted(()=>({user:null as null|{userId:string;email:string;displayName:string;fullName:null}}));
vi.mock('../app/chatgpt-auth',()=>({getChatGPTUser:async()=>auth.user}));
vi.mock('../lib/server/market',()=>({eventPrice:vi.fn(async()=>200),latestQuote:vi.fn(),history:vi.fn(async()=>[]),cachedHistory:vi.fn(async()=>[]),parallelMap:async<T,R>(items:T[],fn:(i:T)=>Promise<R>)=>Promise.all(items.map(fn))}));
import { mutate,validateBackup } from '../lib/server/service';
import { readLedger,listBackups,readBackup } from '../lib/server/store';
import { previewCsv } from '../lib/ledger/import';
import { summarize } from '../lib/ledger/engine';
import { eventPrice } from '../lib/server/market';
import * as ledgerRoute from '../app/api/ledger/route';
import * as previewRoute from '../app/api/imports/preview/route';
import * as quoteRoute from '../app/api/quotes/route';
import * as exportRoute from '../app/api/export/route';
import * as restoreRoute from '../app/api/restore/route';
/** Build a same-origin synthetic API request. */
function request(path:string,body?:unknown,origin='https://ledger.test'){return new Request('https://ledger.test'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',origin}:undefined,body:body?JSON.stringify(body):undefined});}
/** Build a cash deposit command containing no fixture shortcuts. */
function deposit(id='a',amount=1000){return {action:'save',key:id,revision:0,entry:{id,type:'DEPOSIT',tradeDate:'2026-01-01',grossAmount:amount,partnerId:'self'}};}
beforeEach(()=>{env.DB=testDatabase();auth.user=null;vi.mocked(eventPrice).mockResolvedValue(200);});
describe('atomic persistence and scoped access',()=>{
  it('persists across reads and isolates users',async()=>{expect((await readLedger('a')).ledger.entries).toHaveLength(0);await mutate('a',deposit());expect((await readLedger('a')).ledger.entries).toHaveLength(1);expect((await readLedger('b')).ledger.entries).toHaveLength(0);});
  it('replays one retried command and rejects a competing stale revision',async()=>{const saved=await mutate('a',deposit());const retry=await mutate('a',deposit());expect(retry.replayed).toBe(true);expect(retry.revision).toBe(saved.revision);await expect(mutate('a',{...deposit('different'),revision:0})).rejects.toThrow('another tab');expect((await readLedger('a')).ledger.entries).toHaveLength(1);});
  it('rejects changed payloads under an already committed retry key',async()=>{await mutate('a',deposit());await expect(mutate('a',deposit('a',2000))).rejects.toThrow('different data');expect((await readLedger('a')).ledger.entries[0].grossAmount).toBe(1000);});
  it('allows only one concurrent write from the same revision',async()=>{const results=await Promise.allSettled([mutate('a',deposit('one')),mutate('a',deposit('two'))]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await readLedger('a')).ledger.entries).toHaveLength(1);});
  it('rejects the whole import when the last row fails, preserving all previous data and backup counts',async()=>{await mutate('a',deposit());const before=await readLedger('a');const rows=await previewCsv('Date,Type,Amount\n2026-01-02,Deposit,100\n2026-01-03,Withdrawal,5000','self',before.ledger);await expect(mutate('a',{action:'import',key:'batch',revision:1,entries:rows.map(r=>r.entry)})).rejects.toThrow('Withdrawal exceeds');expect(await readLedger('a')).toEqual(before);expect(await listBackups('a')).toHaveLength(1);});
  it('commits preview, retries and repeats without duplicate rows',async()=>{const csv='Date,Type,Amount\n2026-01-01,Deposit,100\n2026-01-01,Deposit,100';const current=await readLedger('a');const rows=await previewCsv(csv,'self',current.ledger);const body={action:'import',key:'batch',revision:0,entries:rows.map(r=>r.entry)};const saved=await mutate('a',body);expect(saved.receipt.imported).toBe(2);expect((await mutate('a',body)).replayed).toBe(true);const again=await mutate('a',{...body,key:'repeat',revision:1});expect(again.receipt.imported).toBe(0);expect(again.receipt.skipped).toBe(2);expect(again.ledger.entries).toHaveLength(2);});
  it('prices event NAV and blocks unavailable required prices',async()=>{await mutate('a',deposit());await mutate('a',{action:'save',key:'buy',revision:1,entry:{id:'buy',type:'BUY',tradeDate:'2026-01-02',symbol:'TEST',quantity:10,grossAmount:1000}});await mutate('a',{action:'partner',key:'partner',revision:2,name:'Other'});const current=await readLedger('a');const partner=current.ledger.partners[1].id;const saved=await mutate('a',{action:'save',key:'newcash',revision:3,entry:{id:'newcash',type:'DEPOSIT',tradeDate:'2026-01-03',partnerId:partner,grossAmount:1000}});expect(saved.ledger.entries.at(-1)!.allocations[0].quantity).toBe(500);vi.mocked(eventPrice).mockResolvedValue(null);await expect(mutate('a',{action:'save',key:'later',revision:4,entry:{id:'later',type:'DEPOSIT',tradeDate:'2026-01-04',partnerId:partner,grossAmount:10}})).rejects.toThrow('No reliable prior-session price');expect((await readLedger('a')).revision).toBe(4);});
  it('roundtrips JSON backups, preserving units and isolating snapshots',async()=>{const saved=await mutate('a',deposit());const restored=await validateBackup(JSON.parse(JSON.stringify(saved.ledger)));expect(restored.entries[0].allocations[0].quantity).toBe(1000);expect(summarize(restored,{}).totalValue).toBe(1000);expect(await readBackup('b',0)).toBeNull();expect(await readBackup('a',0)).not.toBeNull();});
  it('retains exactly 20 recovery points and the current state',async()=>{for(let i=0;i<23;i++)await mutate('a',{...deposit('d'+i,1),revision:i});expect(await listBackups('a')).toHaveLength(20);expect((await readLedger('a')).ledger.entries).toHaveLength(23);});
});
describe('every API enforces server identity',()=>{
  it('rejects unsigned reads/writes before data access',async()=>{const routes=[()=>ledgerRoute.GET(request('/api/ledger')),()=>ledgerRoute.POST(request('/api/ledger',deposit())),()=>previewRoute.POST(request('/api/imports/preview',{csv:'x',partnerId:'self'})),()=>quoteRoute.GET(request('/api/quotes')),()=>exportRoute.GET(request('/api/export')),()=>restoreRoute.POST(request('/api/restore',{revision:0,confirmation:'RESTORE'}))];for(const call of routes)expect((await call()).status).toBe(401);expect((await readLedger('a')).revision).toBe(0);});
  it('rejects cross-origin, non-JSON and malformed writes',async()=>{auth.user={userId:'a',email:'a@example.test',displayName:'A',fullName:null};expect((await ledgerRoute.POST(request('/api/ledger',deposit(),'https://attacker.test'))).status).toBe(403);expect((await ledgerRoute.POST(new Request('https://ledger.test/api/ledger',{method:'POST',body:'{}'}))).status).toBe(415);expect((await ledgerRoute.POST(request('/api/ledger',{action:'save'}))).status).toBe(400);});
  it('cannot use another identity to read an existing ledger or restore its backup',async()=>{await mutate('a',deposit());auth.user={userId:'b',email:'b@example.test',displayName:'B',fullName:null};const response=await ledgerRoute.GET(request('/api/ledger'));const data=await response.json() as {ledger:{entries:unknown[]}};expect(data.ledger.entries).toHaveLength(0);expect((await restoreRoute.POST(request('/api/restore',{revision:0,backupRevision:0,confirmation:'RESTORE'}))).status).toBe(422);expect((await readLedger('a')).ledger.entries).toHaveLength(1);});
  it('exports and restores only the authenticated owner data',async()=>{await mutate('a',deposit());auth.user={userId:'a',email:'a@example.test',displayName:'A',fullName:null};const exported=await exportRoute.GET(request('/api/export'));expect(exported.headers.get('content-disposition')).toContain('.json');const backup=await exported.json();const restored=await restoreRoute.POST(request('/api/restore',{revision:1,confirmation:'RESTORE',backup}));expect(restored.status).toBe(200);expect((await readLedger('a')).revision).toBe(2);});
});

describe('broker attribution and noncash event persistence',()=>{
  it('returns owner mapping diagnostics without writing any ledger revision',async()=>{
    auth.user={userId:'owner',email:'owner@example.test',displayName:'Owner',fullName:null};
    const input='Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount\n1/2/2026,1/2/2026,,,,ACH,,,$100';
    const pending=await previewRoute.POST(request('/api/imports/preview',{csv:input,partnerId:''}));expect(pending.status).toBe(200);expect((await pending.json() as {rows:{error?:string}[]}).rows[0].error).toContain('Assign');
    const mapped=await previewRoute.POST(request('/api/imports/preview',{csv:input,cashFlowPartners:{'2':'self'}}));expect(mapped.status).toBe(200);expect((await mapped.json() as {rows:{entry:{partnerId:string}}[]}).rows[0].entry.partnerId).toBe('self');
    expect((await readLedger('owner')).revision).toBe(0);
    const invalid=await previewRoute.POST(request('/api/imports/preview',{csv:input,cashFlowPartners:{'2':'outsider'}}));expect(invalid.status).toBe(422);
  });
  it('restores conversion continuity and option expirations without changing cash or inventing realized merger gains',async()=>{
    const base={version:1,partners:[{id:'self',name:'Owner'}],entries:[
      {id:'d',type:'DEPOSIT',tradeDate:'2026-01-01',grossAmount:1000,partnerId:'self'},
      {id:'b',type:'BUY',tradeDate:'2026-01-02',symbol:'OLD',quantity:2,grossAmount:500},
      {id:'m',type:'CONVERSION',tradeDate:'2026-01-03',symbol:'OLD',quantity:2,targetSymbol:'NEW',targetQuantity:3,grossAmount:0},
      {id:'o',type:'BUY',tradeDate:'2026-01-04',symbol:'TEST260109C00025000',instrumentType:'OPTION',quantity:1,grossAmount:10},
      {id:'e',type:'EXPIRY',tradeDate:'2026-01-09',symbol:'TEST260109C00025000',instrumentType:'OPTION',quantity:1,grossAmount:0}
    ]};
    const restored=await validateBackup(base);expect(summarize(restored,{}).cash).toBe(490);expect(summarize(restored,{}).holdings.map(h=>h.symbol)).toEqual(['NEW']);expect(restored.entries[2].targetQuantity).toBe(3);
    await expect(validateBackup({...base,entries:[base.entries[0],base.entries[2]]})).rejects.toThrow('Conversion exceeds');
  });
});

describe('verified option quote-unit persistence',()=>{
 it('preserves verified terms through saves and backup restore and applies them exactly once to NAV',async()=>{
  await mutate('owner',deposit('d',100));
  const terms={instrumentType:'OPTION',optionMultiplier:100,optionTerms:'standard',optionTermsSource:'Synthetic verified broker contract specification.'};
  await mutate('owner',{action:'save',revision:1,key:'option',entry:{id:'o',type:'BUY',tradeDate:'2026-01-02',symbol:'TEST260109C00025000',quantity:1,grossAmount:10.04,...terms}});
  vi.mocked(eventPrice).mockResolvedValue(.1);
  const saved=await mutate('owner',{action:'save',revision:2,key:'flow',entry:{id:'flow',type:'DEPOSIT',tradeDate:'2026-01-03',grossAmount:99.96,partnerId:'self'}});
  expect(saved.ledger.entries[1].optionMultiplier).toBe(100);expect(saved.ledger.entries[2].allocations[0].quantity).toBeCloseTo(100,12);
  const restored=await validateBackup(JSON.parse(JSON.stringify(saved.ledger)));expect(restored.entries[1].optionTermsSource).toContain('Synthetic verified');expect(restored.entries[2].allocations[0].quantity).toBeCloseTo(100,12);
 });
});

describe('explicit future reinvestment provenance',()=>{
 it('persists preview metadata across commit, edit validation and portable backup without reclassifying older rows',async()=>{
  await mutate('reinvest',deposit());const current=await readLedger('reinvest');const csv='Date,Type,Symbol,Quantity,Amount,Description\n2026-01-02,BUY,TEST,1,10,TEST dividend reinvestment';const rows=await previewCsv(csv,'self',current.ledger);const saved=await mutate('reinvest',{action:'import',key:'reinvest-batch',revision:current.revision,entries:rows.map(r=>r.entry)});const buy=saved.ledger.entries.find(e=>e.type==='BUY')!;expect(buy.reinvestment).toEqual({source:'broker-description'});expect(buy.notes).toBe('TEST dividend reinvestment');const restored=await validateBackup(saved.ledger);expect(restored.entries.find(e=>e.id===buy.id)?.reinvestment).toEqual(buy.reinvestment);const edited=await mutate('reinvest',{action:'save',key:'edit-reinvest',revision:saved.revision,entry:{...buy,notes:'Edited description; provenance retained'}});expect(edited.ledger.entries.find(e=>e.id===buy.id)?.reinvestment).toEqual(buy.reinvestment);const legacy=await validateBackup({...saved.ledger,entries:saved.ledger.entries.map(e=>({...e,reinvestment:undefined}))});expect(legacy.entries.every(e=>e.reinvestment==null)).toBe(true);
 });
});
