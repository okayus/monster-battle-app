CREATE TABLE `appearances` (
	`user_id` text PRIMARY KEY NOT NULL,
	`skin_id` text NOT NULL,
	`part_overrides` text NOT NULL,
	`colour_overrides` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skin_id`) REFERENCES `skins`(`id`) ON UPDATE no action ON DELETE no action
);
