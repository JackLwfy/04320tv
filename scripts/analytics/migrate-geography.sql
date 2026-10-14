-- Additive migration; old facts retain unknown geography. Apply after a verified backup.
ALTER TABLE analytics_meta ADD COLUMN IF NOT EXISTS geography_started_at DATETIME(3) NULL;
ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS network_ip VARCHAR(45) CHARACTER SET ascii NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country CHAR(2) CHARACTER SET ascii NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS province CHAR(2) CHARACTER SET ascii NOT NULL DEFAULT '';
UPDATE analytics_meta SET schema_version=2 WHERE id=1;
