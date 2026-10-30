# LedgerAlpha - Data Model Notes

This document describes how the relational database schema underpins the ledger-first architecture of LedgerAlpha.

---

## 1. Relational Entities & Purpose

The database is built on **SQLite** using **Prisma ORM**. Below is the logical breakdown of the key tables:

### A. Owners & Accounts
- `Owner`: Represents a partner or account beneficiary (Partner 1, Partner 2, Partner 3). Has a `slug` for URL routing and tracks their allocation units.
- `Account`: Represents the brokerage endpoint (e.g. "Shared Brokerage Account").

### B. Core Ledger Transactions
- `Transaction`: Records every event affecting the portfolio. Types include `BUY`, `SELL`, `DIVIDEND`, `DEPOSIT`, `WITHDRAWAL`, `FEE`, `SPLIT`, `TRANSFER_IN`, `TRANSFER_OUT`.
- `TransactionAllocation`: Maps a transaction to its owners.
  - *Under the Unitized Pool Model*:
    - For `DEPOSIT` and `WITHDRAWAL` transactions, the allocation represents the owner who added or removed the cash, and their percentage is $1.0$ ($100\%$).
    - For asset trades (`BUY`, `SELL`, `DIVIDEND`, `FEE`), the allocations represent the split of ownership *at the moment of the transaction*. These allocations are computed programmatically from the current outstanding units and saved to the database to freeze the historical ownership split.

### C. Market & Benchmark Data
- `Asset`: Tracks the stock tickers, ETFs, cryptocurrencies, and cash equivalents.
- `Price`: Stores end-of-day close prices for assets. Used to compute current portfolio value and historical lot valuations.
- `BenchmarkSnapshot`: Stores end-of-day values of benchmarks (SPY, QQQ, BTC, ETH). Used to compute benchmark returns for decision grading.

### D. FIFO Lot Accounting
- `Lot`: Stores open position cohorts. When a `BUY` transaction occurs, a lot is created. When a `SELL` occurs, `remainingQuantity` is reduced FIFO-style, and realized gains are added.

### E. Decision Scores
- `DecisionScore`: Stores performance reports for each lot vs a benchmark. Contains details like `actualReturnPct`, `benchmarkReturnPct`, `excessReturnPct`, and the letter `grade`.

---

## 2. Schema Diagram

```mermaid
erDiagram
    OWNER ||--o{ TRANSACTION_ALLOCATION : receives
    OWNER ||--o{ LOT : owns
    ACCOUNT ||--o{ TRANSACTION : holds
    ASSET ||--o{ TRANSACTION : represents
    ASSET ||--o{ LOT : represents
    ASSET ||--o{ PRICE : historical
    TRANSACTION ||--o{ TRANSACTION_ALLOCATION : splits
    IMPORT_BATCH ||--o{ TRANSACTION : creates
```

---

## 3. SQLite Limitations & Type Handling
- SQLite does not have a native `Decimal` type. Prisma emulates `Decimal` by storing values as numeric floats or strings, and maps them to decimal classes in JavaScript/TypeScript.
- SQLite does not support native `enums`. Prisma represents them as strings in the SQLite table with check constraints, mapping them to native TypeScript enums on the client side.


## Hosted edition (2026-10-29)

The supported cross-device edition lives in `site/` and uses private ChatGPT sign-in plus user-scoped D1 records. See [the as-built hosting specification](../sites-hosting.md) for its data model, accounting replay, prior-session cash-flow pricing, split conventions, atomic import/deduplication, quote freshness, storage bounds and recovery workflow. Root Prisma/API descriptions above describe the retained local prototype, not the hosted storage/write path. No production seed or reset runs.
