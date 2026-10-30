/** Run isolated hosted ledger regression tests without starting a Worker or touching any durable database. */
import { defineConfig } from 'vitest/config';
export default defineConfig({resolve:{alias:{'cloudflare:workers':new URL('./tests/worker-env.ts',import.meta.url).pathname}},test:{include:['tests/**/*.test.ts'],environment:'node'}});
