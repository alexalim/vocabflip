-- VocabFlip accounts: profiles (username + recovery email) and synced study progress.
--
-- Username accounts sign in to Supabase Auth with an internal address
-- "<username>@users.vocabflip.invalid". The real email is only a recovery
-- address kept in profiles, so OAuth sign-ins (Google/Kakao) never auto-link
-- to a username account; linking is manual (linkIdentity) from Settings.

create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  username       text unique check (username ~ '^[a-z0-9_]{4,20}$'),
  recovery_email text check (recovery_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at     timestamptz not null default now()
);

create table public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Recipients of find-id / reset mails, for rate limiting. Service role only.
create table public.mail_log (
  id        bigint generated always as identity primary key,
  recipient text not null,
  kind      text not null,
  sent_at   timestamptz not null default now()
);
create index mail_log_recipient_sent_at on public.mail_log (recipient, sent_at);

alter table public.profiles enable row level security;
alter table public.progress enable row level security;
alter table public.mail_log enable row level security;

create policy "own profile: read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Only the recovery email is editable by the user; username is fixed at signup.
revoke update on public.profiles from anon, authenticated;
grant update (recovery_email) on public.profiles to authenticated;

create policy "own progress: read" on public.progress
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own progress: insert" on public.progress
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own progress: update" on public.progress
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Create the profile row on signup. The username comes from the internal
-- auth address (not from client metadata), so it cannot disagree with login.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  is_username_account boolean := new.email like '%@users.vocabflip.invalid';
  recovery text := nullif(trim(new.raw_user_meta_data ->> 'recovery_email'), '');
begin
  insert into public.profiles (id, username, recovery_email)
  values (
    new.id,
    case when is_username_account then split_part(new.email, '@', 1) end,
    case when is_username_account then lower(recovery) end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Signup form: "is this username free?" Returns only a boolean.
create function public.username_available(name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where username = lower(name));
$$;
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
