/** Privacy guard regressions use constructed fake tokens and clearly synthetic records only. */
import {describe,it,expect} from 'vitest';
import {inspectFile} from '../scripts/privacy-check.mjs';
describe('offline privacy guard',()=>{
 it('blocks environment variants and credential/database/export artifacts',()=>{
  for(const file of ['.env.local','site/.env.production','site/.dev.vars.local','exports/activity.csv','backups/state.json','prisma/user.db','private-inputs/activity.json','key.pem'])expect(inspectFile(file,'{}').length).toBeGreaterThan(0);
 });
 it('permits environment templates, authored code and generic shared/family portfolio context',()=>{
  expect(inspectFile('.env.example','DATABASE_URL="file:./dev.db"')).toEqual([]);expect(inspectFile('README.md','A generic family or shared-account tracker with synthetic examples.')).toEqual([]);expect(inspectFile('site/lib/domain.ts','export interface Partner {name:string}')).toEqual([]);expect(inspectFile('site/app/api/export/route.ts','export function GET(){}')).toEqual([]);
 });
 it('allows clearly labelled synthetic CSV fixtures but not unlabeled exports',()=>{
  const content='# SYNTHETIC_FIXTURE\nDate,Type,Amount\n2026-01-01,DEPOSIT,100';expect(inspectFile('tests/fixtures/synthetic/activity.csv',content)).toEqual([]);expect(inspectFile('tests/fixtures/activity.csv',content).length).toBeGreaterThan(0);expect(inspectFile('site/tests/fixtures/synthetic/activity.csv','Date,Amount\n2026-01-01,100').length).toBeGreaterThan(0);
 });
 it('recognizes portable ledger backups independent of their filename',()=>{
  const content=JSON.stringify({version:1,partners:[{id:'a',name:'Synthetic'}],entries:[{grossAmount:100,allocations:[]}]});expect(inspectFile('ordinary.json',content).some(f=>f.category==='portable ledger backup')).toBe(true);expect(inspectFile('site/tests/fixtures/synthetic/ledger.json',JSON.stringify({fixtureKind:'SYNTHETIC_FIXTURE',...JSON.parse(content)}))).toEqual([]);
 });
 it('never exempts credential material in a synthetic fixture and never prints its value',()=>{
  const token=['gh','p_', 'A'.repeat(36)].join('');const findings=inspectFile('tests/fixtures/synthetic/config.csv','SYNTHETIC_FIXTURE\n'+token);expect(findings.some(f=>f.category==='recognized credential pattern')).toBe(true);expect(JSON.stringify(findings)).not.toContain(token);
 });
 it('catches signed download URLs without treating environment variable names as credentials',()=>{
  const url='https://example.test/object?'+['X-Amz','-Signature=','a'.repeat(64)].join('');expect(inspectFile('download.json',url).some(f=>f.category==='signed private download URL')).toBe(true);expect(inspectFile('env.d.ts','OWNER_IMPORT_KEY_HASH?: string;')).toEqual([]);
 });
});
