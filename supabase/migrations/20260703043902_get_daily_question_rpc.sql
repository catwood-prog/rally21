-- Deterministic daily question selection (no LLM): rotate to whichever
-- dimension has gone longest without being asked, then pick a random L1/L2
-- question in it that hasn't been asked in the last 30 days. Falls back to
-- any eligible question, then to the least-recently-asked overall, so it
-- never returns nothing even once the ~30-question bank starts repeating.
create function public.get_daily_question(p_local_date date)
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
    select max(c.created_at) from public.checkins c
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
      select 1 from public.checkins c
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
        select 1 from public.checkins c
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
      select max(c.created_at) from public.checkins c
      where c.user_id = auth.uid() and c.question_id = q.id
    ) asc nulls first
    limit 1;
  end if;
end;
$$;

revoke execute on function public.get_daily_question(date) from public, anon;
grant execute on function public.get_daily_question(date) to authenticated;
