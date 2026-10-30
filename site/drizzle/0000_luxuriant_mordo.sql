CREATE TABLE `ledger_backups` (
	`user_id` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `ledgers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_cache` (
	`symbol` text NOT NULL,
	`day` text NOT NULL,
	`close` real NOT NULL,
	`raw_close` real NOT NULL,
	`market_time` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`symbol`, `day`)
);
--> statement-breakpoint
CREATE TABLE `market_sync` (
	`symbol` text PRIMARY KEY NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`fetched_at` text NOT NULL,
	`splits` text DEFAULT '[]' NOT NULL
);
