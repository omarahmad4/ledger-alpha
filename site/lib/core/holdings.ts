/**
 * @file holdings.ts
 * @description Core accounting module to calculate asset holdings at the pool level
 * and distribute them dynamically to partners based on current pool units shares.
 */

import type { HoldingSummary, LedgerTransaction, PriceMap } from './domain';
import {valuationMultipliers,priceMultiplier} from './valuation';
import { calculateNetCash, getOwnerShares } from './pool';

/**
 * Safely calculates division ratio, returning null if denominator is zero.
 *
 * @param numerator The numerator.
 * @param denominator The denominator.
 * @returns The division result or null.
 */
function safePct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

interface PoolPosition {
  assetId: string;
  quantity: number;
  costBasis: number;
}

/**
 * Computes pool-level asset positions chronologically from ledger transactions.
 * Calculates cumulative quantities and adjusts cost basis for buys, sells, and splits.
 *
 * @param transactions Sorted array of chronological transactions.
 * @returns Array of pool positions.
 */
export function computePoolHoldings(transactions: LedgerTransaction[]): PoolPosition[] {
  const positions = new Map<string, PoolPosition>();
  const sorted = [...transactions].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  for (const tx of sorted) {
    if (!tx.assetId) continue;

    const existing = positions.get(tx.assetId) ?? {
      assetId: tx.assetId,
      quantity: 0,
      costBasis: 0,
    };

    const quantity = tx.quantity ?? 0;
    const amount = tx.grossAmount;
    const fee = tx.fee ?? 0;

    switch (tx.type) {
      case 'BUY':
      case 'TRANSFER_IN':
      case 'REWARD': {
        existing.quantity += quantity;
        existing.costBasis += Math.abs(amount) + fee;
        break;
      }
      case 'SELL':
      case 'TRANSFER_OUT':
      case 'EXPIRY': {
        if (existing.quantity <= 0) break;
        const sellQuantity = Math.abs(quantity);
        const basisPerShare = existing.costBasis / existing.quantity;
        existing.quantity -= sellQuantity;
        existing.costBasis -= basisPerShare * sellQuantity;
        if (Math.abs(existing.quantity) < 1e-9) {
          existing.quantity = 0;
          existing.costBasis = 0;
        }
        break;
      }
      case 'CONVERSION': {
        const consumed=Math.abs(existing.quantity-quantity)<=(tx.quantityRounding??0)+1e-9?existing.quantity:quantity;
        const basis=existing.quantity>0?existing.costBasis*consumed/existing.quantity:0;
        existing.quantity-=consumed;existing.costBasis-=basis;
        if(tx.targetSymbol){const target=positions.get(tx.targetSymbol)??{assetId:tx.targetSymbol,quantity:0,costBasis:0};target.quantity+=tx.targetQuantity??0;target.costBasis+=basis;positions.set(tx.targetSymbol,target);}
        break;
      }
      case 'SPLIT': {
        if (quantity && quantity > 0) {
          existing.quantity *= quantity;
        }
        break;
      }
      default:
        break;
    }

    positions.set(tx.assetId, existing);
  }

  return [...positions.values()].filter((p) => Math.abs(p.quantity) > 1e-9);
}

/**
 * Computes current owner-level holdings from normalized ledger transactions.
 * Resolves pool-level positions and allocates them based on current owner shares.
 *
 * @param transactions Chronological list of ledger transactions.
 * @param prices Current prices mapped by asset ID.
 * @param ownerIds Optional array of active owner IDs.
 * @param usdAssetId Optional asset ID representing cash (USD).
 * @returns Array of holding summaries per owner and asset.
 */
export function computeHoldings(
  transactions: LedgerTransaction[],
  prices: PriceMap,
  ownerIds?: string[],
  usdAssetId?: string
): HoldingSummary[] {
  const multipliers=valuationMultipliers(transactions);const poolHoldings = computePoolHoldings(transactions);

  const resolvedOwnerIds = ownerIds ?? Array.from(new Set(transactions.flatMap((tx) => tx.allocations.map((a) => a.ownerId))));
  const shares = getOwnerShares(transactions, resolvedOwnerIds);

  const list: HoldingSummary[] = [];

  for (const ownerId of resolvedOwnerIds) {
    const share = shares[ownerId] ?? 0;
    if (share <= 0) continue;

    for (const ph of poolHoldings) {
      const quantity = ph.quantity * share;
      const costBasis = ph.costBasis * share;
      const price = prices[ph.assetId] ?? 0;
      const multiplier=priceMultiplier(multipliers,ph.assetId);if(multiplier==null)throw new Error(`Unknown option quote multiplier for ${ph.assetId}.`);
      const marketValue = quantity * price * multiplier;
      const unrealizedGainLoss = marketValue - costBasis;

      list.push({
        ownerId,
        assetId: ph.assetId,
        quantity,
        costBasis,
        marketValue,
        unrealizedGainLoss,
        unrealizedReturnPct: safePct(unrealizedGainLoss, costBasis),
      });
    }
  }

  // Inject cash holdings if usdAssetId is provided
  if (usdAssetId) {
    const cashBalance = calculateNetCash(transactions);
    for (const ownerId of resolvedOwnerIds) {
      const share = shares[ownerId] ?? 0;
      const ownerCash = share * cashBalance;
      if (Math.abs(ownerCash) > 1e-9) {
        list.push({
          ownerId,
          assetId: usdAssetId,
          quantity: ownerCash,
          costBasis: ownerCash,
          marketValue: ownerCash,
          unrealizedGainLoss: 0,
          unrealizedReturnPct: 0,
        });
      }
    }
  }

  return list;
}

/**
 * Summarizes holdings by owner, summing market value, cost basis, and gain/loss.
 * Supports timing-adjusted capital cost basis overrides.
 *
 * @param holdings Array of individual holding summaries.
 * @param partnerContributions Optional map of ownerId to actual net cash contributions.
 * @returns Summarized metrics for each owner.
 */
export function summarizeByOwner(holdings: HoldingSummary[], partnerContributions?: Record<string, number>) {
  const rows = new Map<string, { ownerId: string; marketValue: number; costBasis: number; unrealizedGainLoss: number }>();

  for (const h of holdings) {
    const existing = rows.get(h.ownerId) ?? { ownerId: h.ownerId, marketValue: 0, costBasis: 0, unrealizedGainLoss: 0 };
    existing.marketValue += h.marketValue;
    existing.costBasis += h.costBasis;
    existing.unrealizedGainLoss += h.unrealizedGainLoss;
    rows.set(h.ownerId, existing);
  }

  return [...rows.values()].map((row) => {
    if (partnerContributions && partnerContributions[row.ownerId] !== undefined) {
      const actualContributed = partnerContributions[row.ownerId];
      const actualGainLoss = row.marketValue - actualContributed;
      return {
        ownerId: row.ownerId,
        marketValue: row.marketValue,
        costBasis: actualContributed,
        unrealizedGainLoss: actualGainLoss,
        unrealizedReturnPct: safePct(actualGainLoss, actualContributed),
      };
    }

    return {
      ...row,
      unrealizedReturnPct: safePct(row.unrealizedGainLoss, row.costBasis),
    };
  });
}
