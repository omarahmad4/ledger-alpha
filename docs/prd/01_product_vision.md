# LedgerAlpha - Product Vision & V1 Scope

LedgerAlpha is a local-first investment tracker and pooled portfolio ledger. It is designed to solve a specific problem: tracking the true economic ownership and decision performance of a single brokerage account (initially Robinhood) whose assets are shared among multiple partners (Partner 1, Partner 2, Partner 3).

---

## 1. Product Thesis
Most portfolio trackers only answer: *"What is my portfolio worth?"*
LedgerAlpha answers: *"Who deposited what, what did that money buy, how is the ownership divided, and did our investment decisions actually beat a passive benchmark?"*

It shifts the focus from passive balance tracking to **ledger-based economic ownership** and **decision scorecards**.

---

## 2. Key V1 Product Features

### A. Unitized Fund Pool Model
- Instead of manually splitting every individual trade (which is tedious and error-prone), the ledger tracks deposits and withdrawals of cash to establish ownership units (similar to a mutual fund or hedge fund).
- Any stock or crypto purchases are conducted at the portfolio level, and their economic performance is automatically distributed according to each partner's current unit share.

### B. FIFO Lot & Decision Scoring
- Each purchase is tracked as a distinct "lot/cohort".
- Each lot is evaluated against a historical benchmark (e.g. SPY, QQQ, BTC) on the exact date of purchase to assign a grade (A, B, C, D, F).
- Trimmed positions are resolved using a FIFO (First In, First Out) reduction method.

### C. Manual & Robinhood CSV Import
- Easy manual entry for day-to-day updates.
- An import preview parser that accepts pasted Robinhood transaction CSV activity exports, normalizes them, detects duplicates, and maps them to database assets.

### D. Zero-Cost, Local-First Architecture
- SQLite database stored locally.
- Free EOD historical price and quote fetches using `yahoo-finance2`.
- Next.js server components running on `localhost:3000`.

---

## 3. Target Audience
- **Primary Operator**: Partner 1 (handles CSV imports, enters manual entries, analyzes decision scoring).
- **Partners**: Partner 2 & Partner 3 (receive accurate cost-basis tracking, position value breakdown, and allocation summaries).


## Hosted edition (2026-10-29)

The supported cross-device edition lives in `site/` and uses private ChatGPT sign-in plus user-scoped D1 records. See [the as-built hosting specification](../sites-hosting.md) for its data model, accounting replay, prior-session cash-flow pricing, split conventions, atomic import/deduplication, quote freshness, storage bounds and recovery workflow. Root Prisma/API descriptions above describe the retained local prototype, not the hosted storage/write path. No production seed or reset runs.
