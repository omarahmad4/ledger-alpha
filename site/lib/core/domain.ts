/** Canonical shared ledger contracts and normalization, consumed by both local Next and hosted Vinext apps. */
export type AssetType = 'STOCK' | 'ETF' | 'CRYPTO' | 'CASH';
export type TransactionType = 'BUY' | 'SELL' | 'DIVIDEND' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE' | 'SPLIT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'CONVERSION' | 'EXPIRY' | 'REWARD';
export type BenchmarkType = 'SPY' | 'QQQ' | 'BTC' | 'ETH' | 'CASH' | 'PORTFOLIO';

export interface OwnerInput {
  id: string;
  name: string;
}

export interface AssetInput {
  id: string;
  symbol: string;
  name: string;
  type: AssetType;
}

export interface LedgerTransaction {
  id: string;
  type: TransactionType;
  tradeDate: string;
  assetId?: string;
  assetSymbol?: string;
  quantity?: number;
  price?: number;
  grossAmount: number;
  fee?: number;
  notes?: string;
  targetSymbol?: string;
  targetQuantity?: number;
  quantityRounding?: number;
  instrumentType?: 'OPTION';
  optionMultiplier?: number;
  optionTerms?: 'standard'|'adjusted';
  optionTermsSource?: string;
  basisUnknown?: boolean;
  allocations: Array<{
    ownerId: string;
    percentage: number;
    amount: number;
    quantity?: number;
  }>;
}

export interface HoldingSummary {
  ownerId: string;
  assetId: string;
  quantity: number;
  costBasis: number;
  marketValue: number;
  unrealizedGainLoss: number;
  unrealizedReturnPct: number | null;
}

export interface PriceMap {
  [assetId: string]: number;
}
