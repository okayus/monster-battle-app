CREATE TABLE `map_exits` (
	`map_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`to_map_id` text NOT NULL,
	`to_x` integer NOT NULL,
	`to_y` integer NOT NULL,
	PRIMARY KEY(`map_id`, `x`, `y`),
	FOREIGN KEY (`map_id`) REFERENCES `maps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_map_id`) REFERENCES `maps`(`id`) ON UPDATE no action ON DELETE no action
);
