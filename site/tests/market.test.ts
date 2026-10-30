/** D1 market-cache tests with a synthetic provider: stale fallback, currency rejection and incremental split-aware history. */
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { env } from './worker-env';
import { testDatabase } from './d1';
const mock=vi.hoisted(()=>({chart:vi.fn()}));
vi.mock('yahoo-finance2',()=>({default:class {chart=mock.chart;}}));
import { latestQuote,history,cachedHistory } from '../lib/server/market';
/** Provider-shaped synthetic daily price result. */
function result(price=100,quotes=[{date:new Date('2026-10-23'),close:100}],splits:{date:Date;numerator:number;denominator:number}[]=[]){return {meta:{currency:'USD',regularMarketPrice:price,regularMarketTime:new Date('2026-10-28T20:00:00Z')},quotes,events:{splits}};}
beforeEach(()=>{env.DB=testDatabase();mock.chart.mockReset();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-29T04:00:00Z'));});
afterEach(()=>vi.useRealTimers());
describe('honest quote freshness',()=>{
  it('caches successful requests for five minutes and discloses a failed refresh',async()=>{mock.chart.mockResolvedValueOnce(result(123));const first=await latestQuote('TEST');expect(first.status).toBe('fresh');expect((await latestQuote('TEST')).status).toBe('cached');expect(mock.chart).toHaveBeenCalledTimes(1);vi.setSystemTime(new Date('2026-10-29T04:06:00Z'));mock.chart.mockRejectedValue(new Error('Provider offline'));const stale=await latestQuote('TEST');expect(stale.price).toBe(123);expect(stale.status).toBe('stale');expect(stale.fetchedAt).toBe(first.fetchedAt);await latestQuote('TEST');expect(mock.chart).toHaveBeenCalledTimes(2);});
  it('never substitutes zero when provider and cache are unavailable',async()=>{mock.chart.mockRejectedValue(new Error('Provider offline'));const q=await latestQuote('NONE');expect(q.price).toBeNull();expect(q.status).toBe('unavailable');});
  it('rejects non-USD data instead of quietly treating it as dollars',async()=>{mock.chart.mockResolvedValue({...result(),meta:{...result().meta,currency:'GBP'}});expect((await latestQuote('GBP')).status).toBe('unavailable');});
  it('marks very old market timestamps stale even after a successful fetch or cache hit',async()=>{mock.chart.mockResolvedValue({...result(),meta:{...result().meta,regularMarketTime:new Date('2026-01-01')}});expect((await latestQuote('OLD')).status).toBe('stale');expect((await latestQuote('OLD')).status).toBe('stale');});
});
describe('historical refresh',()=>{
  it('keeps old rows while incrementally extending the series after cache expiry',async()=>{mock.chart.mockResolvedValueOnce(result(100,[{date:new Date('2026-10-23'),close:100}]));await history('TEST','2026-10-23');vi.setSystemTime(new Date('2026-10-30T04:00:00Z'));mock.chart.mockResolvedValueOnce(result(120,[{date:new Date('2026-10-29'),close:120}]));const series=await history('TEST','2026-10-23');expect(series.map(p=>p.day)).toEqual(['2026-10-23','2026-10-29']);expect(mock.chart.mock.calls[1][1].period1).toBe('2026-10-22');await history('TEST','2026-10-23');expect(mock.chart).toHaveBeenCalledTimes(2);});
  it('stores raw event-day prices while preserving split-adjusted benchmark closes',async()=>{mock.chart.mockResolvedValueOnce(result(100,[{date:new Date('2020-08-01'),close:25}],[{date:new Date('2020-08-31'),numerator:4,denominator:1}]));await history('TEST','2020-08-01');const points=await cachedHistory('TEST');expect(points[0].close).toBe(25);expect(points[0].rawClose).toBe(100);});
  it('preserves cached history during a provider outage',async()=>{mock.chart.mockResolvedValueOnce(result());await history('TEST','2026-10-23');vi.setSystemTime(new Date('2026-10-30T04:00:00Z'));mock.chart.mockRejectedValue(new Error('offline'));expect(await history('TEST','2026-10-23')).toEqual([{day:'2026-10-23',close:100,rawClose:100}]);});
});
