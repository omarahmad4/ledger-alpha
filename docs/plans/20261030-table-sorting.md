# Accessible hosted table sorting

Created/updated: 2026-10-30. Status: review branch implementation. Owner: Codex. GitHub issue: #18.

## Goal and verified starting point

Restore predictable sorting to the hosted workspace, where four table definitions lacked it. The legacy app already had sorting, but clickable headers lacked keyboard semantics and both-missing comparisons did not preserve ties reliably. No schema, financial model or ledger-data change is needed.

## Scope and decisions

Use one pure stable comparator across editions and a separate hosted React controller/header. Typed accessors read existing values; no sorting operation writes data. Expose separate numeric/status columns rather than compare rendered currency or combined cells. Keep each table's state independent. Preserve missing values last in both directions, ties and the canonical order when off. Transactions sort before pagination. Import commit continues using canonical preview rows.

Broader navigation, analytics restoration and scoring proposals have a separate review boundary and are not part of this sorting release. No unresolved choice prevents implementing #18.

## Implementation and verification

1. Add the shared comparator and accessible native-button headers; regression-test typed values, stable ties, missing values and off reset.
2. Connect all hosted columns and the legacy shared hook; test transaction pagination and import identities/replay order.
3. Verify each hosted header by keyboard/mouse in an isolated synthetic preview; preserve actual hosted records.
4. Update as-built sorting/hosting docs, check source and reachable history, run both test/type/lint suites and the production Worker build.
5. Commit on the feature branch and open a draft PR closing #18. Keep merge and Site publication pending review.

## Architecture, documentation and risks

No API, database migration or public hosting change. Shared sort types live in `site/lib/ui/`; legacy imports only the pure module to avoid crossing React runtimes. `docs/table-sorting.md` is the behavior/test inventory. No `docs/current/` or `docs/styleguide/` directory exists in this repository, so existing documentation paths are used. UI horizontal scrolling accommodates the separated columns. Synthetic fixtures and private-source guards reduce accidental data publication; no automated scanner guarantees privacy.

## Success criteria and rollout

- All 33 meaningful hosted data columns cycle ascending/descending/off with visible and accessible state.
- Typed numeric/date/text comparisons, missing-last, stable ties and copied off reset pass unit tests.
- Transaction pagination and import canonical-order/identity regressions pass.
- Root and Site test/type/lint checks plus production build pass before publication.
- Draft PR is reviewable; no automatic merge or Site redeployment.

2026-10-30: Source/issue parity investigation completed, bounded implementation and synthetic browser checks performed; wider analytics/navigation proposals retained for review.
