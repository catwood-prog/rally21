import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * UN1 (10 Aug) — the test that retires the whole class.
 *
 * `ember_nudge` and `rest_rejoin` were emitted by send-notifications for
 * weeks (8 real `rest_rejoin` emails, 31 Jul–6 Aug) while unsubscribe's
 * KIND_TO_PREF_COLUMN had no entry for either, so their footer links —
 * which every email carries, unconditionally — answered "that link isn't
 * quite right" instead of unsubscribing anyone. Adding those two entries
 * by hand fixes those two kinds and leaves the NEXT kind exactly as
 * exposed, because the two maps are kept in step by hand and nothing
 * checks that they are.
 *
 * So this test asserts the general property rather than the two
 * instances: every kind the SENDER can emit is unsubscribable, derived
 * from the sender's own `OutboxRow["kind"]` union rather than a list
 * copied into this file (a copied list rots in exactly the same way the
 * map did). Add a kind to send-notifications and forget the door here,
 * and this fails before it can reach anyone's inbox.
 *
 * It reads both files as TEXT because they are Deno edge functions —
 * `jsr:` specifiers and `Deno.serve` mean Jest cannot import either one.
 * That makes the parse itself load-bearing, so each extraction is
 * sanity-checked against a known-stable anchor below: a regex that
 * quietly matched nothing would otherwise make this suite pass while
 * asserting nothing at all.
 */

const FUNCTIONS_DIR = join(__dirname, '..');

function read(fn: string): string {
  return readFileSync(join(FUNCTIONS_DIR, fn, 'index.ts'), 'utf8');
}

/** The `kind:` union off send-notifications' OutboxRow type — the
 * authoritative list of what the pipeline can put in an outbox row.
 * Only union-member lines (`| "…"`) match, so interleaved `//` comments
 * inside the union are skipped rather than mis-parsed. */
function senderKindUnion(source: string): string[] {
  const start = source.indexOf('type OutboxRow = {');
  expect(start).toBeGreaterThan(-1);
  const kindAt = source.indexOf('  kind:', start);
  expect(kindAt).toBeGreaterThan(-1);
  // The union runs to the first line that terminates it with a semicolon.
  const end = source.indexOf('";', kindAt);
  expect(end).toBeGreaterThan(kindAt);
  const block = source.slice(kindAt, end + 1);
  return [...block.matchAll(/^\s*\|\s*"([a-z_]+)"/gm)].map((m) => m[1]);
}

/** The entries of a `KIND_TO_PREF_COLUMN` object literal, as
 * kind -> pref column. Comment lines never match the `key: "value"`
 * shape, so the argued comments in both files are skipped. */
function kindToPrefColumn(source: string): Record<string, string> {
  const start = source.indexOf('const KIND_TO_PREF_COLUMN');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n};', start);
  expect(end).toBeGreaterThan(start);
  const block = source.slice(start, end);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^\s*([a-z_]+):\s*"([a-z_]+)"/gm)) {
    out[m[1]] = m[2];
  }
  return out;
}

const senderSource = read('send-notifications');
const unsubscribeSource = read('unsubscribe');

const senderKinds = senderKindUnion(senderSource);
const senderMap = kindToPrefColumn(senderSource);
const unsubscribeMap = kindToPrefColumn(unsubscribeSource);

describe('unsubscribe covers every kind send-notifications can emit', () => {
  it('parsed a plausible kind union and both maps', () => {
    // The parse guard. These anchors have been in the union since the
    // first notification shipped; if they ever stop matching, the
    // regexes above are wrong and every other assertion here is
    // vacuous, so this failing is the correct outcome.
    expect(senderKinds).toContain('nudge_daily');
    expect(senderKinds).toContain('social_digest');
    expect(senderKinds.length).toBeGreaterThanOrEqual(5);
    expect(new Set(senderKinds).size).toBe(senderKinds.length);
    expect(Object.keys(senderMap).length).toBe(senderKinds.length);
    expect(Object.keys(unsubscribeMap).length).toBeGreaterThanOrEqual(5);
  });

  it("the sender's own map covers its union exactly", () => {
    // TypeScript already guarantees this (the map is typed
    // `Record<OutboxRow["kind"], keyof PrefRow>`), which is precisely
    // why the sender never had this defect and unsubscribe did — its
    // map is a bare `Record<string, string>`, typed against nothing.
    // Asserted anyway so a parse that drifts out of step with the type
    // shows up here rather than as a false pass below.
    expect(Object.keys(senderMap).sort()).toEqual([...senderKinds].sort());
  });

  it.each(senderKinds)('%s can be unsubscribed from', (kind) => {
    // The property the 8 dead `rest_rejoin` footers violated: an email
    // goes out carrying `k=<kind>`, and unsubscribe must know which
    // switch that kind rides.
    expect(Object.keys(unsubscribeMap)).toContain(kind);
  });

  it.each(senderKinds)('%s unsubscribes from the pref the sender consults', (kind) => {
    // unsubscribe/index.ts's own governing rule, in assertion form: "an
    // unsubscribe link that turns off a DIFFERENT switch than the one
    // the sender consults is worse than no link at all." A wrong column
    // is a 200 and a lie — worse to detect by hand than the 400 was,
    // since nothing visibly fails.
    expect(unsubscribeMap[kind]).toBe(senderMap[kind]);
  });
});
