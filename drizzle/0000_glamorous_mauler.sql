CREATE TABLE `card_progress` (
	`card_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`last_rating` text NOT NULL,
	`interval_days` integer DEFAULT 0 NOT NULL,
	`due_at` integer NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`reviewed_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_card_progress_owner_due` ON `card_progress` (`owner_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`front` text NOT NULL,
	`back` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cards_deck_position` ON `cards` (`deck_id`,`position`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_decks_owner_updated` ON `decks` (`owner_id`,`updated_at`);--> statement-breakpoint
PRAGMA optimize;
