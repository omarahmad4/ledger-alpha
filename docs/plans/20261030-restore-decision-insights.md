# Restore hosted decision insights

Created: 2026-10-30. Owner: Codex. Status: implementation. Issue: #20. Base: merged PR19.

## Goal and verified scope
Restore demonstrably omitted legacy decision summaries, filters and timeline; preserve reliable-data exclusions, existing grades and accounting. Keep Overview intact while Holdings becomes a dedicated positions view. Make quality messages runtime-derived and actionable. No actual financial-data rewrites, annual skill model, ETF lookup, history cleanup or audience changes.

## Decisions and architecture
Legacy summaries weight by absolute original purchase gross, not current value or fee-inclusive invested cost. Grade points A4/B3/C2/D1/F0; beat means alpha strictly greater than zero. Defaults remain unweighted, hide marked reinvestments and include closed. The timeline displays current measured alpha at buy dates with an unweighted trailing five-decision mean; weighting never changes it. Missing/ungraded observations are excluded from aggregates, kept visible in the table and counted in coverage. Empty aggregates are unavailable.

Future recognized broker reinvestments carry explicit optional metadata alongside the original description. Existing exact legacy notes remain recognized read-only; no existing records are reclassified or rewritten. The optional field survives validated edits, backup and import without changing identity or cash accounting.

Quality conditions derive from ledger/quote/analytics state; dates, symbols and counts come from data, never private literals. Cash and historical coverage remain explicit. Legacy freeform reconciliation notes stay collapsed as provenance rather than unresolved owner-confirmation questions. No inference of resolution from prose.

## Execution and verification
1. Add/test pure parity summaries, timeline, filter metadata and optional validated reinvestment provenance.
2. Restore hosted controls, KPI cards and chart; retain sorting, benchmarks, closed positions, empty/missing states and theme.
3. Restrict overview panels to Overview; preserve its full existing layout and Holdings table.
4. Add/test dynamic quality conditions and contextual model/provenance details with relevant view/refresh actions.
5. Update as-built docs and README, run root/Site unit/type/lint, build, privacy guard and synthetic local browser checks.
6. Commit/push a separate draft PR; independent review precedes merge/deployment.

## Success criteria
Synthetic tests verify unequal gross weights including fee distinction, all grade/aggregate thresholds, closed/missing inputs, filters, five-point prefixes, same-day timeline ties, sorting invariance, future marker persistence and legacy identity compatibility. Browser checks verify controls/benchmark labels, table/chart/KPI consistency, dedicated Holdings and warning actions. Runtime ledger data and deployed version9 remain untouched during development.
