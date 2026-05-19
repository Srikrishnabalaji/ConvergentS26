-- 0002_enable_rls_graph_tables.sql
-- buildings/floors/nodes/edges had RLS disabled, leaving them world-writable
-- via the anon key. Enable RLS + SELECT-only-for-authenticated. Writes
-- continue via service role.

begin;

alter table public.buildings enable row level security;
alter table public.floors    enable row level security;
alter table public.nodes     enable row level security;
alter table public.edges     enable row level security;

drop policy if exists "Authenticated users can read buildings" on public.buildings;
drop policy if exists "Authenticated users can read floors"    on public.floors;
drop policy if exists "Authenticated users can read nodes"     on public.nodes;
drop policy if exists "Authenticated users can read edges"     on public.edges;

create policy "Authenticated users can read buildings"
  on public.buildings for select to authenticated using (true);

create policy "Authenticated users can read floors"
  on public.floors for select to authenticated using (true);

create policy "Authenticated users can read nodes"
  on public.nodes for select to authenticated using (true);

create policy "Authenticated users can read edges"
  on public.edges for select to authenticated using (true);

commit;
