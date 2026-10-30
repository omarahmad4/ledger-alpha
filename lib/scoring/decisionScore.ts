/**
 * @file decisionScore.ts
 * @description Decision grading engine. Evaluates the performance of a buy decision (transaction cohort)
 * against a benchmark (e.g., SPY or QQQ) by tracking both remaining holdings and historically realized trims.
 */

import { BenchmarkType } from '@prisma/client';
import { buildFifoLots } from '../accounting/lots';
import type { LedgerTransaction } from '../types/domain';
import type { MarketDataProvider } from '../market-data/provider';
import { prisma } from '../db/prisma';

export type DecisionGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface DecisionScoreResult {
  actualValue: number;
  benchmarkValue: number;
  actualReturnPct: number;
  benchmarkReturnPct: number;
  excessReturnPct: number;
  grade: DecisionGrade;
  isActive: boolean;
}

function pct(current: number, initial: number): number {
  if (initial === 0) return 0;
  return (current - initial) / initial;
}

/**
 * Assigns a grade based on the excess return percentage (alpha) relative to the benchmark.
 */
export function gradeExcessReturn(excessReturnPct: number): DecisionGrade {
  if (excessReturnPct > 0.05) return 'A';                  // Beats S&P 500 by > 5%
  if (excessReturnPct >= -0.05 && excessReturnPct <= 0.05) return 'B'; // Aligned within +/- 5%
  if (excessReturnPct >= -0.15) return 'C';                // Underperforms by 5% to 15%
  if (excessReturnPct >= -0.25) return 'D';                // Underperforms by 15% to 25%
  return 'F';                                              // Underperforms by > 25%
}

/**
 * Grades a single BUY transaction decision against a chosen benchmark.
 * Resolves opportunity cost for both active holdings and historically realized sales.
 * 
 * @param tx The BUY transaction to score
 * @param allTransactions All ledger transactions
 * @param provider Pricing data provider
 * @param benchmark Benchmark index symbol (SPY, QQQ)
 */
export async function scoreTransactionDecision(
  tx: LedgerTransaction,
  allTransactions: LedgerTransaction[],
  provider: MarketDataProvider,
  benchmark: BenchmarkType
): Promise<DecisionScoreResult | null> {
  if (tx.type !== 'BUY' || !tx.assetId) {
    return null;
  }

  // 1. Build lots to match trims/sells chronologically
  const lots = buildFifoLots(allTransactions);
  const matchingLots = lots.filter((lot) => lot.sourceTransactionId === tx.id);
  if (matchingLots.length === 0) {
    return null;
  }

  const buyDate = tx.tradeDate.split('T')[0];
  let assetSymbol = '';
  if (tx.assetId) {
    try {
      const asset = await prisma.asset.findUnique({ where: { id: tx.assetId } });
      assetSymbol = asset?.symbol ?? tx.assetId;
    } catch {
      assetSymbol = tx.assetId;
    }
  }
  if (!assetSymbol) {
    return null;
  }

  // 2. Fetch prices at buy date
  const assetPriceBuy = tx.price ?? (tx.grossAmount / (tx.quantity ?? 1));
  let benchmarkPriceBuy = 1.0;
  try {
    const benchmarkClose = await provider.getHistoricalClose(benchmark.toString(), buyDate);
    benchmarkPriceBuy = benchmarkClose ? benchmarkClose.close : 1.0;
  } catch (err) {
    console.warn(`Could not fetch historical benchmark price for ${benchmark} on date ${buyDate}`, err);
  }

  // 3. Fetch latest current prices
  let assetPriceCurrent = 0.0;
  try {
    assetPriceCurrent = await provider.getLatestPrice(assetSymbol);
  } catch (err) {
    console.warn(`Could not fetch latest price for ${assetSymbol}`, err);
    assetPriceCurrent = assetPriceBuy; // Fallback to cost basis price to avoid calculations crash
  }

  let benchmarkPriceCurrent = 1.0;
  try {
    benchmarkPriceCurrent = await provider.getLatestPrice(benchmark.toString());
  } catch (err) {
    console.warn(`Could not fetch latest price for benchmark ${benchmark}`, err);
    benchmarkPriceCurrent = benchmarkPriceBuy;
  }

  let totalInvested = 0;
  let totalActualValue = 0;
  let totalBenchmarkValue = 0;

  for (const lot of matchingLots) {
    const invested = lot.originalCostBasis;
    totalInvested += invested;

    // A. Actual Value (remaining position + actual proceeds from trims)
    const valActive = lot.remainingQuantity * assetPriceCurrent;
    const valRealized = lot.realizedProceeds;
    totalActualValue += (valActive + valRealized);

    // B. Benchmark Equivalent Value
    const unitsRemaining = lot.costBasis / benchmarkPriceBuy;
    const valBenchmarkActive = unitsRemaining * benchmarkPriceCurrent;

    // Value of realized benchmark units at their respective sell dates
    let valBenchmarkRealized = 0;
    for (const sale of lot.sales) {
      // Find benchmark price on sell date
      const sellDate = sale.sellDate.split('T')[0];
      let benchmarkPriceSell = benchmarkPriceCurrent;
      try {
        const benchmarkCloseSell = await provider.getHistoricalClose(benchmark.toString(), sellDate);
        if (benchmarkCloseSell) {
          benchmarkPriceSell = benchmarkCloseSell.close;
        }
      } catch (err) {
        console.warn(`Could not fetch historical benchmark price on sale date ${sellDate}`, err);
      }

      const costBasisSold = sale.costBasis;
      const unitsSold = costBasisSold / benchmarkPriceBuy;
      const benchmarkProceeds = unitsSold * benchmarkPriceSell;
      valBenchmarkRealized += benchmarkProceeds;
    }

    totalBenchmarkValue += (valBenchmarkActive + valBenchmarkRealized);
  }

  if (totalInvested === 0) return null;

  const actualReturnPct = pct(totalActualValue, totalInvested);
  const benchmarkReturnPct = pct(totalBenchmarkValue, totalInvested);
  const excessReturnPct = actualReturnPct - benchmarkReturnPct;

  const isActive = matchingLots.some((lot) => lot.remainingQuantity > 1e-9);

  return {
    actualValue: totalActualValue,
    benchmarkValue: totalBenchmarkValue,
    actualReturnPct,
    benchmarkReturnPct,
    excessReturnPct,
    grade: gradeExcessReturn(excessReturnPct),
    isActive,
  };
}
