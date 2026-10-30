/** Durable Site records: user-scoped ledgers, bounded recovery copies and public-market cache. */
import { integer, real, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';
export const ledgers = sqliteTable('ledgers', {
  userId: text('user_id').primaryKey(), revision: integer('revision').notNull().default(0),
  data: text('data').notNull(), updatedAt: text('updated_at').notNull(),
});
export const ledgerBackups = sqliteTable('ledger_backups', {
  userId: text('user_id').notNull(), revision: integer('revision').notNull(),
  data: text('data').notNull(), createdAt: text('created_at').notNull(),
}, table => [primaryKey({columns: [table.userId, table.revision]})]);
export const marketCache = sqliteTable('market_cache', {
  symbol: text('symbol').notNull(), day: text('day').notNull(),
  close: real('close').notNull(), rawClose: real('raw_close').notNull(),
  marketTime: text('market_time').notNull(), fetchedAt: text('fetched_at').notNull(),
}, table => [primaryKey({columns: [table.symbol, table.day]})]);
export const marketSync = sqliteTable('market_sync', {
  symbol: text('symbol').primaryKey(), start: text('start').notNull(),
  end: text('end').notNull(), fetchedAt: text('fetched_at').notNull(),
  splits: text('splits').notNull().default('[]'),
});
