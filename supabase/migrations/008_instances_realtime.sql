-- Migration 008: enable Supabase Realtime on the instances table.
-- This allows client-side dashboards to subscribe to status changes (connected/disconnected)
-- without polling, via postgres_changes events.
-- rollback: alter publication supabase_realtime drop table instances;

alter table instances replica identity full;
alter publication supabase_realtime add table instances;
