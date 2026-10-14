-- Additive migration after a verified backup; old city/ASN values remain unknown.
ALTER TABLE analytics_meta ADD COLUMN IF NOT EXISTS network_details_started_at DATETIME(3) NULL;
ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS city VARCHAR(96) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS network_asn INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS network_operator VARCHAR(96) NOT NULL DEFAULT '';
UPDATE analytics_meta SET schema_version=GREATEST(schema_version,3) WHERE id=1;
