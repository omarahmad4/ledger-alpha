/** Offline repository privacy guard: high-confidence secrets and private financial files, with no network or paid dependencies. */
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
/** Inspect a project file without printing matched contents. This cannot certify that all data is nonpersonal.
 * @param {string} file Repository-relative path. @param {string} content UTF-8 source or fixture.
 * @returns {Array<{path:string,category:string}>} Locations/categories, never secret or financial values. */
export function inspectFile(file,content){
 const findings=[];const normalized=file.replaceAll('\\','/');const base=normalized.split('/').at(-1);
 const add=category=>findings.push({path:normalized,category});
 if(/^(?:\.env|\.dev\.vars)(?:\.|$)/.test(base)&&!/^\.env\.(?:example|sample)$/.test(base))add('private environment file');
 if(/(?:^|\/)(?:private-inputs?|private-audit)(?:\/|$)/i.test(normalized)||/^(?:site\/)?(?:exports?|backups?)\//i.test(normalized)||/\.(?:db|sqlite|sqlite3|db-journal|db-wal|db-shm|pem|key|bundle|tar\.gz)$/i.test(normalized))add('private data or credential artifact');
 const synthetic=/^(?:site\/)?tests\/fixtures\/synthetic\//.test(normalized)&&content.includes('SYNTHETIC_FIXTURE');
 if(/\.(?:csv|tsv|xlsx|xls|ofx|qfx)$/i.test(normalized)&&!synthetic)add('financial export requires explicit synthetic fixture provenance');
 // Credentials are checked even inside an explicitly synthetic fixture; fixtures cannot exempt secrets.
 if(/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(content))add('recognized credential pattern');
 if(/https?:\/\/[^\s"']+[?&](?:X-Amz-Signature|X-Goog-Signature|sig)=[A-Za-z0-9%]{20,}/i.test(content))add('signed private download URL');
 if(!synthetic){
  try{const value=JSON.parse(content);if(value&&typeof value==='object'&&Array.isArray(value.partners)&&Array.isArray(value.entries)&&value.entries.some(e=>e&&typeof e==='object'&&('grossAmount'in e||'allocations'in e)))add('portable ledger backup');}catch{/* Authored code and documentation are not assumed to be JSON datasets. */}
 }
 return findings;
}
/** Read tracked project files and optionally every reachable historical blob, reporting only locations/categories.
 * @param {string} cwd Repository root. @param {boolean} history Whether to inspect reachable Git history as well.
 * @returns {{files:number,historicalBlobs:number,findings:Array<{path:string,category:string}>}} Bounded audit summary. */
export function inspectRepository(cwd,history=false){
 const names=execFileSync('git',['ls-files','-z'],{cwd,encoding:'utf8'}).split('\0').filter(Boolean);const findings=[];
 for(const file of names){const absolute=resolve(cwd,file);if(existsSync(absolute))findings.push(...inspectFile(file,readFileSync(absolute,'utf8')));}
 let historicalBlobs=0;
 if(history){const objects=execFileSync('git',['rev-list','--objects','--all'],{cwd,encoding:'utf8',maxBuffer:20*1024*1024}).trim().split('\n');const seen=new Set();
  for(const line of objects){const split=line.indexOf(' ');if(split<0)continue;const sha=line.slice(0,split),file=line.slice(split+1);if(seen.has(sha))continue;seen.add(sha);
   const type=execFileSync('git',['cat-file','-t',sha],{cwd,encoding:'utf8'}).trim();if(type!=='blob')continue;historicalBlobs++;
   const content=execFileSync('git',['cat-file','blob',sha],{cwd,encoding:'utf8',maxBuffer:20*1024*1024});findings.push(...inspectFile(file,content).map(f=>({...f,path:`history:${sha.slice(0,12)}:${f.path}`})));
  }
 }
 return {files:names.length,historicalBlobs,findings};
}
/** CLI prints paths/categories only and fails closed when a recognized risk is found. */
export function main(){
 const report=inspectRepository(process.cwd(),process.argv.includes('--history'));
 console.log(`Privacy guard inspected ${report.files} tracked files and ${report.historicalBlobs} historical blobs.`);
 for(const finding of report.findings)console.error(`${finding.category}: ${finding.path}`);
 if(report.findings.length)process.exitCode=1;
 else console.log('No guarded patterns found. This is prevention, not a guarantee against personal-data disclosure; review source and history separately.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main();
