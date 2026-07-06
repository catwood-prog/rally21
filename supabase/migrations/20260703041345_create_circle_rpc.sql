-- Creates a circle + the creator's owner membership atomically, and
-- generates a 6-character invite code (uppercase letters/digits, excluding
-- 0/O/1/I/L to avoid ambiguity when read aloud or typed from a screenshot).
-- security invoker: relies entirely on the existing RLS insert policies
-- (circles.created_by = auth.uid(), memberships.user_id = auth.uid()) --
-- no elevated privilege needed, unlike join_circle_by_code.
create function public.create_circle(p_practice_key text, p_time_of_day time)
returns table (circle_id uuid, invite_code text)
language plpgsql
security invoker set search_path = public
as $$
declare
  v_practice_id uuid;
  v_circle_id uuid;
  v_code text;
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_attempt int := 0;
begin
  select id into v_practice_id from public.practices where key = p_practice_key;
  if v_practice_id is null then
    raise exception 'Unknown practice: %', p_practice_key;
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    end loop;

    begin
      insert into public.circles (name, practice_id, invite_code, time_of_day, created_by)
      select p.name, v_practice_id, v_code, p_time_of_day, auth.uid()
      from public.practices p where p.id = v_practice_id
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

revoke execute on function public.create_circle(text, time) from public, anon;
grant execute on function public.create_circle(text, time) to authenticated;
