/** Validate every untrusted entry and backup before accounting or durable writes. Depends only on Zod. */
import { z } from 'zod';
import { isOptionSymbol } from '../core/valuation';
import { TYPES } from './types';
const reservedPartnerIds=new Set([...Object.getOwnPropertyNames(Object.prototype),'prototype']);
export const partnerIdSchema=z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/).refine(id=>!reservedPartnerIds.has(id),'Unsafe partner identifier.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Use a valid date');
export const entryInput = z.object({
  id: z.string().min(1).max(100), type: z.enum(TYPES), tradeDate: day,
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.^=-]{0,31}$/).optional(),
  targetSymbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.^=-]{0,31}$/).optional(),
  targetQuantity: z.number().finite().positive().max(1e12).optional(),
  quantityRounding: z.number().finite().positive().max(0.0001).optional(),
  instrumentType: z.literal('OPTION').optional(),
  optionMultiplier:z.number().finite().positive().max(1e6).optional(),
  optionTerms:z.enum(['standard','adjusted']).optional(),
  optionTermsSource:z.string().trim().min(1).max(500).optional(),
  basisUnknown: z.boolean().optional(),
  partnerId: partnerIdSchema.optional(),
  quantity: z.number().finite().positive().max(1e12).optional(),
  price: z.number().finite().nonnegative().max(1e12).optional(),
  grossAmount: z.number().finite().nonnegative().max(1e12),
  fee: z.number().finite().nonnegative().max(1e9).default(0),
  notes: z.string().max(1000).optional(),
  reinvestment:z.object({source:z.literal('broker-description')}).strict().optional(),
  navBeforeOverride: z.number().finite().positive().max(1e15).optional(),
  splitMode: z.enum(['ratio','additional']).optional(),
}).superRefine((v,ctx) => {
  if(v.reinvestment&&v.type!=='BUY')ctx.addIssue({code:'custom',message:'Reinvestment metadata applies only to purchases.'});
  if (['BUY','SELL','SPLIT','CONVERSION','EXPIRY','REWARD'].includes(v.type) && (!v.symbol || !v.quantity)) ctx.addIssue({code:'custom',message:'Asset events require a symbol and positive quantity.'});
  if (!['SPLIT','CONVERSION','EXPIRY','REWARD'].includes(v.type) && v.grossAmount <= 0) ctx.addIssue({code:'custom',message:'Amount must be positive.'});
  if (['SPLIT','CONVERSION','EXPIRY','REWARD'].includes(v.type) && (v.grossAmount !== 0 || v.fee !== 0)) ctx.addIssue({code:'custom',message:'Non-cash asset events have no cash amount or fee.'});
  if(v.type==='REWARD'&&!v.basisUnknown)ctx.addIssue({code:'custom',message:'Non-cash rewards require an explicit unknown-basis marker until verified.'});
  if(v.type==='CONVERSION'&&(!v.targetSymbol||!v.targetQuantity||v.targetSymbol===v.symbol))ctx.addIssue({code:'custom',message:'Conversion requires a different destination symbol and a positive received quantity.'});
  if(v.type!=='CONVERSION'&&(v.targetSymbol!=null||v.targetQuantity!=null||v.quantityRounding!=null))ctx.addIssue({code:'custom',message:'Destination fields apply only to a conversion.'});
  if(v.instrumentType==='OPTION'&&!/^[A-Z][A-Z0-9]{0,5}\d{6}[CP]\d{8}$/.test(v.symbol??''))ctx.addIssue({code:'custom',message:'Use a canonical option contract symbol.'});
  if(isOptionSymbol(v.symbol??'')&&v.instrumentType!=='OPTION')ctx.addIssue({code:'custom',message:'Option contract symbols require the OPTION instrument marker.'});
  if(v.optionMultiplier!=null||v.optionTerms!=null||v.optionTermsSource!=null){
    if(v.instrumentType!=='OPTION'||v.optionMultiplier==null||!v.optionTerms||!v.optionTermsSource)ctx.addIssue({code:'custom',message:'Verified option pricing needs an option instrument, multiplier, terms and verification source together.'});
    if(v.optionTerms==='standard'&&v.optionMultiplier!==100)ctx.addIssue({code:'custom',message:'Standard US equity/ETF options use a 100 premium multiplier; verify adjusted terms separately.'});
  }
  if(v.type==='EXPIRY'&&v.instrumentType!=='OPTION')ctx.addIssue({code:'custom',message:'Expiration requires an option contract.'});
  if (['DEPOSIT','WITHDRAWAL'].includes(v.type) && !v.partnerId) ctx.addIssue({code:'custom',message:'Choose the partner for this cash flow.'});
  if (!['BUY','SELL'].includes(v.type) && v.fee !== 0) ctx.addIssue({code:'custom',message:'Record cash fees as a separate fee entry.'});
  if (v.type === 'SELL' && v.fee > v.grossAmount) ctx.addIssue({code:'custom',message:'Sale fee cannot exceed proceeds.'});
  if (v.tradeDate > new Date().toISOString().slice(0,10)) ctx.addIssue({code:'custom',message:'Future transactions are not supported.'});
});
export const revisionSchema = z.number().int().nonnegative();
export const reconciliationSchema=z.object({estimated:z.literal(true),openingOwnerId:partnerIdSchema,notes:z.array(z.string().min(1).max(1000)).min(1).max(30),cashVerified:z.literal(false),asOf:day});
export const mutationSchema = z.discriminatedUnion('action',[
  z.object({action:z.literal('cashPolicy'),revision:revisionSchema,key:z.string().min(1).max(100),cashPolicy:z.enum(['cash-only','margin'])}),
  z.object({action:z.literal('save'),revision:revisionSchema,key:z.string().min(1).max(100),entry:entryInput}),
  z.object({action:z.literal('import'),revision:revisionSchema,key:z.string().min(1).max(100),entries:z.array(entryInput).min(1).max(2000)}),
  z.object({action:z.literal('partner'),revision:revisionSchema,key:z.string().min(1).max(100),id:partnerIdSchema.optional(),name:z.string().trim().min(1).max(80)}),
]);
