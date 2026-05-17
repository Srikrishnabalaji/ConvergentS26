-- 0008_events_hardening.sql
-- Client was supplying Date.now().toString() as events.id. Move id generation
-- to the DB (keep text column to avoid a destructive PK migration). Add
-- WITH CHECK to the UPDATE policy so user_id can't be rewritten.

begin;

alter table public.events alter column id set default gen_random_uuid()::text;

drop policy if exists "Users can update their own events" on public.events;

create policy "Users can update their own events"
  on public.events for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;
