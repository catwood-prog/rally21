import fs from 'fs';
import path from 'path';

import { STRINGS } from '@/constants/strings';

/**
 * WC1 (8 Aug) — the rally milestone's wall line, pinned at BOTH paths.
 *
 * The sentence is composed SERVER-side inside mark_celebration_seen (S1:
 * a definer function never accepts client-composed content destined for
 * another user's surface), so constants/strings.ts holds a reference copy
 * only — and PA4 left the two "kept in step BY HAND". A reference copy
 * nobody checks is how two compositions drift apart, which is why AU1
 * built this pattern for the glow line. WC1 is the first change to the
 * rally line since, and it builds the same net here rather than editing
 * two files and hoping.
 *
 * Both paths are covered deliberately: the walk that produced WC1 saw
 * only the SOLO line, and the group variant is composed a few lines below
 * it in the same function by a different branch. A test that pinned only
 * the sentence a human happened to see is how a group variant gets left
 * saying "practices" for a year.
 */
const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');

/** The newest migration that composes the rally milestone's wall body —
 * the one actually in force. Read rather than hard-coded so a later
 * migration recreating the function is picked up automatically (AU1's
 * latestGlowWallMigration is the pattern). */
function latestRallyMilestoneMigration(): string {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
      return (
        /insert into public\.wall_messages/.test(sql) &&
        /create or replace function public\.mark_celebration_seen/.test(sql)
      );
    });
  expect(files.length).toBeGreaterThan(0);
  return fs.readFileSync(path.join(MIGRATIONS, files[files.length - 1]), 'utf8');
}

describe('WC1 — the rally line says what the number actually counts', () => {
  it('is Cat’s ruled string, verbatim, at the solo path', () => {
    // Twice-refined by her on 7 Aug: "for" in front of the number, and
    // NO scoping word after it. Both halves are hers; this is a decided
    // string, not a proposal.
    expect(STRINGS.wallRallyMilestoneLine('Russ', 21)).toBe('Russ has shown up for 21 days 🎉');
  });

  it('never claims elapsed days, which is the AU1 class', () => {
    const line = STRINGS.wallRallyMilestoneLine('Russ', 21);
    // Russ's first practice was 5 July and his 21st was 30 July — 26
    // calendar days. "has rallied 21 days" would have been false by
    // five, exactly the frozen-false-claim AU1 fixed for the glow line.
    expect(line).not.toMatch(/rallied \d+ days/);
    // …and it no longer speaks engineer.
    expect(line).not.toContain('practices');
  });

  it('makes no present-tense claim about a number it cannot re-read', () => {
    // A wall row is frozen prose, written once and read for months. The
    // number is cumulative and never falls, so "has shown up for N days"
    // stays true forever — but a live-state verb would not.
    const line = STRINGS.wallRallyMilestoneLine('Russ', 50);
    expect(line).not.toMatch(/\bis glowing\b|\bhas been\b|\bis on\b|\bcurrently\b/);
  });

  it('carries no scoping word after the number', () => {
    // The docs session proposed "…for 21 days here"; Cat struck it. The
    // ambiguity that word was reaching for is real (the number is
    // per-circle and the line does not say so) but it is a fresh ruling
    // for her, not something a session reintroduces.
    expect(STRINGS.wallRallyMilestoneLine('Russ', 21)).toMatch(/ days 🎉$/);
  });

  it('gives the group variant the same treatment', () => {
    expect(STRINGS.wallRallyMilestoneTogetherLine('Ada and Bo', 21, 'July 1')).toBe(
      'Ada and Bo have each shown up for 21 days 🎉 — they started the same day, July 1'
    );
    expect(STRINGS.wallRallyMilestoneTogetherLine('Ada and Bo', 21, 'July 1')).not.toContain(
      'practices'
    );
  });

  it('agrees verbatim with the SOLO server composition that actually writes it', () => {
    const sql = latestRallyMilestoneMigration();
    const match = sql.match(/\bv_name \|\| '([^']*)' \|\| p_day \|\| '([^']*)'/);
    expect(match).not.toBeNull();
    const [, beforeNumber, afterNumber] = match!;
    expect(`Russ${beforeNumber}21${afterNumber}`).toBe(STRINGS.wallRallyMilestoneLine('Russ', 21));
  });

  it('agrees verbatim with the GROUP server composition that actually writes it', () => {
    const sql = latestRallyMilestoneMigration();
    const match = sql.match(/\bv_all_names \|\| '([^']*)' \|\| p_day \|\| '([^']*)'/);
    expect(match).not.toBeNull();
    const [, beforeNumber, afterNumber] = match!;
    // The server appends to_char(v_start, 'FMMonth FMDD') straight onto
    // the trailing ", " that afterNumber ends with, so the reconstruction
    // below is the whole sentence, date included.
    expect(`Ada and Bo${beforeNumber}21${afterNumber}July 1`).toBe(
      STRINGS.wallRallyMilestoneTogetherLine('Ada and Bo', 21, 'July 1')
    );
  });

  it('leaves the glow line alone — the collision was ruled KEEP BOTH', () => {
    // WC1's scope fence. The glow line is AU1-ruled and correct; the
    // doubling at 21/50/100/365 is accepted and deliberately not
    // suppressed. A future sweep that "tidied" one of these into the
    // other would be undoing a ruling, not cleaning up.
    expect(STRINGS.glowSocialWallLine('Russ', 21)).toBe('Russ hit 21 days glowing 🔥');
    expect(STRINGS.glowSocialWallLine('Russ', 21)).not.toBe(
      STRINGS.wallRallyMilestoneLine('Russ', 21)
    );
  });

  it('does not change what the rally counts — the server still counts self days in ONE circle', () => {
    const sql = latestRallyMilestoneMigration();
    // The wording is only honest because of this: a covered day protects
    // the glow and never advances the rally, so every day in the number
    // really is a day this person showed up. If the count ever widened to
    // all kinds, "shown up" would start lying and this test should fail.
    expect(sql).toMatch(
      /count\(distinct c\.local_date\)[\s\S]*?c\.circle_id = p_circle_id and c\.kind = 'self'/
    );
  });
});
