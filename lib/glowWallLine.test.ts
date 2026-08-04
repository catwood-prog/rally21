import fs from 'fs';
import path from 'path';

import { STRINGS } from '@/constants/strings';

/**
 * AU1 job 1 — the glow drift, pinned.
 *
 * The badge, the avatar flames and check_glow_milestone all read ONE
 * source (get_glow_for_user, over the glow_day_states family) and all
 * three agreed on 2 August. What disagreed was a wall row frozen in the
 * present tense: "Cathy S has been glowing 7 days 🔥" kept asserting a
 * live state a week after it stopped being true, while the flame beside
 * it read 13.
 *
 * So "badge and sentence can never disagree" is enforced here as: the
 * badge is the only surface that makes a LIVE claim, and the wall row is
 * a record of a moment. A moment cannot drift.
 */
const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');

/** The newest migration that composes the wall celebration body — the
 * one actually in force. Read rather than hard-coded so a later
 * migration recreating the function is picked up automatically. */
function latestGlowWallMigration(): string {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) =>
      /insert into public\.wall_messages/.test(
        fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')
      ) && /check_glow_milestone/.test(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    );
  expect(files.length).toBeGreaterThan(0);
  return fs.readFileSync(path.join(MIGRATIONS, files[files.length - 1]), 'utf8');
}

describe('the glow wall line is a moment, not a standing claim', () => {
  it('records what the glow WAS, never what it is', () => {
    expect(STRINGS.glowSocialWallLine('Cathy S', 7)).toBe('Cathy S hit 7 days glowing 🔥');
    // The exact sentence Cat's wall was still showing on 2 August while
    // her flame read 13.
    expect(STRINGS.glowSocialWallLine('Cathy S', 7)).not.toContain('has been glowing');
  });

  it('makes no present-tense claim about a number it cannot re-read', () => {
    const line = STRINGS.glowSocialWallLine('Russ', 21);
    // "is glowing" / "has been glowing" / "is on" all assert now; a wall
    // row is written once and read for months, so none of them can be
    // true for longer than a day.
    expect(line).not.toMatch(/\bis glowing\b|\bhas been\b|\bis on\b|\bcurrently\b/);
  });

  it('agrees verbatim with the server composition that actually writes it', () => {
    // S1 forbids the client composing this, so strings.ts is only a
    // reference copy — and a reference copy nobody checks is how the two
    // drift apart. This rebuilds the SQL concatenation and compares.
    const sql = latestGlowWallMigration();
    const match = sql.match(
      /v_name \|\| '([^']*)' \|\| v_milestone \|\| '([^']*)'/
    );
    expect(match).not.toBeNull();
    const [, beforeNumber, afterNumber] = match!;
    const serverComposed = `Cathy S${beforeNumber}7${afterNumber}`;
    expect(serverComposed).toBe(STRINGS.glowSocialWallLine('Cathy S', 7));
  });

  it('leaves the LIVE flame label in the present tense', () => {
    // The flame re-reads get_glow_for_user every load, so a present-tense
    // claim is correct there. The bug was freezing a claim, not the
    // claim itself — a sweep that past-tensed this too would be wrong.
    expect(STRINGS.glowFlameA11yLabel('Cathy S', 13)).toBe('Cathy S has been glowing 13 days');
  });

  it('backfills the rows already written in the old tense', () => {
    const sql = latestGlowWallMigration();
    // Without this, every wall row written before AU1 keeps making the
    // false claim forever and the fix only applies to future milestones.
    expect(sql).toMatch(/update public\.wall_messages/);
    expect(sql).toMatch(/has been glowing/); // the pattern it rewrites FROM
    expect(sql).toMatch(/kind = 'celebration'/); // never a member's own post
  });
});
