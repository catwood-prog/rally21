-- CH5 job 4 (22 July): covering indexes for every unindexed foreign key
-- the performance advisor flagged (20 at recount; CH4 counted 7 — the
-- wave's new tables each brought FKs without indexes). Mechanical and
-- safe at cohort scale; closes the advisor's unindexed_foreign_keys
-- lint completely so future runs only flag genuinely new drift.
create index if not exists idx_blocks_blocked_id on public.blocks (blocked_id);
create index if not exists idx_blueprint_responses_user_id on public.blueprint_responses (user_id);
create index if not exists idx_checkin_reactions_from_user_id on public.checkin_reactions (from_user_id);
create index if not exists idx_circles_created_by on public.circles (created_by);
create index if not exists idx_circles_practice_id on public.circles (practice_id);
create index if not exists idx_completions_covered_by on public.completions (covered_by);
create index if not exists idx_completions_user_id on public.completions (user_id);
create index if not exists idx_friend_hearts_circle_id on public.friend_hearts (circle_id);
create index if not exists idx_journal_facts_circle_id on public.journal_facts (circle_id);
create index if not exists idx_journal_facts_user_id on public.journal_facts (user_id);
create index if not exists idx_notification_outbox_user_id on public.notification_outbox (user_id);
create index if not exists idx_observation_responses_user_id on public.observation_responses (user_id);
create index if not exists idx_practices_created_by on public.practices (created_by);
create index if not exists idx_questions_source_question_code on public.questions (source_question_code);
create index if not exists idx_reflections_question_id on public.reflections (question_id);
create index if not exists idx_reports_context_circle_id on public.reports (context_circle_id);
create index if not exists idx_reports_reporter_id on public.reports (reporter_id);
create index if not exists idx_wall_message_reactions_from_user_id on public.wall_message_reactions (from_user_id);
create index if not exists idx_wall_messages_user_id on public.wall_messages (user_id);
create index if not exists idx_want_activations_circle_id on public.want_activations (circle_id);
