CREATE TABLE IF NOT EXISTS newsletter_movies (
  douban_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  title VARCHAR(512) NULL,
  `type` VARCHAR(255) NULL,
  year VARCHAR(32) NULL,
  area VARCHAR(255) NULL,
  director TEXT NULL,
  actors TEXT NULL,
  description MEDIUMTEXT NULL,
  poster VARCHAR(1024) NULL,
  score DECIMAL(3,1) NULL,
  votes BIGINT UNSIGNED NULL,
  tier VARCHAR(32) NULL,
  sort_rank INT UNSIGNED NOT NULL UNIQUE,
  metadata_status ENUM('pending','ready') NOT NULL DEFAULT 'pending',
  metadata_source VARCHAR(1024) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT newsletter_movie_id CHECK (douban_id REGEXP '^[0-9]+$'),
  CONSTRAINT newsletter_movie_rank CHECK (sort_rank > 0),
  CONSTRAINT newsletter_movie_score CHECK (score IS NULL OR score BETWEEN 0 AND 10),
  CONSTRAINT newsletter_movie_poster CHECK (poster IS NULL OR poster = '' OR BINARY poster REGEXP '^https://04320[.]com/newsletter-images/[a-f0-9]{64}[.](jpg|png|webp)$'),
  CONSTRAINT newsletter_movie_ready CHECK (metadata_status <> 'ready' OR (
    COALESCE(TRIM(title), '') <> '' AND COALESCE(TRIM(`type`), '') <> '' AND
    COALESCE(TRIM(year), '') <> '' AND COALESCE(TRIM(area), '') <> '' AND
    COALESCE(TRIM(director), '') <> '' AND COALESCE(TRIM(actors), '') <> '' AND
    COALESCE(TRIM(description), '') <> '' AND COALESCE(TRIM(poster), '') <> '' AND
    COALESCE(TRIM(metadata_source), '') <> ''
  ))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS newsletter_movie_links (
  douban_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  source_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  vod_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT newsletter_link_movie FOREIGN KEY (douban_id) REFERENCES newsletter_movies(douban_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
