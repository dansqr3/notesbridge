-- Keep NotesBridge storage RPCs usable by the server's Supabase secret key,
-- while preventing public/anon/authenticated callers from invoking them.
grant select, insert, update, delete on table public.notesbridge_kv, public.notesbridge_list to service_role;
grant usage, select on sequence public.notesbridge_list_id_seq to service_role;

alter function public.nb_get(text) security definer set search_path = pg_catalog, public, pg_temp;
alter function public.nb_set(text, text, integer) security definer set search_path = pg_catalog, public, pg_temp;
alter function public.nb_del(text) security definer set search_path = pg_catalog, public, pg_temp;
alter function public.nb_lpush(text, text) security definer set search_path = pg_catalog, public, pg_temp;
alter function public.nb_rpop(text) security definer set search_path = pg_catalog, public, pg_temp;
alter function public.nb_incr(text, integer) security definer set search_path = pg_catalog, public, pg_temp;
alter function public.nb_expire(text, integer) security definer set search_path = pg_catalog, public, pg_temp;

revoke execute on function public.nb_get(text), public.nb_set(text, text, integer),
  public.nb_del(text), public.nb_lpush(text, text), public.nb_rpop(text),
  public.nb_incr(text, integer), public.nb_expire(text, integer)
  from public, anon, authenticated;
grant execute on function public.nb_get(text), public.nb_set(text, text, integer),
  public.nb_del(text), public.nb_lpush(text, text), public.nb_rpop(text),
  public.nb_incr(text, integer), public.nb_expire(text, integer)
  to service_role;
