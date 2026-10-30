# LedgerAlpha

> **Private hosted edition:** The new `site/` application runs as an owner-private ChatGPT Site with durable D1 storage, validated manual entry/editing, atomic retry-safe CSV imports, honest missing/stale price handling, JSON recovery and a mobile UI. Start with [the hosting guide](docs/sites-hosting.md). The original local Next/Prisma prototype below remains separate and must not be exposed as a production server. No personal ledger data is seeded into the hosted edition.


A local-first portfolio analytics application for tracking ownership, performance, and investment decisions within a shared brokerage account.

LedgerAlpha was created to solve a problem traditional brokerage dashboards do not address well: multiple people contributing to one investment account at different times and in different amounts.

Rather than dividing the account equally, LedgerAlpha uses a unitized pool model to calculate each partner’s economic ownership as the portfolio changes.

## What It Does

### Pooled Ownership Accounting

Each deposit purchases units in the shared portfolio based on its value at that time. This makes it possible to track:

- Different contribution amounts
- Partners joining at different times
- Changing ownership percentages
- Each partner’s share of cash and investments
- Partner-level portfolio value and returns

Trades occur at the portfolio level, while their value is distributed according to each partner’s current ownership share.

### Robinhood CSV Import

LedgerAlpha can import Robinhood-style account activity from a CSV file.

The import workflow:

1. Parses and normalizes brokerage activity
2. Separates deposits and withdrawals from trades
3. Lets the user assign cash flows to the appropriate partner
4. Detects duplicate transactions
5. Creates new assets when necessary
6. Commits the reviewed activity to the portfolio ledger

The importer recognizes purchases, sales, deposits, withdrawals, dividends, fees, stock splits, and several Robinhood transaction codes.

### Portfolio Dashboard

The dashboard provides an account-level overview including:

- Total portfolio value
- Capital contributed
- Portfolio gains and losses
- Cash balance and cash drag
- Allocation across stocks, ETFs, cryptocurrency, and cash
- Portfolio value by partner
- Investment decision beat rate versus the S&P 500

### Partner and Portfolio Holdings

Holdings can be viewed either as a consolidated portfolio or by individual partner.

Each view includes:

- Pool units and ownership percentage
- Asset quantity
- Current market price
- Market value
- Cost basis
- Gains and losses
- Investment return

### Performance Benchmarking

LedgerAlpha compares the portfolio’s unit-level performance with the S&P 500 using SPY.

Because performance is calculated through net asset value per pool unit, deposits made by different partners do not artificially inflate the portfolio’s reported investment return.

### Investment Decision Scorecards

Every purchase is treated as an investment decision and compared with investing the same capital in SPY on the same date.

Each decision includes:

- Actual return
- Equivalent SPY return
- Excess return, or alpha
- Current or closed status
- Letter grade from A to F

The Decisions dashboard also provides:

- Decision beat rate
- Average decision grade
- Average excess return
- Value-weighted and unweighted analysis
- A timeline showing how decision quality changed over time

### FIFO Lot Tracking

Sales are matched against the earliest available purchase lots using FIFO accounting.

This allows LedgerAlpha to evaluate both active positions and investments that have been partially or fully sold.

## Technology

- TypeScript
- Next.js and React
- Prisma ORM
- SQLite
- Yahoo Finance market data
- Recharts
- Papa Parse
- Zod
- Vitest
- Playwright
- Docker

## Application Structure

```text
app/                     Next.js pages, API routes, and UI components
components/              Shared interface components
lib/accounting/          Pool ownership, holdings, and FIFO calculations
lib/data/                Ledger and analytics data services
lib/market-data/         Current and historical market-price retrieval
lib/robinhood-import/    CSV normalization
lib/scoring/             Investment decision grading
prisma/                  Database schema, migrations, and sample data
tests/                   Accounting and import unit tests
e2e/                     Browser-based workflow tests
docs/                    Product, accounting, and architecture documentation
```

## Getting Started

### Requirements

- Node.js 20 or later
- npm

### Installation

```bash
git clone https://github.com/omarahmad4/ledger-alpha.git
cd ledger-alpha

cp .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
```

To populate a new development database with synthetic sample data:

```bash
npm run prisma:seed
```

> Seeding replaces the contents of the configured database. Only run it against a new or disposable development database.

Start the application:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Testing

```bash
npm test
npm run lint
npm run test:e2e
```

## Product Motivation

I built LedgerAlpha after encountering a shared-account problem that conventional brokerage dashboards were not designed to solve.

The project reflects the kind of product work I enjoy: beginning with a real user problem, defining the underlying business and accounting rules, and translating complicated data into a practical decision-making experience.

It also gave me an opportunity to explore portfolio accounting, financial benchmarking, data visualization, and AI-assisted product development within a full-stack application.

## Current Scope

LedgerAlpha is currently a local, single-account analytics application. It does not execute trades, provide automatic brokerage synchronization, support production user accounts, or offer tax and investment advice.

## Disclaimer

LedgerAlpha is an educational portfolio-analysis project. It does not provide investment, financial, tax, accounting, or legal advice.
