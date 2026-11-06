-- 0014 pinned search_path only on security definer functions, so these two
-- invoker helpers kept a role-mutable search_path (Supabase linter 0011).
-- Both call only pg_catalog functions and a schema-qualified table.
alter function public.gen_qr_slug() set search_path = '';
alter function public.touch_updated_at() set search_path = '';
