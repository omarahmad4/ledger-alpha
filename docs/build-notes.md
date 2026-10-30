> **Historical notes — legacy local prototype.** This file records an earlier development stage and is not the current hosted specification. For the implemented private Site, accounting/import behavior and deployment/recovery instructions, use [the as-built hosting guide](sites-hosting.md).

# Build Notes

## Product direction

The application is a ledger-first internal tool. Every view should derive from normalized transactions and allocations, not from hand-edited balances.

## Accounting model

- Holdings page uses weighted-average basis for summary clarity.
- Decisions page uses FIFO lots for cohort/decision grading.
- Sales reduce lots FIFO.
- Dividends, fees, deposits, and withdrawals are represented in the schema but not fully surfaced in analytics yet.

## Current benchmark state

Decision grading currently uses a placeholder benchmark return. Replace this with real BenchmarkSnapshot lookups:

- Store SPY, QQQ, BTC, ETH values by date.
- For each buy lot, calculate how many benchmark units the same invested amount would have bought on the trade date.
- Compare current actual value vs current benchmark value.

## Robinhood import state

The import preview endpoint parses pasted CSV text and normalizes likely Robinhood-style columns. It does not commit rows yet because duplicate detection and asset mapping should be confirmed first.
