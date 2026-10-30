/** Canonical shared ledger contracts and normalization, consumed by both local Next and hosted Vinext apps. */
import { z } from 'zod';
import type { LedgerTransaction, TransactionType } from './domain';

const RawRobinhoodRow = z.record(z.string(), z.string().optional());

export interface ImportOwnerAllocation {
  ownerId: string;
  percentage: number;
}

export interface NormalizeRobinhoodRowOptions {
  accountId: string;
  assetLookup: (symbol: string) => { id: string; symbol: string } | undefined;
  defaultAllocations: ImportOwnerAllocation[];
}

function get(row: Record<string, string | undefined>, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const exact = row[candidate];
    if (exact != null && exact !== '') return exact;
    const foundKey = Object.keys(row).find((key) => key.trim().toLowerCase() === candidate.trim().toLowerCase());
    if (foundKey && row[foundKey]) return row[foundKey];
  }
  return undefined;
}

function money(value: string | undefined): number {
  if (!value) return 0;
  return Number(value.replace(/[$,()]/g, '').trim()) * (value.includes('(') ? -1 : 1);
}

function number(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferType(rawType: string | undefined, amount: number, quantity?: number): TransactionType {
  const code = (rawType ?? '').toUpperCase().trim();

  // 1. ACH Deposits/Withdrawals
  if (code === 'ACH') {
    return amount >= 0 ? 'DEPOSIT' : 'WITHDRAWAL';
  }

  // 2. Interest / Dividends / Stock Lending / Cash Rewards (Inflows with no quantity)
  if (['CDIV', 'MDIV', 'INT', 'SLIP', 'MISC', 'CIL', 'CONV'].includes(code)) {
    if (amount < 0) return 'FEE';
    return 'DIVIDEND';
  }

  // 3. Option sales (STC = Sell to Close option)
  if (code === 'STC') {
    return 'DIVIDEND';
  }

  // 4. Fees / Subscription / Margin Interest / Option buys (Outflows with no asset holdings)
  if (['GOLD', 'DFEE', 'AFEE', 'MINT', 'BTO', 'OEXP'].includes(code)) {
    return 'FEE';
  }

  // 5. Stock Splits
  if (code === 'SPL' || code === 'SPLIT') {
    return 'SPLIT';
  }

  // 6. Mergers (MRGS)
  if (code === 'MRGS') {
    return (quantity ?? 0) < 0 ? 'SELL' : 'BUY';
  }

  // 7. General Fallbacks
  const normalized = code.toLowerCase();
  if (normalized.includes('dividend')) return 'DIVIDEND';
  if (normalized.includes('deposit')) return 'DEPOSIT';
  if (normalized.includes('withdraw')) return 'WITHDRAWAL';
  if (normalized.includes('fee')) return 'FEE';
  if (normalized.includes('sell')) return 'SELL';
  if (normalized.includes('buy')) return 'BUY';

  if ((quantity ?? 0) < 0) return 'SELL';
  return 'BUY';
}

/**
 * Normalizes a Robinhood-like activity CSV row into the app ledger format.
 * Robinhood exports vary, so this accepts several likely column names and should be expanded with real samples.
 */
export function normalizeRobinhoodRow(raw: unknown, options: NormalizeRobinhoodRowOptions): LedgerTransaction | null {
  const row = RawRobinhoodRow.parse(raw);

  const symbol = get(row, ['Symbol', 'Instrument', 'Ticker']);
  const rawType = get(row, ['Activity Type', 'Trans Code', 'Type', 'Description']);
  const tradeDate = get(row, ['Trade Date', 'Process Date', 'Date', 'Activity Date']);
  const quantity = number(get(row, ['Quantity', 'Qty', 'Shares']));
  const price = money(get(row, ['Price', 'Share Price', 'Average Price']));
  const amount = money(get(row, ['Amount', 'Net Amount', 'Total', 'Value']));
  const fee = Math.abs(money(get(row, ['Fee', 'Fees', 'Reg Fee'])));

  const description = get(row, ['Description']) || '';
  const descLower = description.toLowerCase();
  const rawTypeLower = (rawType ?? '').toLowerCase();
  const isReinvestment = descLower.includes('reinvestment') ||
                         rawTypeLower.includes('reinvestment') ||
                         descLower.includes('bulk equity') ||
                         descLower.includes('order allocation');
  const notes = isReinvestment ? 'Dividend Reinvestment' : undefined;

  if (!tradeDate) return null;

  let isoDate: string;
  try {
    isoDate = new Date(tradeDate).toISOString();
  } catch {
    return null;
  }

  const asset = symbol ? options.assetLookup(symbol) : undefined;
  const type = inferType(rawType, amount, quantity);
  const absoluteQuantity = quantity == null ? undefined : Math.abs(quantity);
  const grossAmount = amount || (absoluteQuantity && price ? absoluteQuantity * price : 0);

  return {
    id: `import:${isoDate}:${symbol ?? 'cash'}:${rawType ?? 'unknown'}:${grossAmount}`,
    type,
    tradeDate: isoDate,
    assetId: asset?.id,
    assetSymbol: symbol || undefined,
    quantity: absoluteQuantity,
    price: price || undefined,
    grossAmount: Math.abs(grossAmount),
    fee,
    notes,
    allocations: options.defaultAllocations.map((allocation) => ({
      ownerId: allocation.ownerId,
      percentage: allocation.percentage,
      amount: Math.abs(grossAmount) * allocation.percentage,
      quantity: absoluteQuantity == null ? undefined : absoluteQuantity * allocation.percentage,
    })),
  };
}
