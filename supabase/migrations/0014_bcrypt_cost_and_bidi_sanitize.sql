-- 0014_bcrypt_cost_and_bidi_sanitize.sql
-- H-1: Raise bcrypt cost from default (6) to 12 for group join passwords.
--      Existing hashed rows cannot be re-hashed without the plaintext; they
--      will be upgraded on the next admin password update.
-- M-1: Lower join-code brute-force limit from 10 to 5 attempts/minute.
-- M-4: Strip BIDI override and zero-width characters from display names
--      in addition to the control-char pass already in 0007.

begin;

-- ── H-1: bcrypt cost 12 ──────────────────────────────────────────────────────

create or replace function public.hash_group_join_password()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.join_password is null or new.join_password = '' then
    new.join_password := null;
    return new;
  end if;
  -- Already a bcrypt hash; leave alone. This preserves existing cost-6 hashes
  -- until the admin next sets a new password, at which point cost 12 applies.
  if left(new.join_password, 2) = '$2' then
    return new;
  end if;
  new.join_password := crypt(new.join_password, gen_salt('bf', 12));
  return new;
end;
$$;

-- ── M-1: join-code rate limit 5/minute ───────────────────────────────────────

create or replace function public.join_group_by_code(p_code text)
returns json
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_group_id   uuid;
  v_group_name text;
  v_uid        uuid;
  v_recent     int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  delete from public.join_code_attempts
   where user_id = v_uid and attempted_at < now() - interval '1 day';

  select count(*) into v_recent
    from public.join_code_attempts
   where user_id = v_uid
     and attempted_at > now() - interval '1 minute';

  if v_recent >= 5 then
    return json_build_object('error', 'rate_limited');
  end if;

  -- Log before lookup so failed attempts count.
  insert into public.join_code_attempts (user_id) values (v_uid);

  p_code := upper(trim(p_code));

  select id, name into v_group_id, v_group_name
    from public.groups
   where join_code = p_code and is_private = true;

  if v_group_id is null then
    return json_build_object('error', 'invalid_code');
  end if;

  if exists (
    select 1 from public.group_members
    where group_id = v_group_id and user_id = v_uid
  ) then
    return json_build_object('error', 'already_member', 'group_name', v_group_name);
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_uid, 'member');

  return json_build_object('success', true, 'group_name', v_group_name);
end;
$$;

-- ── M-4: strip BIDI overrides and zero-width chars from display names ─────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_clean text;
begin
  -- Remove ASCII/C1 control chars.
  v_clean := trim(regexp_replace(
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    '[[:cntrl:]]', '', 'g'
  ));
  -- Remove BIDI overrides (U+202A–202E, U+2066–2069), zero-width chars
  -- (U+200B–U+200F), word joiners, and the BOM (U+FEFF). These can be used
  -- to spoof display names or cause rendering anomalies.
  v_clean := regexp_replace(
    v_clean,
    u&'\200B|\200C|\200D|\200E|\200F|\202A|\202B|\202C|\202D|\202E|\2060|\2061|\2062|\2063|\2064|\2066|\2067|\2068|\2069|\FEFF',
    '', 'g'
  );
  if length(v_clean) = 0 then
    v_clean := split_part(new.email, '@', 1);
  end if;
  v_clean := substring(v_clean for 80);

  insert into public.profiles (id, full_name)
  values (new.id, v_clean);
  return new;
end;
$$;

commit;
