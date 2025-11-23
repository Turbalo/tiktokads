-- MySQL schema for logging intent events
-- Run with: mysql -u USER -p DB_NAME < intent_events.sql

CREATE TABLE IF NOT EXISTS intent_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  client_ip VARCHAR(45) NULL,
  ua TEXT NULL,
  method VARCHAR(16) NULL,
  query JSON NULL,

  event VARCHAR(64) NULL,
  client_ts BIGINT NULL,
  variant VARCHAR(64) NULL,
  intent_target TEXT NULL,
  reason VARCHAR(64) NULL,
  open_url TEXT NULL,
  status VARCHAR(32) NULL,
  why VARCHAR(64) NULL,

  page_type VARCHAR(16) NULL,
  intent_scheme VARCHAR(32) NULL,
  open_method VARCHAR(32) NULL,

  browser_name VARCHAR(64) NULL,
  browser_version VARCHAR(64) NULL,
  os_name VARCHAR(64) NULL,
  os_version VARCHAR(64) NULL,
  is_webview TINYINT(1) NULL,

  lang VARCHAR(32) NULL,
  platform VARCHAR(64) NULL,
  screen VARCHAR(32) NULL,
  device_pixel_ratio VARCHAR(16) NULL,
  timezone VARCHAR(64) NULL,

  errors JSON NULL,
  raw_json JSON NULL,

  PRIMARY KEY (id),
  KEY idx_received_at (received_at),
  KEY idx_event (event),
  KEY idx_variant (variant),
  KEY idx_is_webview (is_webview),
  KEY idx_reason (reason),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;