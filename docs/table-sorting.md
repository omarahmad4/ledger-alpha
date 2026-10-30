# Table sorting

As built on the review branch, 2026-10-30. Tracking: [#18](https://github.com/omarahmad4/ledger-alpha/issues/18). Deployment is a separate review/release step.

Each meaningful data header cycles ascending → descending → off. A different column starts ascending. Each table has independent state; switching views preserves its current sort. Native header buttons support Enter and Space, show ↑/↓/↕ and expose `aria-sort` on column-scoped headers. Action buttons are not sortable data.

`site/lib/ui/table-sort.ts` is the pure shared comparator. Numbers compare numerically, dates by their parsed time, and text with a case-insensitive natural collator. Empty, invalid and non-finite values are missing, remain last in both directions and never become zero. Equal values preserve input order. Off returns a copied canonical input order. No source array is mutated.

| Hosted table | Sortable data columns | Canonical source |
| --- | --- | --- |
| Holdings, shared with Overview | Asset, quantity, price, quote status, quote date, market value, gain/loss, return, weight | Summarized holdings |
| Transactions | Date, activity, asset/partner, quantity, received quantity, gross amount, fee, note | Search-filtered reverse recorded order |
| Decisions | Asset, buy date, status, invested, value + proceeds, return, benchmark return, excess return, grade | Filtered existing decision rows |
| Import preview | Record, date, type, symbol, amount, cash-flow partner, status | Original preview record order |

Transactions sort the complete filtered collection before the 100-row display window. Changing sort resets that window. Searching and changing views retain existing pagination reset behavior. Import preview retains stable record keys, row-based ownership selections and the canonical `preview.rows` used by commit. Sorting is never submitted as chronology or as a ledger command.

Combined cells were separated where a header otherwise could not describe all their numeric/status data. Underlying accounting, quote acquisition, grades, model warnings, navigation and persisted ledger formats are unchanged.

The legacy `components/tables/SortableTable.tsx` hook reuses the pure comparator while retaining its own package's React hooks. This fixes stable missing-value ties and gives existing legacy sortable headers native keyboard controls. Legacy table definitions cover dashboard, holdings, transactions, decisions and the two import tables. A constant Pool allocation and action controls remain nonsortable.

## Validation

`site/tests/table-sort.test.ts` covers tri-state cycling, typed numbers/dates, stable missing values/ties, immutable off reset, accessible header markup, all hosted column accessors, sorting before pagination and canonical preview replay/identities. Local browser QA exercised all 33 hosted data headers with Enter, Space and mouse; synthetic import amounts sorted as $10, $100, $200 and returned to original order. No import was committed during that check. Root and Site type/lint/unit checks and the Worker build are required before release.
