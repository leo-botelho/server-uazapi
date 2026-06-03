-- Migration 007: fix alert_channel default and migrate stale 'email' records
-- 'email' was the original default but was never implemented as a delivery channel.
-- The UI now normalises it to 'none' on read; here we fix the DB to be consistent.

-- 1. Change column default from 'email' → 'none' so new rows start with no alert
alter table instances
  alter column alert_channel set default 'none';

-- 2. Migrate existing rows that still have 'email' (not a working channel) to 'none'
update instances
  set alert_channel = 'none'
  where alert_channel = 'email';
