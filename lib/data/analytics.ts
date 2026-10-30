import { BenchmarkType } from '@prisma/client';
import { buildFifoLots } from '@/lib/accounting/lots';
import { computeHoldings, summarizeByOwner } from '@/lib/accounting/holdings';
import { getAssets, getLedgerTransactions, getOwners } from '@/lib/data/ledger';
import { scoreTransactionDecision } from '@/lib/scoring/decisionScore';
import { YahooFinanceMarketDataProvider } from '@/lib/market-data/provider';
import type { PriceMap } from '@/lib/types/domain';
import { prisma } from '@/lib/db/prisma';
import { calculateTotalUnits } from '@/lib/accounting/pool';
import type { TransactionInput } from '@/lib/accounting/pool';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

export async function getPortfolioAnalytics() {
  const [owners, assets, transactions] = await Promise.all([
    getOwners(),
    getAssets(),
    getLedgerTransactions(),
  ]);

  const provider = new YahooFinanceMarketDataProvider();

  // 1. Resolve Prices Map dynamically using the caching provider
  const prices: PriceMap = {};
  await Promise.all(
    assets.map(async (asset) => {
      if (asset.symbol === 'USD') {
        prices[asset.id] = 1.0;
      } else {
        try {
          // This calls yahoo-finance2 or retrieves from prisma cache
          const latest = await provider.getLatestPrice(asset.symbol);
          prices[asset.id] = latest;
        } catch (err) {
          console.warn(`Could not resolve latest price for ${asset.symbol}`, err);
          prices[asset.id] = 0.0;
        }
      }
    })
  );

  const usdAssetId = assets.find((a) => a.symbol === 'USD')?.id;
  const holdings = computeHoldings(transactions, prices, owners.map((o) => o.id), usdAssetId);

  const partnerContributions: Record<string, number> = {};
  for (const owner of owners) {
    let contributed = 0;
    for (const tx of transactions) {
      if (tx.type === 'DEPOSIT') {
        const alloc = tx.allocations.find((a) => a.ownerId === owner.id);
        if (alloc) contributed += Number(alloc.amount);
      } else if (tx.type === 'WITHDRAWAL') {
        const alloc = tx.allocations.find((a) => a.ownerId === owner.id);
        if (alloc) contributed -= Number(alloc.amount);
      }
    }
    partnerContributions[owner.id] = contributed;
  }

  const ownerSummary = summarizeByOwner(holdings, partnerContributions);
  const lots = buildFifoLots(transactions);

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const ownerById = new Map(owners.map((owner) => [owner.id, owner]));

  // 2. Resolve Dynamic Decision Grading Cohorts
  const buyTransactions = transactions.filter((t) => t.type === 'BUY');
  const scoredDecisions = await Promise.all(
    buyTransactions.map(async (tx) => {
      const score = await scoreTransactionDecision(tx, transactions, provider, BenchmarkType.SPY);
      const symbol = tx.assetId ? assetById.get(tx.assetId)?.symbol ?? 'Unknown' : 'Unknown';
      return {
        id: tx.id,
        tradeDate: tx.tradeDate,
        symbol,
        grossAmount: tx.grossAmount,
        quantity: tx.quantity ?? 0,
        price: tx.price ?? 0,
        notes: tx.notes,
        ...score,
      };
    })
  );

  // Clean up any null scores and sort by excess alpha descending
  const decisionRows = scoredDecisions.filter((s) => s.grade != null).sort((a: any, b: any) => b.excessReturnPct - a.excessReturnPct);

  const totals = ownerSummary.reduce(
    (acc, row) => {
      acc.marketValue += row.marketValue;
      acc.costBasis += row.costBasis;
      acc.unrealizedGainLoss += row.unrealizedGainLoss;
      return acc;
    },
    { marketValue: 0, costBasis: 0, unrealizedGainLoss: 0 }
  );

  return {
    owners,
    assets,
    transactions,
    prices,
    holdings,
    ownerSummary,
    lots,
    decisionRows,
    totals: {
      ...totals,
      unrealizedReturnPct: totals.costBasis === 0 ? null : totals.unrealizedGainLoss / totals.costBasis,
    },
  };
}

function toInputTx(tx: any, symbol?: string | null): TransactionInput {
  return {
    id: tx.id,
    type: tx.type as any,
    tradeDate: tx.tradeDate.toISOString(),
    assetId: tx.assetId,
    assetSymbol: symbol ?? null,
    quantity: tx.quantity == null ? null : Number(tx.quantity),
    price: tx.price == null ? null : Number(tx.price),
    grossAmount: Number(tx.grossAmount),
    fee: tx.fee == null ? null : Number(tx.fee),
    allocations: tx.allocations.map((a: any) => ({
      ownerId: a.ownerId,
      percentage: Number(a.percentage),
      amount: Number(a.amount),
      quantity: a.quantity == null ? null : Number(a.quantity),
    })),
  };
}

function getHistoricalPriceInmemory(
  pricesArray: { dateStr: string; price: number }[] | undefined,
  targetDateStr: string
): number {
  if (!pricesArray || pricesArray.length === 0) return 0;
  for (let i = pricesArray.length - 1; i >= 0; i--) {
    if (pricesArray[i].dateStr <= targetDateStr) {
      return pricesArray[i].price;
    }
  }
  return pricesArray[0].price;
}

export async function getPerformanceChartData(): Promise<any[]> {
  const transactions = await prisma.transaction.findMany({
    include: { allocations: true, asset: true },
    orderBy: { tradeDate: 'asc' },
  });

  if (transactions.length === 0) return [];

  // Ensure SPY benchmark asset exists in database
  let spyAsset = await prisma.asset.findFirst({ where: { symbol: 'SPY' } });
  if (!spyAsset) {
    spyAsset = await prisma.asset.create({
      data: { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'STOCK' }
    });
  }

  const assets = await prisma.asset.findMany();
  const usdAssetId = assets.find((a) => a.symbol === 'USD')?.id;
  const owners = await prisma.owner.findMany();
  const ownerIds = owners.map((o) => o.id);

  // Collect all unique asset symbols including SPY (excluding USD)
  const symbols = Array.from(new Set(assets.map((a) => a.symbol).filter((s) => s !== 'USD')));
  if (!symbols.includes('SPY')) {
    symbols.push('SPY');
  }

  const assetMap = new Map(assets.map((a) => [a.symbol, a.id]));
  if (!assetMap.has('SPY')) {
    assetMap.set('SPY', spyAsset.id);
  }

  // Preload historical prices from Yahoo Finance in single range queries if missing
  for (const sym of symbols) {
    const assetId = assetMap.get(sym)!;
    const count = await prisma.price.count({
      where: { assetId, source: 'yahoo-historical' }
    });

    if (count === 0) {
      const normalized = sym.replace('.', '-');
      try {
        const result = await yahooFinance.historical(
          normalized,
          {
            period1: '2020-01-01',
            period2: new Date().toISOString().split('T')[0],
          },
          { validateResult: false }
        ) as any;

        if (result && result.length > 0) {
          const priceData = result.map((p: any) => {
            const dateObj = p.date instanceof Date ? p.date : new Date(p.date);
            return {
              assetId,
              date: new Date(dateObj.toISOString().slice(0, 10) + 'T00:00:00.000Z'),
              close: Number(p.close ?? p.adjClose ?? 0),
              source: 'yahoo-historical',
            };
          }).filter((p: any) => p.close > 0);

          await prisma.price.createMany({
            data: priceData,
          });
        }
      } catch (err) {
        console.error(`Failed to preload historical prices for ${sym}`, err);
      }
    }
  }

  // Retrieve all preloaded prices for assets in scope
  const allPrices = await prisma.price.findMany({
    where: { assetId: { in: Array.from(assetMap.values()) }, source: 'yahoo-historical' },
    orderBy: { date: 'asc' },
  });

  // Build in-memory lookup table
  const inMemoryPrices = new Map<string, { dateStr: string; price: number }[]>();
  for (const p of allPrices) {
    if (!inMemoryPrices.has(p.assetId)) {
      inMemoryPrices.set(p.assetId, []);
    }
    inMemoryPrices.get(p.assetId)!.push({
      dateStr: p.date.toISOString().slice(0, 10),
      price: Number(p.close),
    });
  }

  // Collect unique chronological dates to evaluate performance
  const datePoints: string[] = [];
  const firstTxDate = transactions[0].tradeDate.toISOString().slice(0, 10);
  datePoints.push(firstTxDate);

  const monthEnds = new Map<string, string>();
  for (const tx of transactions) {
    const yyyymm = tx.tradeDate.toISOString().slice(0, 7);
    const dateStr = tx.tradeDate.toISOString().slice(0, 10);
    monthEnds.set(yyyymm, dateStr);
  }

  for (const dateStr of monthEnds.values()) {
    if (!datePoints.includes(dateStr)) {
      datePoints.push(dateStr);
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  if (!datePoints.includes(todayStr)) {
    datePoints.push(todayStr);
  }

  datePoints.sort();

  const chartData: any[] = [];
  let navpu_0 = 10.0;
  let spy_0 = 1.0;
  let inceptionResolved = false;

  for (const dateStr of datePoints) {
    const targetDate = new Date(dateStr + 'T23:59:59.999Z');
    const txsUpToDate = transactions
      .filter((tx) => tx.tradeDate <= targetDate)
      .map((tx) => toInputTx(tx, tx.asset?.symbol));

    if (txsUpToDate.length === 0) continue;

    // Resolve prices in-memory for all assets (no database queries inside loop)
    const prices: Record<string, number> = {};
    for (const asset of assets) {
      if (asset.symbol === 'USD') {
        prices[asset.id] = 1.0;
      } else {
        prices[asset.id] = getHistoricalPriceInmemory(inMemoryPrices.get(asset.id), dateStr);
      }
    }

    const holdings = computeHoldings(txsUpToDate as any, prices, ownerIds, usdAssetId);
    const totalVal = holdings.reduce((sum, h) => sum + h.marketValue, 0);
    const totalUnits = calculateTotalUnits(txsUpToDate);
    const navpu = totalUnits > 0 ? totalVal / totalUnits : 10.0;

    const spyAssetId = assetMap.get('SPY')!;
    const spyPrice = getHistoricalPriceInmemory(inMemoryPrices.get(spyAssetId), dateStr);

    if (!inceptionResolved && navpu > 0 && spyPrice > 0) {
      navpu_0 = navpu;
      spy_0 = spyPrice;
      inceptionResolved = true;
    }

    const portfolioReturn = navpu_0 > 0 ? (navpu - navpu_0) / navpu_0 : 0.0;
    const spyReturn = spy_0 > 0 ? (spyPrice - spy_0) / spy_0 : 0.0;

    chartData.push({
      date: new Date(dateStr).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      portfolioReturn: portfolioReturn * 100,
      spyReturn: spyReturn * 100,
    });
  }

  return chartData;
}
