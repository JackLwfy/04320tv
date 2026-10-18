-- Additive MariaDB migration; keep historical events unattributed.
CREATE TABLE IF NOT EXISTS analytics_promotion_links (
  id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
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
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS promotion_id CHAR(36) CHARACTER SET ascii NOT NULL DEFAULT '';
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS promotion_visit_id CHAR(36) CHARACTER SET ascii NOT NULL DEFAULT '';
ALTER TABLE analytics_events ADD INDEX IF NOT EXISTS event_promotion_visit (promotion_visit_id,visitor_id,is_test);
ALTER TABLE analytics_playback ADD COLUMN IF NOT EXISTS promotion_id CHAR(36) CHARACTER SET ascii NOT NULL DEFAULT '';
ALTER TABLE analytics_playback ADD COLUMN IF NOT EXISTS promotion_visit_id CHAR(36) CHARACTER SET ascii NOT NULL DEFAULT '';
ALTER TABLE analytics_playback ADD INDEX IF NOT EXISTS playback_promotion_visit (promotion_visit_id,visitor_id,is_test);
UPDATE analytics_meta SET schema_version=GREATEST(schema_version,4) WHERE id=1;
