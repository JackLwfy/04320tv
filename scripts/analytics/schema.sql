-- Applied by a local migration account; the EdgeOne account has DML permissions only.
CREATE TABLE IF NOT EXISTS analytics_meta (
  id TINYINT UNSIGNED PRIMARY KEY,
  schema_version INT UNSIGNED NOT NULL,
  geography_started_at DATETIME(3) NULL,
  network_details_started_at DATETIME(3) NULL,
  enabled TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO analytics_meta (id, schema_version) VALUES (1, 5);

CREATE TABLE IF NOT EXISTS analytics_promotion_links (
  id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
  short_code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name VARCHAR(120) NOT NULL,
  channel VARCHAR(80) NOT NULL,
  activity VARCHAR(120) NOT NULL DEFAULT '',
  placement VARCHAR(120) NOT NULL DEFAULT '',
  creative VARCHAR(120) NOT NULL DEFAULT '',
  notes VARCHAR(1000) NOT NULL DEFAULT '',
  landing_path VARCHAR(1000) NOT NULL,
  archived TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY promotion_short_code (short_code),
  INDEX promotion_channel (channel),
  INDEX promotion_activity (activity),
  INDEX promotion_archive (archived,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_promotion_visits (
  visit_id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
  link_id CHAR(36) CHARACTER SET ascii NOT NULL,
  visitor_id CHAR(64) CHARACTER SET ascii NOT NULL,
  is_test TINYINT UNSIGNED NOT NULL DEFAULT 0,
  entered_at DATETIME(3) NOT NULL,
  last_activity_at DATETIME(3) NOT NULL,
  device VARCHAR(16) CHARACTER SET ascii NOT NULL,
  browser VARCHAR(16) CHARACTER SET ascii NOT NULL,
  page VARCHAR(64) NOT NULL DEFAULT '',
  country CHAR(2) CHARACTER SET ascii NOT NULL DEFAULT '',
  province CHAR(2) CHARACTER SET ascii NOT NULL DEFAULT '',
  city VARCHAR(96) NOT NULL DEFAULT '',
  INDEX promotion_visit_time (is_test,entered_at),
  INDEX promotion_visit_link (link_id,is_test,entered_at),
  INDEX promotion_visit_owner (visitor_id,is_test,entered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_receipts (
  event_id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
  batch_id CHAR(36) CHARACTER SET ascii NOT NULL,
  visitor_id CHAR(64) CHARACTER SET ascii NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  is_test TINYINT UNSIGNED NOT NULL DEFAULT 0,
  INDEX receipt_batch (batch_id),
  INDEX receipt_age (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
  occurred_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  visitor_id CHAR(64) CHARACTER SET ascii NOT NULL,
  session_id CHAR(36) CHARACTER SET ascii NOT NULL,
  promotion_id CHAR(36) CHARACTER SET ascii NOT NULL DEFAULT '',
  promotion_visit_id CHAR(36) CHARACTER SET ascii NOT NULL DEFAULT '',
  kind VARCHAR(32) CHARACTER SET ascii NOT NULL,
  is_test TINYINT UNSIGNED NOT NULL DEFAULT 0,
  media VARCHAR(8) CHARACTER SET ascii NOT NULL DEFAULT '',
  device VARCHAR(16) CHARACTER SET ascii NOT NULL,
  browser VARCHAR(16) CHARACTER SET ascii NOT NULL,
  source_key CHAR(64) CHARACTER SET ascii NOT NULL DEFAULT '',
  source_name VARCHAR(96) NOT NULL DEFAULT '',
  source_origin VARCHAR(8) CHARACTER SET ascii NOT NULL DEFAULT '',
  vod_id VARCHAR(100) NOT NULL DEFAULT '',
  title VARCHAR(200) NOT NULL DEFAULT '',
  episode INT UNSIGNED NULL,
  search_id CHAR(36) CHARACTER SET ascii NULL,
  query_text VARCHAR(100) NOT NULL DEFAULT '',
  status VARCHAR(16) CHARACTER SET ascii NOT NULL DEFAULT '',
  result_count INT UNSIGNED NOT NULL DEFAULT 0,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  page VARCHAR(64) NOT NULL DEFAULT '',
  referrer VARCHAR(180) NOT NULL DEFAULT '',
  campaign VARCHAR(80) NOT NULL DEFAULT '',
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  recommendation_id VARCHAR(100) NOT NULL DEFAULT '',
  network_ip VARCHAR(45) CHARACTER SET ascii NOT NULL DEFAULT '',
  country CHAR(2) CHARACTER SET ascii NOT NULL DEFAULT '',
  province CHAR(2) CHARACTER SET ascii NOT NULL DEFAULT '',
  city VARCHAR(96) NOT NULL DEFAULT '',
  network_asn INT UNSIGNED NOT NULL DEFAULT 0,
  network_operator VARCHAR(96) NOT NULL DEFAULT '',
  INDEX event_time (is_test, occurred_at),
  INDEX event_kind_time (is_test, kind, occurred_at),
  INDEX event_source_time (is_test, source_key, occurred_at),
  INDEX event_search (search_id, kind),
  INDEX event_actor (visitor_id, occurred_at),
  INDEX event_promotion_visit (promotion_visit_id,visitor_id,is_test)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_search_sources (
  search_id CHAR(36) CHARACTER SET ascii NOT NULL,
  source_key CHAR(64) CHARACTER SET ascii NOT NULL,
  source_name VARCHAR(96) NOT NULL,
  source_origin VARCHAR(8) CHARACTER SET ascii NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  is_test TINYINT UNSIGNED NOT NULL DEFAULT 0,
  device VARCHAR(16) CHARACTER SET ascii NOT NULL,
  browser VARCHAR(16) CHARACTER SET ascii NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii NOT NULL,
  duration_ms INT UNSIGNED NOT NULL,
  result_count INT UNSIGNED NOT NULL,
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  PRIMARY KEY (search_id, source_key),
  INDEX source_time (is_test, source_key, occurred_at),
  INDEX search_time (is_test, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_playback (
  attempt_id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
  watch_id CHAR(36) CHARACTER SET ascii NOT NULL,
  promotion_id CHAR(36) CHARACTER SET ascii NOT NULL DEFAULT '',
  promotion_visit_id CHAR(36) CHARACTER SET ascii NOT NULL DEFAULT '',
  visitor_id CHAR(64) CHARACTER SET ascii NOT NULL,
  session_id CHAR(36) CHARACTER SET ascii NOT NULL,
  search_id CHAR(36) CHARACTER SET ascii NULL,
  recommendation_id VARCHAR(100) NOT NULL DEFAULT '',
  started_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sequence_no INT UNSIGNED NOT NULL,
  is_test TINYINT UNSIGNED NOT NULL DEFAULT 0,
  media VARCHAR(8) CHARACTER SET ascii NOT NULL,
  device VARCHAR(16) CHARACTER SET ascii NOT NULL,
  browser VARCHAR(16) CHARACTER SET ascii NOT NULL,
  source_key CHAR(64) CHARACTER SET ascii NOT NULL,
  source_name VARCHAR(96) NOT NULL,
  source_origin VARCHAR(8) CHARACTER SET ascii NOT NULL,
  vod_id VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  episode INT UNSIGNED NULL,
  status VARCHAR(16) CHARACTER SET ascii NOT NULL,
  played_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  hidden_played_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  buffer_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  buffer_count INT UNSIGNED NOT NULL DEFAULT 0,
  seek_buffer_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  first_frame_ms INT UNSIGNED NULL,
  first_frame_method VARCHAR(12) CHARACTER SET ascii NOT NULL DEFAULT '',
  position_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  media_duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  previous_attempt_id CHAR(36) CHARACTER SET ascii NULL,
  switch_reason VARCHAR(12) CHARACTER SET ascii NOT NULL DEFAULT '',
  INDEX playback_time (is_test, started_at),
  INDEX playback_source (is_test, source_key, started_at),
  INDEX playback_content (is_test, source_key, vod_id, started_at),
  INDEX playback_search (search_id),
  INDEX playback_watch (watch_id),
  INDEX playback_actor (visitor_id, received_at),
  INDEX playback_promotion_visit (promotion_visit_id,visitor_id,is_test)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_visitors (
  visitor_id CHAR(64) CHARACTER SET ascii PRIMARY KEY,
  first_seen DATETIME(3) NOT NULL,
  last_seen DATETIME(3) NOT NULL,
  is_test TINYINT UNSIGNED NOT NULL DEFAULT 0,
  INDEX visitor_seen (is_test, first_seen),
  INDEX visitor_last (is_test, last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_daily (
  day DATE NOT NULL,
  is_test TINYINT UNSIGNED NOT NULL DEFAULT 0,
  views BIGINT UNSIGNED NOT NULL DEFAULT 0,
  visitors BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sessions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  searches BIGINT UNSIGNED NOT NULL DEFAULT 0,
  attempts BIGINT UNSIGNED NOT NULL DEFAULT 0,
  starts BIGINT UNSIGNED NOT NULL DEFAULT 0,
  effective_views BIGINT UNSIGNED NOT NULL DEFAULT 0,
  watch_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  failures BIGINT UNSIGNED NOT NULL DEFAULT 0,
  frame_distribution LONGTEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (day, is_test)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_rate_limits (
  bucket CHAR(64) CHARACTER SET ascii NOT NULL,
  window_start BIGINT UNSIGNED NOT NULL,
  hits INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_jobs (
  name VARCHAR(40) CHARACTER SET ascii PRIMARY KEY,
  status VARCHAR(16) CHARACTER SET ascii NOT NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  detail VARCHAR(200) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS analytics_ingest_daily (
  day DATE PRIMARY KEY,
  accepted BIGINT UNSIGNED NOT NULL DEFAULT 0,
  duplicates BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rejected BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_received_at DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
