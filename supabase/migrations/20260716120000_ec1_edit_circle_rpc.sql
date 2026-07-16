-- EC1 (16 July) — hosts can edit their circle after creation: name,
-- time of day, resource link, and the practice wording/duration itself
-- (Cat's ruling, 13 July). One RPC rather than widening client-side
-- UPDATEs, because the practice fields live on `practices`, where an
-- in-place UPDATE is impossible for a seeded practice (creators-only
-- RLS) and wrong for a shared one (it would rewrite the wording for
-- every other circle using it). The rule here: update in place only
-- when the host owns the practice AND no other circle references it;
-- otherwise clone a copy owned by the host and repoint this circle.
-- Counting "other circles" needs SECURITY DEFINER — the circles SELECT
-- policy hides strangers' private circles, so a client-side count
-- would undercount and edit shared practices in place.
--
-- The day counter never moves: start_date and duration_days are not
-- touched by this function, and completions/glow/journey state key off
-- circle_id, which never changes.

create or replace function public.edit_circle(
  p_circle_id uuid,
  p_name text,
  p_time_of_day time without time zone,
  p_resource_url text,
  p_practice_name text,
  p_practice_duration_minutes int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_circle public.circles%rowtype;
  v_practice public.practices%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_practice_name text := nullif(trim(p_practice_name), '');
  v_url text := nullif(trim(p_resource_url), '');
  v_other_circles int;
  v_new_practice_id uuid;
begin
  select * into v_circle from public.circles where id = p_circle_id;

  -- Host-only, enforced here at the database (matches the circles
  -- UPDATE policy's created_by = auth.uid()); no host handover exists,
  -- so this is always the original creator (see CLAUDE.md).
  if v_circle.id is null or v_circle.created_by is distinct from auth.uid() then
    raise exception 'Only the circle''s host can edit it';
  end if;

  if v_name is null then
    raise exception 'The circle needs a name';
  end if;

  -- resource_url: null/blank clears the link; a non-http value is
  -- rejected by the circles_resource_url_http_check constraint.
  update public.circles
  set name = v_name,
      time_of_day = coalesce(p_time_of_day, time_of_day),
      resource_url = v_url
  where id = p_circle_id;

  if v_practice_name is not null and v_circle.practice_id is not null then
    select * into v_practice from public.practices where id = v_circle.practice_id;

    if v_practice.name is distinct from v_practice_name
       or v_practice.duration_minutes is distinct from p_practice_duration_minutes then
      select count(*) into v_other_circles
      from public.circles
      where practice_id = v_practice.id and id <> p_circle_id;

      if v_practice.created_by = auth.uid() and v_other_circles = 0 then
        update public.practices
        set name = v_practice_name,
            duration_minutes = p_practice_duration_minutes
        where id = v_practice.id;
      else
        -- Clone: same category/description, owned by the host. Private
        -- unless this circle is public — the same one-directional
        -- is_shared rule create_circle applies (CLAUDE.md's
        -- practice-privacy convention). The practices_set_key trigger
        -- derives the clone's key from its own id.
        insert into public.practices
          (name, description, category, duration_minutes, created_by, is_shared)
        values
          (v_practice_name, v_practice.description, v_practice.category,
           p_practice_duration_minutes, auth.uid(), v_circle.is_public)
        returning id into v_new_practice_id;

        update public.circles
        set practice_id = v_new_practice_id
        where id = p_circle_id;
      end if;
    end if;
  end if;
end;
$$;

-- S1/G5 convention: the project's default ACL still grants EXECUTE to
-- anon/PUBLIC on new functions — revoke explicitly, then grant.
revoke all on function public.edit_circle(uuid, text, time without time zone, text, text, int) from public;
revoke all on function public.edit_circle(uuid, text, time without time zone, text, text, int) from anon;
grant execute on function public.edit_circle(uuid, text, time without time zone, text, text, int) to authenticated;
