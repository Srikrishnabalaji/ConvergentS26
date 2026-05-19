-- 0017_join_password_length_cap.sql
-- Two fixes:
--
-- 1. Revert join codes to 6 hex chars (3 random bytes via gen_random_bytes,
--    so still CSPRNG-backed). Migration 0013 upgraded the generator from
--    md5/random to gen_random_bytes but also increased the length to 10 chars,
--    which the frontend modal was never updated to match and made the join-code
--    flow non-functional. 6 chars remains secure with the 5/min rate limit
--    from migration 0014 (~6 years of continuous guessing per attacker).
--
-- 2. Cap group join-password length at 200 chars. create_group validated
--    name/description/image_url but left p_join_password unbounded. The
--    direct-update path on groups (admin editing) also lacked a bound.

begin;

-- ── 1. Revert join code length to 6 hex chars (CSPRNG-backed) ───────────────

create or replace function public.manage_group_join_code()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_code text;
begin
  if new.is_private = true and new.join_code is null then
    loop
      v_code := upper(encode(gen_random_bytes(3), 'hex'));
      exit when not exists (
        select 1 from public.groups where join_code = v_code and id is distinct from new.id
      );
    end loop;
    new.join_code := v_code;
  elsif new.is_private = false then
    new.join_code := null;
  end if;
  return new;
end;
$$;

create or replace function public.regenerate_group_join_code(p_group_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_new_code   text;
  v_is_private boolean;
begin
  select is_private into v_is_private from public.groups where id = p_group_id;

  if not coalesce(v_is_private, false) then
    return json_build_object('error', 'not_private');
  end if;

  if not public.is_admin_of_group(p_group_id) then
    return json_build_object('error', 'not_authorized');
  end if;

  loop
    v_new_code := upper(encode(gen_random_bytes(3), 'hex'));
    exit when not exists (
      select 1 from public.groups where join_code = v_new_code and id <> p_group_id
    );
  end loop;

  update public.groups set join_code = v_new_code where id = p_group_id;
  return json_build_object('success', true, 'join_code', v_new_code);
end;
$$;

-- ── 2. Cap group join-password length at 200 chars ───────────────────────────

create or replace function public.create_group(
  p_name          text,
  p_description   text    default null,
  p_type          text    default 'friends',
  p_is_private    boolean default false,
  p_join_password text    default null,
  p_image_url     text    default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_group_id uuid;
  v_name text;
  v_description text;
  v_image_url text;
  v_join_password text;
begin
  if auth.uid() is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  v_name := trim(coalesce(p_name, ''));
  if length(v_name) < 1 or length(v_name) > 120 then
    return json_build_object('error', 'invalid_name');
  end if;

  if p_type not in ('friends', 'campus_org') then
    return json_build_object('error', 'invalid_type');
  end if;

  v_description := nullif(trim(coalesce(p_description, '')), '');
  if v_description is not null and length(v_description) > 1000 then
    return json_build_object('error', 'description_too_long');
  end if;

  v_image_url := nullif(trim(coalesce(p_image_url, '')), '');
  if v_image_url is not null and length(v_image_url) > 2048 then
    return json_build_object('error', 'invalid_image_url');
  end if;

  v_join_password := nullif(trim(coalesce(p_join_password, '')), '');
  if v_join_password is not null and length(v_join_password) > 200 then
    return json_build_object('error', 'password_too_long');
  end if;

  insert into public.groups (name, description, type, is_private, join_password, image_url)
  values (
    v_name,
    v_description,
    p_type,
    p_is_private,
    case
      when p_is_private or p_type <> 'friends' then null
      else v_join_password
    end,
    v_image_url
  )
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'admin');

  return json_build_object('id', v_group_id);
end;
$$;

-- Enforce the same 200-char cap in the trigger so direct .update() paths
-- (admins editing via edit-group) are also covered. bcrypt truncates at
-- 72 bytes; this cap is storage hygiene, not a hash-security constraint.
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
  -- Already a bcrypt hash; leave alone (preserves existing cost-6 hashes
  -- until next password change, at which point cost 12 applies).
  if left(new.join_password, 2) = '$2' then
    return new;
  end if;
  if length(new.join_password) > 200 then
    raise exception 'join_password too long' using errcode = '22023';
  end if;
  new.join_password := crypt(new.join_password, gen_salt('bf', 12));
  return new;
end;
$$;

commit;
