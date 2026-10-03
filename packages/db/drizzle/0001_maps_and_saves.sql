CREATE TABLE `maps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`tiles` text NOT NULL,
	`spawn_x` integer NOT NULL,
	`spawn_y` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saves` (
	`user_id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`map_id`) REFERENCES `maps`(`id`) ON UPDATE no action ON DELETE no action
);
