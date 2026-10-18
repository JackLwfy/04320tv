-- Existing UUID links remain valid; the migration runner assigns codes before activation.
ALTER TABLE analytics_promotion_links ADD COLUMN IF NOT EXISTS short_code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE analytics_promotion_links ADD UNIQUE INDEX IF NOT EXISTS promotion_short_code (short_code);
UPDATE analytics_meta SET schema_version=GREATEST(schema_version,5) WHERE id=1;
