import { supabase } from './supabase';

/**
 * AN1 job 2 (5 Aug) — the activation funnel's client emits.
 *
 * SCOPE, deliberately narrow: this records ONLY the moments no existing
 * table already stamps. Everything reconstructible is reconstructed in
 * `analytics.funnel_person` instead, from rows the app was already writing
 * (auth.users.created_at, users.reminders_ask_seen_at, memberships.joined_at
 * + join_source, completions, device_tokens, card_events). Do NOT add an
 * emit here for something a table already knows — a second record of one
 * fact is a second thing that can disagree with the first.
 *
 * The keys are a Postgres ENUM (`public.funnel_event_key`), not a text
 * column with a check, so the table cannot hold user text even by
 * accident. That is the house law made structural. This union must stay
 * in step with the enum by hand; adding a value is a migration either way.
 */
export type FunnelEvent =
  | 'onboarding_profile_opened'
  | 'onboarding_profile_saved'
  | 'onboarding_reminders_opened'
  | 'onboarding_circle_setup_opened'
  | 'onboarding_circle_setup_start_chosen'
  | 'onboarding_circle_setup_join_chosen'
  | 'onboarding_circle_setup_solo_chosen'
  | 'invite_share_opened'
  | 'invite_channel_chosen'
  | 'invite_code_copied';

/**
 * Fire-and-forget by design, and FF1 rule 1 says the silence gets its
 * reason written down: THE FUNNEL IS A LENS, NEVER A GATE. A failed emit
 * must not block a step, surface an error, or change one pixel of what the
 * person sees — losing a row costs a number in a founder-only view, while
 * letting this throw would cost somebody their onboarding. It is also
 * deliberately not routed to captureError: an offline open would emit on
 * every step and turn Sentry into a connectivity log.
 *
 * FF1 rule 2 is satisfied by construction rather than by care — nothing
 * here returns a value, so no substituted value can ever reach a write or
 * a person-facing number.
 */
export function recordFunnelEvent(userId: string | undefined, event: FunnelEvent): void {
  if (!userId) return;
  void supabase
    .from('funnel_events')
    .insert({ user_id: userId, event })
    .then(() => undefined, () => undefined);
}
