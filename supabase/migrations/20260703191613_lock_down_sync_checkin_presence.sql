-- trigger-only function, same pattern as handle_new_user — never callable
-- directly over the API.
revoke execute on function public.sync_checkin_presence() from public, anon, authenticated;
