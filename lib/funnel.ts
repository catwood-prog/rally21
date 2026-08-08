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

/**
 * IL2 (8 Aug) — `recordInviteLinkOpen` USED TO LIVE HERE and is deleted,
 * not parked. It called `record_invite_link_open` from `app/j/[code].tsx`,
 * the signed-out invite landing, which needed the project's first anon
 * EXECUTE grant; Cat declined that grant on 7 August, so no client role can
 * execute the RPC and a client shim for it could only ever fail silently.
 * That is dead, not dormant — a function whose one job is to call something
 * it is refused is worse than absent, because it reads as a working emit.
 * Git history is the archive (IL1, 27e6eb3).
 *
 * THE SERVER SIDE IS DELIBERATELY KEPT: `public.record_invite_link_open`
 * and `analytics.invite_link_opens` still exist, executable by no client
 * role, because that is the shape a future TRUSTED-CONTEXT caller needs.
 * If pre-auth opens are ever worth counting again, the sanctioned caller is
 * a public edge function holding the service-role key server-side — never a
 * new anon grant, and never a new emit in this file.
 */
