# Hosted decision insights and quality review

As built on `feature/restore-decision-insights`, 2026-10-30. Issue #20. Independent review precedes merge/deployment; live version 9 is the previous sorting release.

## Existing model and restored summaries

FIFO purchase valuation, reliable-data rules and A–F thresholds remain in `site/lib/ledger/analytics.ts`. Each derived row now also exposes its source purchase gross, stored note and optional reinvestment provenance for presentation. A > +5 percentage points; B −5 through +5; C −15 through below −5; D −25 through below −15; F below −25. No annual skill or portfolio total-return model is added.

`site/lib/ledger/decision-insights.ts` restores original summary semantics. For scorable filtered purchases, grade points are A4/B3/C2/D1/F0. Unweighted GPA, beat rate and alpha are arithmetic means. Weighted versions use `abs(source purchase grossAmount)` for the denominator and each term; the beat indicator is alpha strictly greater than zero. Separately represented fees, current market values and fee-inclusive FIFO invested cost are not summary weights. These are decision outcomes, not a weighted portfolio return.

Defaults: unweighted, include closed, hide marked reinvestments. Benchmark remains selectable SPY/QQQ. Filters affect table, summary and timeline together. Missing/non-finite/ungraded outcomes remain visible but are excluded from aggregates/timeline, with graded/displayed coverage. Zero-weight observations cannot enter weighted aggregates. Empty/no-scorable results display unavailable rather than F or zero. Decisions initially sort by alpha descending, then retain tri-state sorting. Sorting never changes aggregates or chart chronology.

## Timeline meaning

Each point is a currently measured purchase outcome placed at its BUY date. The label states the measurement date and purchase-date grouping. The rolling line is the unweighted arithmetic mean of that point and up to four preceding filtered scorable purchases; the first four points use the available prefix. Weighting mode never changes it. Same-day observations preserve the legacy alpha-descending input convention and stable equal-alpha ties. This is neither a time series of point-in-time skill nor an annual grade.

## Reinvestment provenance and compatibility

The shared normalizer already recognizes reinvestment descriptions/types (including its existing bulk-equity/order-allocation conventions). Future hosted BUY imports preserve that recognition as optional `reinvestment: {source: 'broker-description'}` while retaining the full broker description in `notes`. This is parser provenance, not independent verification of broker semantics. It survives validated command, edit and JSON backup paths; it is rejected on non-BUY events. Existing exact legacy `Dividend Reinvestment` notes remain recognized read-only. Other older descriptions are not silently reclassified, and existing records are never backfilled.

The field is optional within the existing version-1 ledger JSON; no D1 schema migration. Accounting engines ignore it. Stable generic fingerprints and Robinhood raw-source identities do not include it, so previously imported activity remains duplicate-compatible. The transaction editor preserves existing metadata when editing a BUY and removes it when explicitly changing the event type away from BUY.

## Overview and Holdings

Overview retains its portfolio metrics, performance chart, ownership section and positions table. Holdings renders its full sortable positions table without duplicating Overview metrics/performance/ownership. The theme and navigation entries remain intact. Recorded cash replaces the ambiguous Cash available label; this app's ledger cash is not buying power.

## Runtime quality conditions

`site/lib/ledger/data-quality.ts` derives active conditions without mutations or private literals. `data-quality-panel.tsx` displays each condition's affected metrics and next action:

- Statement-unverified reconstructed cash: review same-date brokerage/crypto/unsettled cash and borrowing components in Settings; stored owner assignments are used as recorded.
- Activity before funding and historical negative recorded cash: dates derive from chronological events, even if current cash is positive. Review source coverage rather than invent a deposit.
- Historical reconstructed price-set provenance: show the runtime count/date range. Existing JSON lacks per-price verification status, so neither proxy resolution nor certification is guessed from prose.
- Missing/stale current holding quotes or unknown open option multipliers: explain unavailable/estimated values, retain the partial known-priced value, and provide refresh/position/transaction actions.
- Ungraded purchases: state exclusion and provide benchmark-history action.

Provider/daily-close/price-return methods, converted-lot coverage and historical option limitations are contextual details. Closed contracts alone do not trigger an open-option warning. Freeform reconstruction notes remain collapsed provenance, explicitly not a list of unanswered ownership questions. Resolving data conditions requires source evidence; this presentation change does not certify unresolved cash/history, classify prose as resolved, change owner assignments or write financial records.

## Verification

`site/tests/decision-insights.test.ts` covers gross-vs-fee weight parity, GPA/grade boundaries, missing/closed outcomes, all filters, empty states, timeline windows/ties, sorting invariance, future metadata/identity compatibility and runtime conditions. `site/tests/service.test.ts` adds real preview→command→backup/edit persistence with a separate synthetic database. Existing financial/import/sorting suites remain required.

Synthetic local browser checks verified weighting changes KPIs without changing chart paths, sorting invariance, marked/closed filters, benchmark labels, dedicated Holdings/preserved Overview, unavailable holdings with partial valuation and 2-graded-of-3 coverage plus warning navigation. No actual financial data was changed. Production verification waits for review/release.
