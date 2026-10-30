/** Quote-unit conversion. Option quantities are contracts; quotes are premium points, never contract cash values. */
export interface InstrumentTerms {
  symbol?:string;assetSymbol?:string|null;assetId?:string|null;instrumentType?:'OPTION';
  optionMultiplier?:number;optionTerms?:'standard'|'adjusted';optionTermsSource?:string;
}
/** Canonical option roots may include adjustment digits; a symbol alone never proves the multiplier. */
export function isOptionSymbol(symbol:string):boolean{return /^[A-Z][A-Z0-9]{0,5}\d{6}[CP]\d{8}$/.test(symbol);}
/** Index independently verified premium multipliers; unverified or conflicting option terms remain unavailable. */
export function valuationMultipliers(entries:InstrumentTerms[]):Map<string,number|null>{
 const options=new Set<string>();const verified=new Map<string,Set<number>>();
 for(const entry of entries){
  const names=[...new Set([entry.symbol,entry.assetSymbol,entry.assetId].filter((s):s is string=>!!s))];
  if(entry.instrumentType!=='OPTION'&&!names.some(isOptionSymbol))continue;
  for(const symbol of names){options.add(symbol);const set=verified.get(symbol)??new Set<number>();
   if(entry.optionMultiplier!=null&&Number.isFinite(entry.optionMultiplier)&&entry.optionMultiplier>0&&entry.optionTermsSource?.trim()&&((entry.optionTerms==='standard'&&entry.optionMultiplier===100)||entry.optionTerms==='adjusted'))set.add(entry.optionMultiplier);
   verified.set(symbol,set);
  }
 }
 return new Map([...options].map(symbol=>{const set=verified.get(symbol)!;return [symbol,set.size===1?[...set][0]:null];}));
}
/** Ordinary securities/crypto use one quoted unit; unknown option terms must never fall back to one or one hundred. */
export function priceMultiplier(multipliers:Map<string,number|null>,symbol:string):number|null{return multipliers.has(symbol)?multipliers.get(symbol)!:1;}
