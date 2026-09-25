CREATE TABLE `race_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_token` text NOT NULL,
	`guest_token` text,
	`track_id` text NOT NULL,
	`laps` integer NOT NULL,
	`phase` text DEFAULT 'waiting' NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`host_name` text NOT NULL,
	`host_color` text NOT NULL,
	`guest_name` text,
	`guest_color` text,
	`guest_ready` integer DEFAULT 0 NOT NULL,
	`host_seen_at` integer NOT NULL,
	`guest_seen_at` integer,
	`expires_at` integer NOT NULL,
	`closed_reason` text,
	`snapshot` text,
	`snapshot_seq` integer DEFAULT -1 NOT NULL,
	`input` text,
	`input_seq` integer DEFAULT -1 NOT NULL,
	`offer` text,
	`answer` text
);
--> statement-breakpoint
CREATE INDEX `idx_race_rooms_expires` ON `race_rooms` (`expires_at`);