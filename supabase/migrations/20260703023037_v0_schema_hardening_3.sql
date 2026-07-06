-- join_circle_by_code still carried Postgres's default PUBLIC-level grant
-- (a bare "=X" ACL entry) from its original creation, which anon inherits
-- through same as any role. Revoke from PUBLIC explicitly this time.
revoke execute on function public.join_circle_by_code(text) from public;
grant execute on function public.join_circle_by_code(text) to authenticated;

revoke execute on function public.handle_new_user() from public;
