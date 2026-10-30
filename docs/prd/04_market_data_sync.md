# LedgerAlpha - Market Data Sync & CSV Import Spec

This document details how LedgerAlpha keeps its prices up-to-date and processes Robinhood activity exports.

---

## 1. Yahoo Finance Price Sync (`yahoo-finance2`)

We use the unofficial Node.js package `yahoo-finance2` to update database prices and benchmark levels:
- **Price updates**: A background job or API route fetches the latest close prices for all assets in the `Asset` table and saves them to the `Price` table.
- **Benchmark lookup**: For decision scoring, when a buy lot is processed, we query `yahoo-finance2` for the historical price of the relevant benchmark (e.g. SPY) on the trade date if a local snapshot is not yet saved in `BenchmarkSnapshot`. We cache this price locally in the database.

---

## 2. Robinhood CSV Import Workflow

Robinhood exports transaction records as CSV files. Since Robinhood does not provide an official API for general brokerage histories, we use a multi-step import workflow:

### A. Raw Row Normalization
The importer maps varying CSV headers to ledger transactions using candidate aliases:
- **Date**: `Trade Date`, `Process Date`, `Date`, `Activity Date`
- **Asset**: `Symbol`, `Instrument`, `Ticker`
- **Type**: `Activity Type`, `Trans Code`, `Type`, `Description`
- **Quantity**: `Quantity`, `Qty`, `Shares`
- **Price**: `Price`, `Share Price`, `Average Price`
- **Total Amount**: `Amount`, `Net Amount`, `Total`, `Value`

### B. Duplicate Detection
Before committing imported rows, we inspect the database:
- We match the `externalId` (hash of transaction trade date, symbol, type, and amount) or run a lookup check for transactions on the same day with matching quantities and amounts.
- Duplicate rows are flagged in the import UI and skipped.

### C. Reconciliation & Allocation
- When CSV rows are committed, new assets are created if they do not exist.
- Cash deposits and withdrawals are credited or debited to the respective owner.
- Buys and sells are recorded at the portfolio level, and allocations are locked based on the pool's unit weights at the transaction's timestamp.


## Hosted edition (2026-10-29)

The supported cross-device edition lives in `site/` and uses private ChatGPT sign-in plus user-scoped D1 records. See [the as-built hosting specification](../sites-hosting.md) for its data model, accounting replay, prior-session cash-flow pricing, split conventions, atomic import/deduplication, quote freshness, storage bounds and recovery workflow. Root Prisma/API descriptions above describe the retained local prototype, not the hosted storage/write path. No production seed or reset runs.
