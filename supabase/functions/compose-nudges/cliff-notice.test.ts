/**
 * CV3 (23 Aug) — the two properties of the cliff notice that are NOT
 * database questions, and so are not in cliff-notice.integration.test.ts:
 *
 *   1. NEVER BOTH. It is the one automated nudge for that person that
 *      day, replacing the daily nudge rather than joining it.
 *   2. QUIET HOURS HOLD IT RATHER THAN LOSE IT — asserted through
 *      resolveSendTime's own behaviour, never a re-implementation of the
 *      quiet-hours arithmetic in this file.
 *
 * Both were untestable before this section. The never-both rule lived as
 * a bare `continue` inside a `Deno.serve` module Jest cannot import, and
 * resolveSendTime lived in that same module — so the single place quiet
 * hours are decided had never been executed by a test. CV3 moved the one
 * and extracted the other; neither behaviour changed.
 */
import { resolveSendTime } from './timing';
import { CLIFF_NOTICE_COPY, selectDailyNudgeKind } from './cliff-notice';

describe('CV3 — never both: one automated nudge per person per day', () => {
  const NO_CLIFF = {
    cliffWindowOpen: false,
    glowState: 'glowing',
    emberMissedLocalDate: null,
  };

  test('an open cliff window takes the day', () => {
    expect(selectDailyNudgeKind({ ...NO_CLIFF, cliffWindowOpen: true })).toBe('cliff_notice');
  });

  test('and it takes precedence over the ember nudge, not merely over the daily one', () => {
    // The two cannot in fact co-occur today (an 'embers' state needs an
    // unsheltered break, which puts the last check-in further back than
    // the cliff window allows) — but that is a property of two OTHER
    // functions, and this is the assertion that survives either of them
    // changing.
    expect(
      selectDailyNudgeKind({
        cliffWindowOpen: true,
        glowState: 'embers',
        emberMissedLocalDate: '2026-08-18',
      })
    ).toBe('cliff_notice');
  });

  test('an ordinary day is still the ordinary daily nudge', () => {
    expect(selectDailyNudgeKind(NO_CLIFF)).toBe('nudge_daily');
  });

  test('embers still wins over the daily nudge when there is no cliff', () => {
    expect(
      selectDailyNudgeKind({
        cliffWindowOpen: false,
        glowState: 'embers',
        emberMissedLocalDate: '2026-08-18',
      })
    ).toBe('ember_nudge');
  });

  test('an embers state with no missed date falls through — it has no dedupe key', () => {
    expect(
      selectDailyNudgeKind({
        cliffWindowOpen: false,
        glowState: 'embers',
        emberMissedLocalDate: null,
      })
    ).toBe('nudge_daily');
  });

  test('a cold or unreadable glow never invents a notice', () => {
    expect(selectDailyNudgeKind({ ...NO_CLIFF, glowState: 'cold' })).toBe('nudge_daily');
    expect(selectDailyNudgeKind({ ...NO_CLIFF, glowState: null })).toBe('nudge_daily');
    expect(selectDailyNudgeKind({ ...NO_CLIFF, glowState: undefined })).toBe('nudge_daily');
  });

  test('exactly one kind is ever returned — the rule is a choice, not a set', () => {
    // The shape of the guarantee, stated so a future edit that returns
    // an array (or two flags) has to come here and change it on purpose.
    for (const cliffWindowOpen of [true, false]) {
      for (const glowState of ['glowing', 'embers', 'cold', null]) {
        for (const emberMissedLocalDate of ['2026-08-18', null]) {
          const kind = selectDailyNudgeKind({ cliffWindowOpen, glowState, emberMissedLocalDate });
          expect(['cliff_notice', 'ember_nudge', 'nudge_daily']).toContain(kind);
        }
      }
    }
  });
});

describe('CV3 — quiet hours HOLD the cliff notice rather than lose it', () => {
  // resolveSendTime is the real function the composer calls; nothing
  // here re-derives the wrapped-window arithmetic.
  //
  // WHY THE DISTINCTION MATTERS ON THIS PARTICULAR MORNING: a clamp
  // returns an hour, and the composer simply waits for local time to
  // reach it and then enqueues with scheduled_for = now(). 'skip'
  // returns no hour at all and the day passes in silence. For the daily
  // nudge that is a missed reminder; for the cliff notice it is the
  // whole point of the section, silently not happening.
  const QUIET_START = '22:00:00';
  const QUIET_END = '08:00:00';

  test('a due time inside the MORNING half is clamped forward, not dropped', () => {
    const resolved = resolveSendTime('06:30:00', QUIET_START, QUIET_END);
    expect(resolved).not.toBe('skip');
    expect(resolved).toBe('08:00');
  });

  test('the clamp is never earlier than quiet_end — the hold is real', () => {
    for (const due of ['00:05:00', '03:00:00', '07:59:00']) {
      expect(resolveSendTime(due, QUIET_START, QUIET_END)).toBe('08:00');
    }
  });

  test('a due time outside quiet hours is untouched', () => {
    expect(resolveSendTime('09:15:00', QUIET_START, QUIET_END)).toBe('09:15');
    expect(resolveSendTime('21:59:00', QUIET_START, QUIET_END)).toBe('21:59');
  });

  test('the EVENING half is the one case that is genuinely lost for the day', () => {
    // Named rather than hidden: this is a real hole in the promise and
    // it is inherited, not introduced. A person whose learned send time
    // (or whose alarm hold) lands after 22:00 gets no cliff notice at
    // all that day, and by tomorrow the run is gone. Reported at the
    // section stop rather than fixed here — changing it would change
    // the daily nudge's behaviour too, which is outside this fence.
    expect(resolveSendTime('22:30:00', QUIET_START, QUIET_END)).toBe('skip');
    expect(resolveSendTime('23:59:00', QUIET_START, QUIET_END)).toBe('skip');
  });

  test('quiet hours disabled (start === end) never holds anything', () => {
    expect(resolveSendTime('03:00:00', '08:00:00', '08:00:00')).toBe('03:00');
  });

  test('a non-wrapping quiet window behaves the same way', () => {
    // e.g. a daytime quiet window 13:00-15:00.
    expect(resolveSendTime('12:59:00', '13:00:00', '15:00:00')).toBe('12:59');
    expect(resolveSendTime('13:30:00', '13:00:00', '15:00:00')).toBe('skip');
    expect(resolveSendTime('15:30:00', '13:00:00', '15:00:00')).toBe('15:30');
  });
});

describe("CV3 — Cat's ruled copy, 23 Aug (candidate C, verbatim)", () => {
  // Pinned BYTE-EXACTLY, which is the only form of "verbatim" a test can
  // actually enforce. She ruled all three surfaces at once and ruled that
  // no wording drifts, so a future edit that improves a word has to come
  // here and delete her ruling on purpose.
  test('the subject / push title', () => {
    expect(CLIFF_NOTICE_COPY.subject).toBe("today's the one that counts");
  });

  test('the lock-screen line', () => {
    expect(CLIFF_NOTICE_COPY.pushBody).toBe(
      'a few quiet days have been held for you. today keeps them.'
    );
  });

  test('the email body', () => {
    expect(CLIFF_NOTICE_COPY.html).toBe(
      '<p>a few quiet days have been held for you.</p>' +
        '<p>today is the one that keeps them held — nothing big, just one small thing.</p>' +
        '<p><a href="https://rally21.com">open Rally21</a></p>'
    );
  });

  test('the warmth laws it was ruled against still hold on the shipped strings', () => {
    // Not decoration: these are the laws the register named, checked on
    // the bytes that actually ship rather than trusted to review.
    const all = [
      CLIFF_NOTICE_COPY.subject,
      CLIFF_NOTICE_COPY.pushBody,
      CLIFF_NOTICE_COPY.html,
    ].join(' ');

    expect(all).not.toContain('🔥'); // the no-flame law
    expect(all).not.toContain('🕯️'); // and not the ember candle either

    // LC1 — lowercase. No capital may appear except inside markup, and
    // except the PRODUCT NAME in the shipped open-Rally21 link line, which
    // Cat ruled in verbatim on 23 Aug.
    //
    // THE EXEMPTION IS SANCTIONED (Cat, 23 Aug). The reasoning is kept
    // HERE, beside the guard, rather than only in a commit message —
    // this is where the next person will question it:
    //   1. LC1 GOVERNS COPY, NOT THE PRODUCT'S NAME. The law was written
    //      about the sentences the app says to a person. "Rally21" is
    //      what the app is called, not something it says.
    //   2. FIVE sibling templates already ship this exact line: the ember
    //      ask (both CV2 spell arms), nudge_daily in nudge-lines, the
    //      rest_rejoin email, and compose-digest. Failing it here would
    //      have made this one email the odd one out rather than held a
    //      line.
    //   3. The narrowed guard was proven to STILL BITE BOTH WAYS before
    //      it was accepted — a capital anywhere in the ruled copy still
    //      fails this test, and the exemption is exactly one token wide
    //      on purpose.
    // Stripping tags leaves the link TEXT behind, capital R and all,
    // which is why the substitution below is needed at all.
    const words = all.replace(/<[^>]+>/g, '').replace(/Rally21/g, 'rally21');
    expect(words).toBe(words.toLowerCase());

    // No shame words, no verdicts. The line never addresses what they
    // did or failed to do.
    for (const shame of ['missed', 'failed', 'lost', 'broke', 'streak', "don't", 'last chance']) {
      expect(words).not.toContain(shame);
    }
  });
});
