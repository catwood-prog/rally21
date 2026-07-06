-- Circle name was silently derived from the practice's name with no way
-- to override it. Accept an explicit name from the client instead (the
-- create-circle screen pre-fills it with the practice name, but the user
-- can edit it).
drop function public.create_circle(text, time);

create function public.create_circle(p_practice_key text, p_time_of_day time, p_circle_name text)
returns table (circle_id uuid, invite_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_practice_id uuid;
  v_circle_id uuid;
  v_code text;
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_attempt int := 0;
  v_name text := nullif(trim(p_circle_name), '');
begin
  select id into v_practice_id from public.practices where key = p_practice_key;
  if v_practice_id is null then
    raise exception 'Unknown practice: %', p_practice_key;
  end if;

  if v_name is null then
    select name into v_name from public.practices where id = v_practice_id;
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    end loop;

    begin
      insert into public.circles (name, practice_id, invite_code, time_of_day, created_by)
      values (v_name, v_practice_id, v_code, p_time_of_day, auth.uid())
      returning id into v_circle_id;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        raise exception 'Could not generate a unique invite code — try again';
      end if;
    end;
  end loop;

  insert into public.memberships (circle_id, user_id, role)
  values (v_circle_id, auth.uid(), 'owner');

  return query select v_circle_id, v_code;
end;
$$;

revoke execute on function public.create_circle(text, time, text) from public, anon;
grant execute on function public.create_circle(text, time, text) to authenticated;
