import { supabase } from './supabase';

// MOD1 (7 July) — report + block, the safety floor. Warmth laws:
// reporter safety is instant/unconditional; removal always stays a
// HUMAN act. The reported person is never notified a report exists.

export type ReportTargetKind = 'wall_message' | 'member' | 'circle';

/** Reports go through the report-content edge function (not a raw RPC
 * call) so the alert email to the founder can go out immediately,
 * bypassing the per-user notification_outbox pipeline entirely — that
 * pipeline's quiet-hours/pref/cap suppression is right for personal
 * nudges and wrong for a moderation alert that must always get through
 * (see the function's own header comment). The report itself is saved
 * durably either way (that RPC call happens first, inside the
 * function, before the email is even attempted). */
export async function reportContent(params: {
  targetKind: ReportTargetKind;
  targetId: string;
  reason?: string;
  /** Required for 'member' reports — which circle the reporter saw them
   * in, since a person can be in more than one circle and the founder's
   * "remove from circle" act button needs a specific circle to act on. */
  contextCircleId?: string;
}): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('not signed in');

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const res = await fetch(`${supabaseUrl}/functions/v1/report-content`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetKind: params.targetKind,
      targetId: params.targetId,
      reason: params.reason ?? null,
      contextCircleId: params.contextCircleId ?? null,
    }),
  });

  if (!res.ok) {
    const responseBody = await res.json().catch(() => ({}));
    // ER1: no user ever sees a status code (warmth law — the AR1 rule);
    // the server's own error copy is user-facing when present.
    throw new Error(responseBody?.error ?? 'could not send that report — try again in a moment');
  }
}

/** Idempotent — blocking someone already blocked is a no-op, never a
 * duplicate-row error. */
export async function blockUser(blockedId: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const blockerId = sessionData.session?.user.id;
  if (!blockerId) throw new Error('not signed in');

  const { error } = await supabase
    .from('blocks')
    .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function unblockUser(blockedId: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const blockerId = sessionData.session?.user.id;
  if (!blockerId) throw new Error('not signed in');

  const { error } = await supabase.from('blocks').delete().eq('blocker_id', blockerId).eq('blocked_id', blockedId);
  if (error) throw error;
}

export type BlockedPerson = { blockedId: string; name: string };

export async function getMyBlocks(): Promise<BlockedPerson[]> {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_id, users!blocks_blocked_id_fkey(name)')
    .order('created_at', { ascending: false })
    .returns<{ blocked_id: string; users: { name: string | null } | null }[]>();

  if (error) throw error;
  return (data ?? []).map((row) => ({ blockedId: row.blocked_id, name: row.users?.name ?? 'someone' }));
}

/** Founder-only screen gate — same allowlist as app_caps(). Fails
 * closed (false) on any error, since this only ever controls whether
 * the client shows/redirects a moderation screen; the real enforcement
 * is server-side on every founder RPC regardless of what this returns. */
export async function isFounder(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_founder');
  if (error) return false;
  return !!data;
}

export type PendingReport = {
  reportId: string;
  targetKind: ReportTargetKind;
  targetId: string;
  reason: string | null;
  createdAt: string;
  reporterName: string;
  wallMessageBody: string | null;
  wallMessageCircleName: string | null;
  memberName: string | null;
  memberCircleId: string | null;
  memberCircleName: string | null;
  circleName: string | null;
  circlePracticeName: string | null;
};

type PendingReportRow = {
  report_id: string;
  target_kind: ReportTargetKind;
  target_id: string;
  reason: string | null;
  created_at: string;
  reporter_name: string | null;
  wall_message_body: string | null;
  wall_message_circle_name: string | null;
  member_name: string | null;
  member_circle_id: string | null;
  member_circle_name: string | null;
  circle_name: string | null;
  circle_practice_name: string | null;
};

export async function getPendingReports(): Promise<PendingReport[]> {
  const { data, error } = await supabase.rpc('get_pending_reports');
  if (error) throw error;
  return ((data ?? []) as PendingReportRow[]).map((row) => ({
    reportId: row.report_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    reason: row.reason,
    createdAt: row.created_at,
    reporterName: row.reporter_name ?? 'someone',
    wallMessageBody: row.wall_message_body,
    wallMessageCircleName: row.wall_message_circle_name,
    memberName: row.member_name,
    memberCircleId: row.member_circle_id,
    memberCircleName: row.member_circle_name,
    circleName: row.circle_name,
    circlePracticeName: row.circle_practice_name,
  }));
}

export async function adminDeleteWallMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_wall_message', { p_message_id: messageId });
  if (error) throw error;
}

export async function adminHideCircle(circleId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_hide_circle', { p_circle_id: circleId });
  if (error) throw error;
}

export async function adminDismissReport(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_report_status', { p_report_id: reportId, p_status: 'dismissed' });
  if (error) throw error;
}

export async function adminMarkReportActioned(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_report_status', { p_report_id: reportId, p_status: 'actioned' });
  if (error) throw error;
}
