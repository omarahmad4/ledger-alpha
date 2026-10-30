/**
 * @file benchmark.ts
 * @description Synchronization service for index benchmarks (e.g., SPY, QQQ)
 * to cache historical index price levels on transaction dates for performance scoring.
 */

import { BenchmarkType } from '@prisma/client';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import { prisma } from '../db/prisma';

/**
 * Synchronizes and caches the closing value of a benchmark index on a specific date.
 * Queries Yahoo Finance if not found in the database.
 * 
 * @param type BenchmarkType enum (SPY or QQQ)
 * @param date ISO Date string (YYYY-MM-DD)
 * @returns Close value of the benchmark in USD
 */
export async function syncBenchmarkPrice(type: BenchmarkType, date: string): Promise<number> {
  const targetDate = new Date(`${date}T00:00:00.000Z`);

  // 1. Check Database Cache
  const cached = await prisma.benchmarkSnapshot.findUnique({
    where: {
      type_date_source: {
        type,
        date: targetDate,
        source: 'yahoo',
      },
    },
  });

  if (cached) {
    return Number(cached.value);
  }

  // 2. Cache Miss - Query Yahoo Finance Historical Close
  // Target index ticker: SPY for SPY, QQQ for QQQ
  const ticker = type.toString().toUpperCase();
  const startDate = new Date(targetDate);
  const endDate = new Date(targetDate.getTime() + 4 * 24 * 60 * 60 * 1000);

  let closeValue: number | null = null;
  try {
    const result = await yahooFinance.historical(ticker, {
      period1: startDate.toISOString().split('T')[0],
      period2: endDate.toISOString().split('T')[0],
    });

    if (result && result.length > 0) {
      closeValue = result[0].close ?? null;
    }
  } catch (err) {
    console.warn(`Yahoo Finance historical query failed for benchmark ${ticker} on date ${date}`, err);
  }

  if (closeValue == null) {
    throw new Error(`Unable to fetch historical benchmark price for ${ticker} on date ${date}`);
  }

  // 3. Save to Database Cache
  await prisma.benchmarkSnapshot.create({
    data: {
      type,
      date: targetDate,
      value: closeValue,
      source: 'yahoo',
    },
  });

  return closeValue;
}
