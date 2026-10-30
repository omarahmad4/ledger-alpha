# Private LedgerAlpha Site

Created: 2026-10-29. Status: Implemented and privately deployed; GitHub push blocked. Owner: Codex.

## Goal
Make the existing pooled portfolio usable privately across devices without a running personal computer.

## Verified starting point
Master e0e7610; one open issue, #7 (external crypto ingestion), is unfinished. Issues #14–16 are closed, but the checked-in code still has withdrawal sign, split conversion and missing-price risks. No local checkout or personal ledger found in this task workspace.

## Decisions
Add a self-contained `site/` Vinext/Worker application alongside the local Prisma application, sharing the pure accounting engines. D1 stores a user-scoped ledger document with optimistic revision checks, atomic writes and bounded recovery snapshots. This preserves the old local project and avoids unsupported SQLite files or interactive database transactions in Workers. A private platform access policy and ChatGPT identity protect the Site. No invented holdings in the personal ledger. A labeled, read-only demo is separate.

## Scope and phases
1. Host/auth/storage: durable user-scoped D1, append-only schema migration, revision conflict handling.
2. Accounting: validated chronological replay, positive withdrawal unit quantities, ratio-defined splits, reliable historical or explicitly supplied pre-flow NAV, no missing-price zero totals.
3. Experience: dashboard/holdings/FIFO decisions, transactions and edits, CSV preview/atomic retry-safe import, partners, portable export/recovery, mobile layout, quote refresh/freshness.
4. Validate/deploy/push: unit/accounting regressions, type/lint/build, browser journeys, private deployment and exact pushed commit verification.

## Verification
Run original accounting/import/provider/scoring tests, new Site tests, TypeScript, ESLint, Worker build, local D1/browser checks and native Sites deployment/access inspection. Test synthetic data only; no production reset/seed. Check import repeat, concurrent revision conflict, withdrawal, split, missing quotes, invalid rows, unauthorized access and export/recovery.

## As-built documentation
Update README and PRD accounting/data/market documentation plus `docs/sites-hosting.md` with architecture, setup, limits, recovery and repeatable updates. No change to local database migration history.

## Changelog
2026-10-29: Inspected repository/docs/issues, selected isolated hosted application and shared accounting, registered a private Site and started dependency installation.

2026-10-29: 43 hosted tests and 13 original tests pass; root/Site type checks and lint pass. Production Worker built and privately deployed. Native access and D1 schema verified; anonymous requests return 401. Browser QA covered mobile, manual entry/edit, CSV repeat and historical quotes using disposable synthetic local data. Owner production sign-in requires the account holder; no personal data was entered. GitHub publishing/CI remains blocked by repository integration write permissions; code is preserved on the local feature branch.

2026-10-29 independent review follow-up: reconcile inferred and explicit splits by symbol/date and normalized economic ratio; infer only on open positions using preceding split history; reject unsafe restored partner identifiers and non-finite accounting at replay/storage boundaries. Added exact parser-to-D1 regressions, updated historical build-notes banner and retained the GitHub write-access block.

2026-10-29 second independent rereview follow-up: moved inferred-event maintenance into a common pre-replay step for manual corrections and restoration. Full backdated closures remove obsolete derivations, partial edits retain/reinstate applicable known inferences, explicit actions remain intact, and added/removed counts are shown after saving/restoring. Added eight exact/adjacent regressions (79 local hosted-application tests in total).
