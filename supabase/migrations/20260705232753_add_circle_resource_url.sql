alter table public.circles add column resource_url text;
alter table public.circles add constraint circles_resource_url_http_check
  check (resource_url is null or resource_url ~* '^https?://');
