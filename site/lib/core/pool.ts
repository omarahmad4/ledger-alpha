import {valuationMultipliers,priceMultiplier} from './valuation';
/**
 * @file pool.ts
 * @description Core mathematical engine for the Unitized Fund Pool accounting model.
 * It manages total units, portfolio valuation (net cash + market assets), NAVPU,
 * and owner allocation shares at any given point in time.
 */

export interface TransactionAllocationInput {
  ownerId: string;
  percentage: number;
  amount: number;
  quantity?: number | null;
}

export interface TransactionInput {
  id: string;
  type: import('./domain').TransactionType;
  targetSymbol?: string; targetQuantity?: number; quantityRounding?: number;
  instrumentType?:'OPTION';optionMultiplier?:number;optionTerms?:'standard'|'adjusted';optionTermsSource?:string;
  tradeDate: string;
  assetId?: string | null;
  assetSymbol?: string | null;
  quantity?: number | null;
  price?: number | null;
  grossAmount: number;
  fee?: number | null;
  allocations: TransactionAllocationInput[];
}

export interface OwnerUnits {
  ownerId: string;
  units: number;
}

/**
 * Calculates the total units outstanding in the pool at any given date.
 * Units are added by DEPOSITs and subtracted by WITHDRAWALs.
 *
 * @param transactions Array of transactions
 * @param asOfDate Optional date constraint (inclusive)
 * @returns Total units outstanding
 */
export function calculateTotalUnits(transactions: TransactionInput[], asOfDate?: string): number {
  const targetDate = asOfDate ? new Date(asOfDate) : null;
  let totalUnits = 0;

  for (const tx of transactions) {
    if (targetDate && new Date(tx.tradeDate) > targetDate) continue;

    if (tx.type === 'DEPOSIT') {
      for (const alloc of tx.allocations) {
        totalUnits += alloc.quantity ?? 0;
      }
    } else if (tx.type === 'WITHDRAWAL') {
      for (const alloc of tx.allocations) {
        totalUnits -= alloc.quantity ?? 0;
      }
    }
  }

  return Math.max(totalUnits, 0);
}

/**
 * Calculates the units owned by each family member up to any given date.
 *
 * @param transactions Array of transactions
 * @param asOfDate Optional date constraint (inclusive)
 * @returns Map of ownerId to units
 */
export function calculateOwnerUnits(transactions: TransactionInput[], asOfDate?: string): Record<string, number> {
  const targetDate = asOfDate ? new Date(asOfDate) : null;
  const ownerUnits: Record<string, number> = Object.create(null);

  for (const tx of transactions) {
    if (targetDate && new Date(tx.tradeDate) > targetDate) continue;

    if (tx.type === 'DEPOSIT') {
      for (const alloc of tx.allocations) {
        ownerUnits[alloc.ownerId] = (ownerUnits[alloc.ownerId] ?? 0) + (alloc.quantity ?? 0);
      }
    } else if (tx.type === 'WITHDRAWAL') {
      for (const alloc of tx.allocations) {
        ownerUnits[alloc.ownerId] = (ownerUnits[alloc.ownerId] ?? 0) - (alloc.quantity ?? 0);
      }
    }
  }

  return ownerUnits;
}

/**
 * Calculates the net cash balance in the portfolio at any given date.
 *
 * @param transactions Array of transactions
 * @param asOfDate Optional date constraint (inclusive)
 * @returns Net cash balance (USD)
 */
export function calculateNetCash(transactions: TransactionInput[], asOfDate?: string): number {
  const targetDate = asOfDate ? new Date(asOfDate) : null;
  let netCash = 0;

  // Sort chronologically for accuracy
  const sorted = [...transactions].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());

  for (const tx of sorted) {
    if (targetDate && new Date(tx.tradeDate) > targetDate) continue;

    const amount = tx.grossAmount;
    const fee = tx.fee ?? 0;

    switch (tx.type) {
      case 'DEPOSIT':
      case 'TRANSFER_IN':
        netCash += amount;
        break;
      case 'WITHDRAWAL':
      case 'TRANSFER_OUT':
        netCash -= amount;
        break;
      case 'BUY':
        netCash -= (amount + fee);
        break;
      case 'SELL':
        netCash += (amount - fee);
        break;
      case 'DIVIDEND':
        netCash += amount;
        break;
      case 'FEE':
        netCash -= amount;
        break;
      default:
        break;
    }
  }

  return netCash;
}

/**
 * Calculates the quantity of each non-cash asset held in the portfolio up to a given date.
 * Handles BUY, SELL, TRANSFER_IN, TRANSFER_OUT, and SPLIT.
 *
 * @param transactions Array of transactions
 * @param asOfDate Optional date constraint (inclusive)
 * @returns Map of assetSymbol (uppercase) to quantity
 */
export function calculateAssetQuantities(transactions: TransactionInput[], asOfDate?: string): Record<string, number> {
  const targetDate = asOfDate ? new Date(asOfDate) : null;
  const assetQuantities: Record<string, number> = Object.create(null);

  const sorted = [...transactions].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());

  for (const tx of sorted) {
    if (targetDate && new Date(tx.tradeDate) > targetDate) continue;
    if (!tx.assetSymbol || tx.assetSymbol.toUpperCase() === 'USD') continue;

    const symbol = tx.assetSymbol.toUpperCase();
    const qty = tx.quantity ?? 0;

    if (!assetQuantities[symbol]) {
      assetQuantities[symbol] = 0;
    }

    switch (tx.type) {
      case 'BUY':
      case 'TRANSFER_IN':
      case 'REWARD':
        assetQuantities[symbol] += qty;
        break;
      case 'SELL':
      case 'TRANSFER_OUT':
      case 'EXPIRY':
        assetQuantities[symbol] -= qty;
        break;
      case 'CONVERSION': {
        const prior=assetQuantities[symbol];
        const converted=Math.abs(prior-qty)<=(tx.quantityRounding??0)+1e-9?prior:qty;
        assetQuantities[symbol]-=converted;
        if(tx.targetSymbol)assetQuantities[tx.targetSymbol]=(assetQuantities[tx.targetSymbol]??0)+(tx.targetQuantity??0);
        break;
      }
      case 'SPLIT':
        // Represent split ratio in quantity: e.g. a 4-for-1 split has quantity = 4
        if (qty > 0) {
          assetQuantities[symbol] *= qty;
        }
        break;
      default:
        break;
    }
  }

  return assetQuantities;
}

/**
 * Calculates the Net Asset Value (NAV) of the portfolio at any given date,
 * summing the net cash and the market value of all non-cash positions.
 *
 * @param transactions Array of transactions
 * @param prices Map of assetSymbol (uppercase) to current price
 * @param asOfDate Optional date constraint (inclusive)
 * @returns Net Asset Value in USD
 */
export function calculatePortfolioValue(
  transactions: TransactionInput[],
  prices: Record<string, number>,
  asOfDate?: string
): number {
  const cash = calculateNetCash(transactions, asOfDate);
  const quantities = calculateAssetQuantities(transactions, asOfDate);

  const multipliers=valuationMultipliers(transactions);let assetsValue = 0;
  for (const [symbol, qty] of Object.entries(quantities)) {
    const price = prices[symbol] ?? 0;
    if(Math.abs(qty)<1e-8)continue;const multiplier=priceMultiplier(multipliers,symbol);if(multiplier==null)throw new Error(`Unknown option quote multiplier for ${symbol}.`);
    assetsValue += qty * price * multiplier;
  }

  return cash + assetsValue;
}

/**
 * Calculates the dynamic ownership percentage share for each owner based on units held at any given date.
 *
 * @param transactions Array of transactions
 * @param owners Array of ownerIds
 * @param asOfDate Optional date constraint (inclusive)
 * @returns Map of ownerId to percentage share (0.0 to 1.0)
 */
export function getOwnerShares(
  transactions: TransactionInput[],
  owners: string[],
  asOfDate?: string
): Record<string, number> {
  const totalUnits = calculateTotalUnits(transactions, asOfDate);
  const ownerUnits = calculateOwnerUnits(transactions, asOfDate);
  const shares: Record<string, number> = Object.create(null);

  if (totalUnits <= 0) {
    // If no units are outstanding, divide equally
    const equalShare = 1 / owners.length;
    for (const ownerId of owners) {
      shares[ownerId] = equalShare;
    }
    return shares;
  }

  for (const ownerId of owners) {
    const units = ownerUnits[ownerId] ?? 0;
    shares[ownerId] = units / totalUnits;
  }

  return shares;
}
