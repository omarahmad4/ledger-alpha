# LedgerAlpha private Site

The standalone Vinext/Cloudflare Worker edition of LedgerAlpha. ChatGPT sign-in and the owner-private Sites access policy protect user-scoped D1 ledgers. No brokerage credentials or personal records are part of the source.

Use Node 24 (minimum 22.13):

```sh
npm run install:ci
npm test
npm run typecheck
npm run lint
npm run build
npm run dev -- --port 5184
```

For a new preview, build once and apply each pending `drizzle/*.sql` migration to the **local** D1 database with Wrangler before visiting the UI. Production migrations run through Sites publication. Do not replay applied migrations or seed/reset production.

The canonical accounting code is `lib/core/`, commands/validation/analytics are `lib/ledger/`, and authenticated persistence/market integration is `lib/server/`. Each ledger write atomically saves a recovery copy, checks its revision and replays accounting. The synthetic demo is read-only. Settings provides portable JSON backup/restore and CSV reports.

The Site source repository is a standalone copy of the `site/` directory in GitHub. Preserve its `.openai/hosting.json` identity and Sites build integration when updating. Publish with the current Sites skill and native owner-private deployment operation. Runtime directories, environment files, credentials and financial records must remain ignored.

See the parent repository's `docs/sites-hosting.md` for the complete as-built architecture, price/CSV limits, recovery and publication workflow. Quotes refresh on open/request with a five-minute cache; hosting is not a continuous price-feed process. Missing data stays unavailable rather than becoming a zero valuation.
