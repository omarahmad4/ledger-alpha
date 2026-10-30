/** Read-only restoration of legacy decision filters, gross-weighted summaries and five-decision timeline; no price/accounting changes. */
import type {decisionRows} from './analytics';
export type Decision=ReturnType<typeof decisionRows>[number];
export type WeightMode='unweighted'|'weighted';
const points:Record<string,number>={A:4,B:3,C:2,D:1,F:0};
/** Recognize explicit future import provenance or the exact original marker, never infer missing historical metadata.
 * @param row Derived purchase row. @returns Whether it carries an existing reinvestment marker. */
export function isReinvestment(row:Pick<Decision,'notes'|'reinvestment'>):boolean{return !!row.reinvestment||row.notes==='Dividend Reinvestment';}
/** Apply original filter defaults independently of presentation sorting.
 * @param rows All existing derived rows. @param includeClosed Include closed FIFO lots. @param hideReinvestments Hide marked purchases. @returns Copied filtered rows. */
export function filterDecisions(rows:readonly Decision[],includeClosed=true,hideReinvestments=true):Decision[]{return rows.filter(r=>(includeClosed||r.active)&&(!hideReinvestments||!isReinvestment(r)));}
/** Match legacy GPA-to-letter boundaries; no-data is unavailable rather than F.
 * @param gpa Existing aggregate grade points or null. @returns Letter or null. */
export function gpaLetter(gpa:number|null):string|null{return gpa==null?null:gpa>=3.5?'A':gpa>=2.5?'B':gpa>=1.5?'C':gpa>=0.5?'D':'F';}
/** Require a reliable finite alpha and a known existing grade; missing observations are never zero outcomes.
 * @param row Derived decision. @returns Whether this observation may enter summaries/timeline. */
export function scorable(row:Decision):boolean{return row.alpha!=null&&Number.isFinite(row.alpha)&&row.grade!=null&&points[row.grade]!=null;}
/** Restore original means using absolute source purchase gross (fees are not the weight).
 * @param rows Filtered rows before or after display sorting. @param mode Original weighting selection. @returns Summary with explicit coverage and unavailable empty values. */
export function decisionSummary(rows:readonly Decision[],mode:WeightMode='unweighted'){
 const eligible=rows.filter(scorable);const measured=mode==='weighted'?eligible.filter(r=>Number.isFinite(r.purchaseGross)&&r.purchaseGross>0):eligible;
 const weight=(r:Decision)=>mode==='weighted'?Math.abs(r.purchaseGross):1;
 const denominator=measured.reduce((sum,r)=>sum+weight(r),0);
 const gpa=denominator?measured.reduce((sum,r)=>sum+points[r.grade!]*weight(r),0)/denominator:null;
 return {displayed:rows.length,graded:eligible.length,included:measured.length,weightTotal:denominator,gpa,letter:gpaLetter(gpa),beatRate:denominator?measured.reduce((sum,r)=>sum+(r.alpha!>0?weight(r):0),0)/denominator:null,alpha:denominator?measured.reduce((sum,r)=>sum+r.alpha!*weight(r),0)/denominator:null};
}
/** Restore current-measured outcomes at buy dates, with the original unweighted trailing five-observation mean.
 * @param rows Filtered rows; table sort/weight mode must not affect this series. @returns Chronological points in percentage points. */
export function decisionTimeline(rows:readonly Decision[]){
 // Legacy upstream rows were alpha-descending before stable date sorting, including same-day ties.
 const chronological=rows.filter(scorable).map((row,index)=>({row,index})).sort((a,b)=>a.row.date.localeCompare(b.row.date)||b.row.alpha!-a.row.alpha!||a.index-b.index).map(x=>x.row);
 return chronological.map((r,i)=>{const window=chronological.slice(Math.max(0,i-4),i+1);return {id:r.id,day:r.date,symbol:r.symbol,alpha:r.alpha!*100,rollingAvg:window.reduce((sum,x)=>sum+x.alpha!,0)/window.length*100};});
}
