/**
 * MS1 job 4 — THE GUARD THAT MAKES THIS THE LAST TIME.
 *
 * A convention nobody can see decays (RE2's cooperative mutex, three days
 * before this). The convention here: **a catch that can receive a
 * server-authored refusal must read it**, via `lib/serverRefusal.ts`.
 *
 * WHY THIS DERIVES THE SITE LIST INSTEAD OF HOLDING ONE. The obvious
 * guard — "fail on a user-facing catch using the bare `instanceof Error`
 * idiom, with the reporting sites allowlisted" — cannot work here, and
 * MS1 job 1 is why: of the 60 `instanceof Error` sites in `app/` + `lib/`,
 * **53 keep the bare idiom legitimately**. 46 because their server side
 * raises nothing a person should read (a plain `.from(...)` write can
 * never raise a P0001 at all — no trigger in this schema raises), and 5
 * because the idiom is genuinely correct there (`reportContent` throws a
 * real `Error` carrying the edge function's own copy; `auth-context`
 * surfaces real Google/Apple SDK errors). An allowlist of 53 is not a
 * convention — it is a photograph of one afternoon, it goes stale on the
 * next screen, and it gives false confidence while doing it.
 *
 * So this guards the PROPERTY, not the instances, in three derived steps:
 *
 *   1. read every migration, and find the RPCs whose LATEST definition
 *      raises a `P0001` sentence somebody wrote for a person;
 *   2. read `lib/`, and map each exported reader to the RPCs it reaches;
 *   3. read `app/`, and for every try/catch whose try reaches one of
 *      those RPCs, require the catch to consult `serverRefusal`.
 *
 * IT FAILS CLOSED. A brand-new RPC that raises is treated as human until
 * somebody says otherwise in `RAISES_NOTHING_HUMAN` below, with a reason.
 * That is the direction the failure should point: a missed sentence is
 * invisible in production (it looks like a working screen showing a
 * generic line), while a false positive here is one loud test.
 */

import { execFileSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import * as ts from 'typescript';

const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const LIB = join(ROOT, 'lib');
const APP = join(ROOT, 'app');

/** The helper every qualifying catch must consult. */
const HELPER = /\bserverRefusal(Or)?\b/;

/**
 * RPCs that raise, but raise nothing a person should read — so their call
 * sites deliberately keep their own friendly line. Every entry needs a
 * reason, because every entry is a claim that the SQL author wrote those
 * words for a developer and not for a user.
 *
 * The bar: would you put this sentence on a screen, in front of the person
 * who just tapped the button? 'not authenticated' is a guard that fires
 * only when the client is already broken; "This circle is already full"
 * is an answer to a question somebody asked.
 */
const RAISES_NOTHING_HUMAN: Record<string, string> = {
  // Pure auth guards. Every one of these is unreachable from a signed-in
  // screen, and reads as gibberish if it somehow arrives.
  return_from_away: "'not authenticated' only",
  get_daily_question: "'not authenticated' only",
  get_my_blueprint: "'not authenticated' only",
  get_my_glow: "'not authenticated' only",
  get_week_for_user: "'not authenticated' only",
  get_glow_for_user: "'not authenticated' only",
  get_glow_for_circle_mates: "'not authenticated' only",
  get_pair_streaks: "'not authenticated' only",
  get_coverable_members: "'not authenticated' only",
  get_pebble_candidates: "'not authenticated' only",
  unlike_card: "'not signed in' only",
  finish_my_rally: "'not authenticated' only",
  resume_my_rally: "'not authenticated' only",
  record_my_rally_cliff: "'not authenticated' only",
  mark_blueprint_pattern_surfaced: "'not authenticated' only",
  mark_wrapped_offered: "'not authenticated' only",
  mark_celebration_seen: "'not authenticated' only",
  glow_day_states: "'not authenticated' only",
  check_glow_milestone: "'not authenticated' only",
  record_card_event: "'not authenticated' only",
  rally_on_circle: "'not authenticated' only",
  set_keep_going_obstacle: "'not authenticated' only",
  get_checkin_presence: "'not authenticated' only",
  practice_domain_of: 'internal mapping assertions; never called from a screen',
  founder_activation_funnel: 'founder-gated analytics read, dashboard only',

  // Founder-only moderation. The screen redirects non-founders before any
  // of these can be called, so 'founder only' is a backstop, not an answer.
  // NOTE: remove_member_from_circle is deliberately NOT here — Cat's
  // ruling, 11 Aug — because its two sentences are real, and a moderation
  // act failing on a founder-only screen is the one place a generic line
  // leaves you debugging blind.
  is_founder: 'no raises today; listed so a future guard clause is a decision',
  get_pending_reports: "'founder only' backstop",
  admin_set_report_status: "'founder only' / 'invalid status' — both internal",
  admin_delete_wall_message: "'founder only' backstop",
  admin_hide_circle: "'founder only' backstop",

  // Argument validation the client cannot get wrong without a code change.
  report_content: "'invalid target kind' — the client passes a typed union",
};

// ---------------------------------------------------------------------
// Step 1 — which RPCs compose a sentence for a person?
// ---------------------------------------------------------------------

/** Every `create [or replace] function` body in a file, in order. */
function functionBodies(sql: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(/gi;
  const starts: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) starts.push({ name: m[1], at: m.index });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : sql.length;
    out.push({ name: s.name, body: sql.slice(s.at, end) });
  });
  return out;
}

function rpcsThatRaiseForPeople(): Map<string, string[]> {
  // Filenames are timestamp-prefixed, so lexical order IS apply order and
  // the last definition of a name is the one live in the database.
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const latest = new Map<string, string>();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    for (const { name, body } of functionBodies(sql)) latest.set(name, body);
  }

  const human = new Map<string, string[]>();
  for (const [name, body] of latest) {
    if (name in RAISES_NOTHING_HUMAN) continue;
    // `raise exception 'text'` — the quoted literal only. A `raise
    // exception using ...` or a re-raise carries no literal and is skipped.
    const messages = [...body.matchAll(/raise\s+exception\s+'((?:[^']|'')*)'/gi)].map((r) =>
      r[1].replace(/''/g, "'")
    );
    if (messages.length) human.set(name, messages);
  }
  return human;
}

// ---------------------------------------------------------------------
// Step 2 — which lib readers reach those RPCs?
// ---------------------------------------------------------------------

function tsFiles(dir: string, recurse: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (recurse) out.push(...tsFiles(full, true));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** The declared name of a top-level function or `const x = ...` binding. */
function declaredName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableStatement(node)) {
    const d = node.declarationList.declarations[0];
    if (d && ts.isIdentifier(d.name)) return d.name.text;
  }
  return null;
}

function calleeName(node: ts.CallExpression): string | null {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  return null;
}

/** Direct `.rpc('name')` literals inside a node. */
function directRpcs(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      calleeName(n) === 'rpc' &&
      n.arguments.length &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      found.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Every identifier called inside a node — how one lib reader reaches
 *  another (`createCircleWithDose` → `createCircle` → `create_circle`). */
function calledIdentifiers(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) found.push(n.expression.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** name → RPCs it reaches, closed over calls between lib readers. */
function libReaderRpcs(): Map<string, Set<string>> {
  const direct = new Map<string, Set<string>>();
  const calls = new Map<string, Set<string>>();

  for (const file of tsFiles(LIB, false)) {
    const src = parse(file);
    src.forEachChild((node) => {
      const name = declaredName(node);
      if (!name) return;
      const rpcs = direct.get(name) ?? new Set<string>();
      directRpcs(node).forEach((r) => rpcs.add(r));
      direct.set(name, rpcs);
      const callees = calls.get(name) ?? new Set<string>();
      calledIdentifiers(node).forEach((c) => callees.add(c));
      calls.set(name, callees);
    });
  }

  // Transitive closure. The graph is tiny (a few hundred nodes) and a
  // fixpoint loop is easier to trust than hand-rolled recursion depth.
  const reach = new Map<string, Set<string>>();
  for (const [name, rpcs] of direct) reach.set(name, new Set(rpcs));
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, callees] of calls) {
      const mine = reach.get(name) ?? new Set<string>();
      const before = mine.size;
      for (const callee of callees) {
        for (const r of reach.get(callee) ?? []) mine.add(r);
      }
      if (mine.size !== before) changed = true;
      reach.set(name, mine);
    }
  }
  return reach;
}

// ---------------------------------------------------------------------
// Step 3 — which screen catches can receive one of those sentences?
// ---------------------------------------------------------------------

type Site = { file: string; line: number; rpcs: string[]; consultsHelper: boolean };

/** A catch that only hands the error to `captureError` REPORTS and never
 *  DISPLAYS — bucket (b) of the job 1 classification, recognised by shape
 *  rather than by being listed. `lib/sentry.ts` is the archetype. */
function catchOnlyReports(clause: ts.CatchClause): boolean {
  const binding = clause.variableDeclaration?.name;
  if (!binding || !ts.isIdentifier(binding)) return true; // `catch {}` — uses nothing
  const name = binding.text;
  let usesOutsideReporting = false;
  const visit = (n: ts.Node, insideReporter: boolean) => {
    if (ts.isIdentifier(n) && n.text === name && !insideReporter) usesOutsideReporting = true;
    const reporting =
      ts.isCallExpression(n) && (calleeName(n) === 'captureError' || calleeName(n) === 'captureMessage');
    ts.forEachChild(n, (c) => visit(c, insideReporter || reporting));
  };
  ts.forEachChild(clause.block, (c) => visit(c, false));
  return !usesOutsideReporting;
}

function screenSites(humanRpcs: Map<string, string[]>, reach: Map<string, Set<string>>): Site[] {
  const sites: Site[] = [];
  for (const file of tsFiles(APP, true)) {
    const src = parse(file);
    const visit = (node: ts.Node) => {
      if (ts.isTryStatement(node) && node.catchClause) {
        const reached = new Set<string>();
        for (const callee of calledIdentifiers(node.tryBlock)) {
          for (const rpc of reach.get(callee) ?? []) if (humanRpcs.has(rpc)) reached.add(rpc);
        }
        if (reached.size && !catchOnlyReports(node.catchClause)) {
          const { line } = src.getLineAndCharacterOfPosition(node.catchClause.getStart(src));
          sites.push({
            file: file.slice(ROOT.length + 1),
            line: line + 1,
            rpcs: [...reached].sort(),
            consultsHelper: HELPER.test(node.catchClause.getText(src)),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return sites;
}

/**
 * `circle.tsx` is DEC1's ~2,200-line decomposition target and was fenced
 * read-only for MS1, so its qualifying catches are recorded here rather
 * than fixed. The COUNT is asserted exactly: when DEC1 splits the file,
 * or anyone adds a catch to it, this number moves and somebody has to
 * come back and make a decision instead of inheriting one.
 */
const KNOWN_UNSWEPT: Record<string, number> = {
  'app/(app)/(tabs)/circle.tsx': 3,
};

// ---------------------------------------------------------------------

describe('MS1 — a server-authored refusal is never thrown away', () => {
  const humanRpcs = rpcsThatRaiseForPeople();
  const reach = libReaderRpcs();
  const sites = screenSites(humanRpcs, reach);

  it('derives a believable set of human-raising RPCs from the migrations', () => {
    // A smoke test on the derivation itself: if the SQL parse silently
    // stopped working, every assertion below would pass vacuously and
    // this guard would be decoration. These four are the refusals VERIFY
    // 3 and 4 prove end to end on the real build.
    expect([...humanRpcs.keys()].sort()).toEqual(
      expect.arrayContaining(['create_circle', 'edit_circle', 'gift_pebble', 'join_public_circle'])
    );
    expect(humanRpcs.get('join_public_circle')).toContain('This circle is already full');
    expect(humanRpcs.get('edit_circle')).toContain('The circle needs a name');
    expect(humanRpcs.get('gift_pebble')).toContain('your nest is empty');
  });

  it('reaches those RPCs through the lib readers screens actually import', () => {
    // The other half of the derivation: the call graph has to close over
    // createCircleWithDose → createCircle → create_circle, or the two
    // setup screens would look clean by accident.
    expect(reach.get('createCircleWithDose')).toContain('create_circle');
    expect(reach.get('joinPublicCircle')).toContain('join_public_circle');
    expect(reach.get('giftPebble')).toContain('gift_pebble');
  });

  it('finds every catch that can receive one, and finds more than a handful', () => {
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });

  it('has no catch that discards a sentence written for a person', () => {
    const offenders = sites
      .filter((s) => !s.consultsHelper)
      .filter((s) => !(s.file in KNOWN_UNSWEPT));
    expect(
      offenders.map((s) => `${s.file}:${s.line} (reaches ${s.rpcs.join(', ')}) — use serverRefusal()`)
    ).toEqual([]);
  });

  it('holds circle.tsx at exactly its known, fenced count', () => {
    for (const [file, expected] of Object.entries(KNOWN_UNSWEPT)) {
      const unswept = sites.filter((s) => s.file === file && !s.consultsHelper);
      expect({ [file]: unswept.length }).toEqual({ [file]: expected });
    }
  });

  it('is measuring the real tree — no ignored or untracked source', () => {
    // Cheap paranoia, and it has a precedent: CR1 verified a bundle that
    // was not the one being served. If `app/` were ever moved or an
    // .expo/ copy shadowed it, the walk above would quietly find nothing.
    const tracked = execFileSync('git', ['ls-files', 'app', 'lib', 'supabase/migrations'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
    expect(tracked.filter((f) => f.endsWith('.sql')).length).toBeGreaterThan(100);
    expect(tracked.filter((f) => f.startsWith('app/') && f.endsWith('.tsx')).length).toBeGreaterThan(30);
  });
});
