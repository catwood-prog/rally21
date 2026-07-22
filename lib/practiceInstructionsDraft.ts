/** PI1 — the practice-instructions editor (app/onboarding/practice-
 * instructions.tsx) is its OWN screen, reached from three parents:
 * onboarding/start-circle, onboarding/solo-setup, and (app)/edit-circle.
 * On the two CREATE screens the circle doesn't exist yet, so the editor
 * can't write anywhere — it has to hand its draft ({instructions, link})
 * back to the parent, which folds it into the create call. expo-router's
 * router.back() carries no params, and this app has no cross-screen store,
 * so this tiny single-slot handoff is that channel.
 *
 * Lifecycle (why it can't leak stale state between flows):
 *  - parent seeds the current draft and navigates → seedInstructionsDraft
 *  - editor CONSUMES the seed on mount (takeInstructionsDraft clears it) so
 *    a cancel leaves the slot empty
 *  - editor Save re-seeds with the edited values, then router.back()
 *  - parent reads on focus: a non-null slot means "Save happened" → apply
 *    and clear; a null slot means "cancel / first mount" → keep state
 * Steady state is therefore always null. One draft in flight at a time is
 * guaranteed by the single navigation stack (only one editor open ever).
 */
export type PracticeInstructionsDraft = {
  instructions: string;
  resourceUrl: string;
};

let slot: PracticeInstructionsDraft | null = null;

/** Parent → editor (seed the editor before navigating), and editor → parent
 * (re-seed on Save so the parent's focus read picks it up). */
export function seedInstructionsDraft(draft: PracticeInstructionsDraft): void {
  slot = draft;
}

/** Read-and-clear. The editor calls this on mount to consume the seed; the
 * parent calls it on focus to consume a Save (null = nothing waiting). */
export function takeInstructionsDraft(): PracticeInstructionsDraft | null {
  const draft = slot;
  slot = null;
  return draft;
}
