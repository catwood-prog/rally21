alter table public.notification_outbox
  drop constraint notification_outbox_kind_check,
  add constraint notification_outbox_kind_check
    check (kind in ('nudge_daily', 'social_digest', 'friend_nudge', 'ember_nudge', 'rest_rejoin'));
