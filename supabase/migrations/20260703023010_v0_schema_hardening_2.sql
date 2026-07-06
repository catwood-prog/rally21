-- Supabase's default privileges grant EXECUTE directly to anon/authenticated
-- on function creation (not via PUBLIC), so "revoke ... from public" alone
-- doesn't touch it. Revoke explicitly from both, then re-grant only what's needed.

revoke execute on function public.get_checkin_presence(uuid) from anon, authenticated;
grant execute on function public.get_checkin_presence(uuid) to authenticated;

revoke execute on function public.join_circle_by_code(text) from anon, authenticated;
grant execute on function public.join_circle_by_code(text) to authenticated;

revoke execute on function public.handle_new_user() from anon, authenticated;
