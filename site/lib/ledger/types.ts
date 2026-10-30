/** Shared JSON contracts for the hosted ledger, API and browser. Pure types, no server dependency. */
import type { LedgerTransaction, TransactionType } from '../core/domain';
export type { TransactionType };
export const TYPES = ['DEPOSIT','WITHDRAWAL','BUY','SELL','DIVIDEND','FEE','SPLIT','CONVERSION','EXPIRY','REWARD'] as const;
export interface Partner { id: string; name: string }
export interface Entry extends LedgerTransaction {
  symbol?: string; partnerId?: string; externalId?: string;
  valuationPrices?: Record<string, number>; valuationDate?: string;
  navBeforeOverride?: number; splitMode?: 'ratio' | 'additional'; splitOrigin?: 'inferred' | 'csv' | 'manual';
}
export interface Receipt { key: string; imported: number; skipped: number; payloadHash?: string; derivedSplits?: {added:number;removed:number} }
export interface Ledger {
  version: 1; partners: Partner[]; entries: Entry[]; receipts: Receipt[]; cashPolicy?: 'cash-only'|'margin'|'reconstruction';
  reconciliation?: {estimated:true;openingOwnerId:string;notes:string[];cashVerified:false;asOf:string};
}
export interface StoredLedger { ledger: Ledger; revision: number; updatedAt: string }
export interface Quote {
  symbol: string; price: number | null; status: 'fresh'|'cached'|'stale'|'unavailable';
  marketTime: string | null; fetchedAt: string | null; message?: string;
}
export interface HistoricalPoint { day: string; close: number; rawClose: number }
export interface ImportRow {
  row: number; entry: Entry | null; error?: string; duplicate?: boolean; ignored?: string;
  warning?: string; relatedRows?: number[];
  source?: {day:string;code:string;symbol:string;amount:string;description:string;cashFlow:boolean};
}
export interface Backup { revision: number; createdAt: string }
