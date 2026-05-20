-- Enable Supabase Realtime on webhook_events so the admin monitor
-- can subscribe to new events without polling.
-- rollback: alter publication supabase_realtime drop table webhook_events;

alter table webhook_events replica identity full;
alter publication supabase_realtime add table webhook_events;
