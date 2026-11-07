create table if not exists public.seven_channels_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.seven_channels_state enable row level security;

revoke all on public.seven_channels_state from anon;
grant select, insert, update, delete on public.seven_channels_state to authenticated;

drop policy if exists "Users can read their own Seven Channels state"
  on public.seven_channels_state;
create policy "Users can read their own Seven Channels state"
  on public.seven_channels_state for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own Seven Channels state"
  on public.seven_channels_state;
create policy "Users can create their own Seven Channels state"
  on public.seven_channels_state for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own Seven Channels state"
  on public.seven_channels_state;
create policy "Users can update their own Seven Channels state"
  on public.seven_channels_state for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own Seven Channels state"
  on public.seven_channels_state;
create policy "Users can delete their own Seven Channels state"
  on public.seven_channels_state for delete to authenticated
  using ((select auth.uid()) = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'seven_channels_state'
  ) then
    alter publication supabase_realtime add table public.seven_channels_state;
  end if;
end
$$;
