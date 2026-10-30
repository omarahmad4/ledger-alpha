# LedgerAlpha

LedgerAlpha makes a shared investment account understandable: who owns what, how that ownership changes when someone adds money, and how individual purchases compare with a benchmark.

I started with a gap in ordinary brokerage dashboards. An account can contain money contributed by several people at different times, but its balance alone does not explain each person's share. Dividing today's balance by total contributions also gives misleading results when the investments changed value between deposits.

The product uses a unitized pool. Contributions buy units at the portfolio value immediately before the cash flow; withdrawals redeem units. Trades belong to the pool, while units determine each partner's economic share.

## The experience

The active application is the private hosted edition in [`site/`](site/README.md). It provides ChatGPT sign-in, an owner-private access policy and a separate durable ledger for each authenticated user. A running personal computer is unnecessary. Prices refresh on opening the workspace or on request, with a five-minute cache; this is not a continuous market feed.

The main workflows are:

- **Understand the account:** portfolio value, cash, contributions, gains, a unit-price performance chart and partner ownership.
- **Inspect positions:** quantities, quote freshness, remaining FIFO basis, value, gains and portfolio weight.
- **Reconstruct activity:** manual transactions or a CSV preview with explicit cash-flow owners, source chronology and duplicate detection. Invalid batches save nothing.
- **Review purchases:** FIFO purchase cohorts compared with SPY or QQQ, including realized proceeds and the remaining position. Grades are benchmark-relative price-return outcomes, not a measure of investment skill.
- **Keep control of the records:** editable partners, portable JSON backups, CSV reporting and revision-based recovery.

Tables support stable ascending, descending and off sorting, including keyboard controls. Missing values stay last. Sorting an import preview changes its display, while the import retains its selected source order and record identities.

## A simple ownership example

These figures are synthetic. Alex contributes $1,000 at a unit price of $1 and receives 1,000 units. The pool rises to $1,200, so each unit is worth $1.20. Sam then contributes $600 and receives 500 units. Alex owns two-thirds of the resulting pool and Sam owns one-third. Sam's arrival does not create a return for Alex.

This rule makes contribution timing explicit. It also makes historical valuation important: incomplete funding history or uncertain cash-flow valuations can affect every later ownership calculation. The interface keeps those assumptions visible rather than promising precision the source records cannot support.

## Product and engineering decisions

| Decision | Why it matters | Tradeoff |
| --- | --- | --- |
| Unit-based ownership | Separates contributions from investment performance | Requires reliable pre-flow portfolio values |
| Preview, validate and replay an entire import | Prevents partial histories and inconsistent ownership | Ambiguous or unsupported rows require review |
| User-scoped D1 storage and revision checks | Supports cross-device use, atomic backups and conflicting browser edits | Each personal ledger is bounded to 5,000 transactions / 1.5 MB |
| Missing prices remain unavailable | Avoids treating an unknown holding as worthless | Some totals and decision grades are withheld |
| Manual records and CSV imports | Avoids collecting brokerage credentials | No automatic brokerage synchronization |
| Separate Worker application | Fits the Sites runtime while retaining the original local prototype | Feature parity must be checked explicitly between editions |

The hosted application uses React, TypeScript, Vinext/Cloudflare Workers, D1, Zod, Papa Parse and Recharts. Pure accounting modules are shared with the original Next.js/Prisma prototype. Identity, validation and persistence stay on the server. Economic partners are separate from login identities; inviting someone to the Site does not share another user's ledger.

## Current boundaries and known gaps

The original local prototype still exists under root `app/`, `components/`, `lib/` and `prisma/`. It includes weighted/unweighted decision summary metrics and a decision-quality timeline that have not yet been ported into the hosted edition. The hosted Overview and Holdings layouts also overlap. ETF constituent look-through is described in issues [#15](https://github.com/omarahmad4/ledger-alpha/issues/15) and [#16](https://github.com/omarahmad4/ledger-alpha/issues/16), but no implementation is present in the reachable repository history inspected for this review. These are gaps, not shipped hosted features.

Market data uses unofficial Yahoo sources and may be delayed or unavailable. Historical daily closes approximate intraday cash flows. Decision benchmarks exclude dividends; stale/missing inputs and unverified corporate-action continuity can leave purchases ungraded. LedgerAlpha records analysis only: it cannot execute trades, and it is not a tax reporting system.

There are no published user research results or measured business outcomes claimed here. The repository documents the problem, working behavior, technical tradeoffs and remaining limitations so the product can be assessed from evidence.

## Run and verify

Use Node 24 for the hosted application. Setup, local database migrations and the private publication workflow are in [the hosting guide](docs/sites-hosting.md).

```sh
npm ci
npm test
npx tsc --noEmit
npm run lint
npm run privacy:check -- --history
cd site
npm run install:ci
npm test
npm run typecheck
npm run lint
npm run build
npm run dev
```

Root tests exercise shared accounting and the repository privacy guard; Site tests cover financial replay, imports, corporate actions, valuations, APIs and sorting. Local browser checks use synthetic records in a separate local database. Never seed a populated or production database. The original local Prisma server has no production access-control boundary and should stay local; its E2E tests require an explicitly disposable database.

Keep actual transactions, names, balances, environment credentials, exports and screenshots outside public source. The offline privacy guard blocks selected credential patterns and private-file formats; it complements source/history review and cannot prove that arbitrary prose contains no personal information.

## Building with AI

I use AI-assisted development to turn the product rules into working software, tests and documentation. Codex and earlier coding agents contributed implementation and iteration. The source history and tests provide the inspectable record; the portfolio framing does not imply that I manually authored every line or that automated tests establish financial accuracy.

See [the accounting specification](docs/prd/02_accounting_model.md), [hosting architecture](docs/sites-hosting.md) and [sorting specification](docs/table-sorting.md) for implementation detail.
