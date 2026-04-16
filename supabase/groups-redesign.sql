-- groups-redesign.sql
-- Run this ONCE in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- What this migration does:
--   1. Adds is_private, join_code, join_password, has_join_password to groups
--   2. Creates group_join_requests table (campus org approval queue)
--   3. Updates the browse/discovery policy to exclude private groups
--   4. Adds RLS policies for group_join_requests
--   5. Adds helper RPCs: create_group, join_group_by_code, join_friend_group,
--      handle_join_request, regenerate_group_join_code, get_my_join_requests,
--      get_group_join_requests
--   6. Adds DB triggers to auto-generate join codes and sync has_join_password
--
-- NOTE: If you already ran this file and only need the create_group RPC fix,
--   scroll to the bottom and run just section 12.

-- =============================================================================
-- 1. New columns on groups
-- =============================================================================

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS is_private      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS join_code       text,
  ADD COLUMN IF NOT EXISTS join_password   text,
  ADD COLUMN IF NOT EXISTS has_join_password boolean NOT NULL DEFAULT false;

-- Partial unique index: join_code must be unique among non-null values
CREATE UNIQUE INDEX IF NOT EXISTS groups_join_code_unique
  ON public.groups (join_code)
  WHERE join_code IS NOT NULL;

-- =============================================================================
-- 2. Trigger: auto-generate join_code for private groups
-- =============================================================================

CREATE OR REPLACE FUNCTION public.manage_group_join_code()
RETURNS trigger AS $$
DECLARE
  v_code text;
BEGIN
  IF NEW.is_private = true AND NEW.join_code IS NULL THEN
    -- Generate a unique 8-char uppercase alphanumeric code
    LOOP
      v_code := upper(substring(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.groups WHERE join_code = v_code AND id IS DISTINCT FROM NEW.id
      );
    END LOOP;
    NEW.join_code := v_code;
  ELSIF NEW.is_private = false THEN
    -- Clear the code when group is made public
    NEW.join_code := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_private_group_join_code ON public.groups;
CREATE TRIGGER set_private_group_join_code
  BEFORE INSERT OR UPDATE OF is_private ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.manage_group_join_code();

-- =============================================================================
-- 3. Trigger: keep has_join_password in sync with join_password
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_has_join_password()
RETURNS trigger AS $$
BEGIN
  NEW.has_join_password := (NEW.join_password IS NOT NULL AND NEW.join_password <> '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_group_has_join_password ON public.groups;
CREATE TRIGGER sync_group_has_join_password
  BEFORE INSERT OR UPDATE OF join_password ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.sync_has_join_password();

-- =============================================================================
-- 4. group_join_requests table (for campus org join approval queue)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.group_join_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'declined')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_join_requests_group_id_idx ON public.group_join_requests (group_id);
CREATE INDEX IF NOT EXISTS group_join_requests_user_id_idx  ON public.group_join_requests (user_id);

ALTER TABLE public.group_join_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own requests; admins can view all requests for their groups
CREATE POLICY "Users can view own join requests or group admins can view"
  ON public.group_join_requests FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_admin_of_group(group_id)
  );

-- Any authenticated user can create a request for themselves
CREATE POLICY "Users can create join requests for themselves"
  ON public.group_join_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can cancel their own pending requests
CREATE POLICY "Users can cancel own pending join requests"
  ON public.group_join_requests FOR DELETE
  USING (auth.uid() = user_id AND status = 'pending');

-- =============================================================================
-- 5. Update the browse/discovery policy to exclude private groups
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can browse all groups" ON public.groups;

CREATE POLICY "Authenticated users can browse public groups"
  ON public.groups FOR SELECT
  USING (auth.uid() IS NOT NULL AND is_private = false);

-- Note: private groups remain visible to their own members via the existing
--   "Members can view groups they belong to" policy (which uses is_member_of_group).

-- =============================================================================
-- 6. RPC: Join a private group by code (bypasses RLS to look up private groups)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.join_group_by_code(p_code text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_group_id   uuid;
  v_group_name text;
BEGIN
  -- Normalize: uppercase, strip whitespace
  p_code := upper(trim(p_code));

  SELECT id, name INTO v_group_id, v_group_name
  FROM public.groups
  WHERE join_code = p_code AND is_private = true;

  IF v_group_id IS NULL THEN
    RETURN json_build_object('error', 'invalid_code');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_group_id AND user_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'already_member', 'group_name', v_group_name);
  END IF;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group_id, auth.uid(), 'member');

  RETURN json_build_object('success', true, 'group_name', v_group_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_group_by_code(text) TO authenticated;

-- =============================================================================
-- 7. RPC: Join a public friend group (verifies password if one is set)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.join_friend_group(p_group_id uuid, p_password text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_join_password text;
  v_type          text;
  v_is_private    boolean;
BEGIN
  SELECT join_password, type, is_private
    INTO v_join_password, v_type, v_is_private
  FROM public.groups
  WHERE id = p_group_id;

  IF v_is_private THEN
    RETURN json_build_object('error', 'private_group');
  END IF;

  IF v_type <> 'friends' THEN
    RETURN json_build_object('error', 'wrong_type');
  END IF;

  -- If a password is set, the supplied password must match
  IF v_join_password IS NOT NULL AND v_join_password <> ''
     AND (p_password IS NULL OR v_join_password <> p_password)
  THEN
    RETURN json_build_object('error', 'incorrect_password');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'already_member');
  END IF;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (p_group_id, auth.uid(), 'member');

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_friend_group(uuid, text) TO authenticated;

-- =============================================================================
-- 8. RPC: Approve or decline a campus org join request (admin only)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_join_request(p_request_id uuid, p_action text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_group_id uuid;
  v_user_id  uuid;
BEGIN
  SELECT group_id, user_id INTO v_group_id, v_user_id
  FROM public.group_join_requests
  WHERE id = p_request_id AND status = 'pending';

  IF v_group_id IS NULL THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT public.is_admin_of_group(v_group_id) THEN
    RETURN json_build_object('error', 'not_authorized');
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.group_join_requests SET status = 'approved' WHERE id = p_request_id;
    INSERT INTO public.group_members (group_id, user_id, role)
    VALUES (v_group_id, v_user_id, 'member')
    ON CONFLICT (group_id, user_id) DO NOTHING;
    RETURN json_build_object('success', true, 'action', 'approved');

  ELSIF p_action = 'decline' THEN
    UPDATE public.group_join_requests SET status = 'declined' WHERE id = p_request_id;
    RETURN json_build_object('success', true, 'action', 'declined');

  ELSE
    RETURN json_build_object('error', 'invalid_action');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_join_request(uuid, text) TO authenticated;

-- =============================================================================
-- 9. RPC: Regenerate join code for a private group (admin only)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.regenerate_group_join_code(p_group_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_new_code  text;
  v_is_private boolean;
BEGIN
  SELECT is_private INTO v_is_private FROM public.groups WHERE id = p_group_id;

  IF NOT v_is_private THEN
    RETURN json_build_object('error', 'not_private');
  END IF;

  IF NOT public.is_admin_of_group(p_group_id) THEN
    RETURN json_build_object('error', 'not_authorized');
  END IF;

  LOOP
    v_new_code := upper(substring(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.groups WHERE join_code = v_new_code AND id <> p_group_id
    );
  END LOOP;

  UPDATE public.groups SET join_code = v_new_code WHERE id = p_group_id;
  RETURN json_build_object('success', true, 'join_code', v_new_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_group_join_code(uuid) TO authenticated;

-- =============================================================================
-- 10. RPC: Get the current user's join requests (status for each group)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_join_requests()
RETURNS TABLE(group_id uuid, status text)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT group_id, status
  FROM public.group_join_requests
  WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_join_requests() TO authenticated;

-- =============================================================================
-- 11. RPC: Get pending join requests for a group (admin only)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_group_join_requests(p_group_id uuid)
RETURNS TABLE(id uuid, user_id uuid, full_name text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
BEGIN
  IF NOT public.is_admin_of_group(p_group_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT gjr.id, gjr.user_id, p.full_name, gjr.created_at
    FROM public.group_join_requests gjr
    LEFT JOIN public.profiles p ON p.id = gjr.user_id
    WHERE gjr.group_id = p_group_id AND gjr.status = 'pending'
    ORDER BY gjr.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_join_requests(uuid) TO authenticated;

-- =============================================================================
-- 12. RPC: Atomically create a group and add the creator as admin
--     (Needed so RETURNING on private groups doesn't fail the SELECT RLS check)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_group(
  p_name        text,
  p_description text    DEFAULT NULL,
  p_type        text    DEFAULT 'friends',
  p_is_private  boolean DEFAULT false,
  p_join_password text  DEFAULT NULL,
  p_image_url   text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  INSERT INTO public.groups (name, description, type, is_private, join_password, image_url)
  VALUES (p_name, p_description, p_type, p_is_private, p_join_password, p_image_url)
  RETURNING id INTO v_group_id;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group_id, auth.uid(), 'admin');

  RETURN json_build_object('id', v_group_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_group(text, text, text, boolean, text, text) TO authenticated;
