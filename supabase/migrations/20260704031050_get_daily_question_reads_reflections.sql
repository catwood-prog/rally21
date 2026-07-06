-- Question selection was already purely per-user (never referenced
-- circle_id), so this is a straight table swap from checkins to
-- reflections following the schema split.
create or replace function public.get_daily_question(p_local_date date)
returns table (id uuid, dimension text, prompt text, format text, depth text, options jsonb)
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  v_dimension text;
begin
  select q.dimension into v_dimension
  from public.questions q
  where q.depth in ('L1', 'L2')
  group by q.dimension
  order by (
    select max(c.created_at) from public.reflections c
    join public.questions q2 on q2.id = c.question_id
    where c.user_id = auth.uid() and q2.dimension = q.dimension
  ) asc nulls first
  limit 1;

  return query
  select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
  from public.questions q
  where q.depth in ('L1', 'L2')
    and q.dimension = v_dimension
    and not exists (
      select 1 from public.reflections c
      where c.user_id = auth.uid()
        and c.question_id = q.id
        and c.local_date >= p_local_date - 30
    )
  order by random()
  limit 1;

  if not found then
    return query
    select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
    from public.questions q
    where q.depth in ('L1', 'L2')
      and not exists (
        select 1 from public.reflections c
        where c.user_id = auth.uid()
          and c.question_id = q.id
          and c.local_date >= p_local_date - 30
      )
    order by random()
    limit 1;
  end if;

  if not found then
    return query
    select q.id, q.dimension, q.prompt, q.format, q.depth, q.options
    from public.questions q
    where q.depth in ('L1', 'L2')
    order by (
      select max(c.created_at) from public.reflections c
      where c.user_id = auth.uid() and c.question_id = q.id
    ) asc nulls first
    limit 1;
  end if;
end;
$$;
