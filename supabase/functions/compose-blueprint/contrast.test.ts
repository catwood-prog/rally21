import {
  allowedNumbers,
  buildContrastPrompt,
  contrastGate,
  contrastKey,
  ContrastFactSheet,
  ContrastProposal,
  isVulnerableDay,
  mergeContrastCard,
  parseContrastProposal,
  validateContrastProposal,
} from "./contrast";
import { BlueprintContent, emptyBlueprintContent, reconcileResponses } from "./synthesis";

const NOW = "2026-09-20T09:00:00.000Z";

/** A candidate exactly as detect_contrast_candidates returns one: someone
 * who said "let it slip" three of their last four asks, whose weekends in
 * fact held up better than their weekdays by 0.29. */
function sheet(over: Partial<ContrastFactSheet> = {}): ContrastFactSheet {
  return {
    question_code: "HAB-15",
    metric_key: "weekend_vs_weekday_checkin_rate",
    declared_value: "let it slip",
    declared_answer: "let it slip",
    declared_date: "2026-09-13",
    declared_dates: ["2026-07-19", "2026-08-16", "2026-09-13"],
    declared_of_last: 3,
    window_start: "2026-06-23",
    window_end: "2026-09-20",
    observed_days: 90,
    weekend_days: 26,
    weekend_checkins: 22,
    weekday_days: 64,
    weekday_checkins: 35,
    weekend_rate: 0.846,
    weekday_rate: 0.547,
    gap: 0.299,
    disagreement: "weekends_holding",
    ...over,
  };
}

function proposal(over: Partial<ContrastProposal> = {}): ContrastProposal {
  return {
    question_code: "HAB-15",
    declared_quote: "let it slip",
    declared_date: "2026-09-13",
    observed_line: "your weekends have been holding about as well as your weekdays lately.",
    ...over,
  };
}

function contentWith(over: Partial<BlueprintContent> = {}): BlueprintContent {
  return {
    ...emptyBlueprintContent({ reflections_through: null, completions_through: null, is_backfill: false }),
    ...over,
  };
}

describe("parseContrastProposal", () => {
  it("accepts the strict shape, fenced or not", () => {
    const raw = JSON.stringify(proposal());
    expect(parseContrastProposal(raw)).toEqual(proposal());
    expect(parseContrastProposal("```json\n" + raw + "\n```")).toEqual(proposal());
  });

  it("returns null on anything that is not the shape", () => {
    expect(parseContrastProposal("not json")).toBeNull();
    expect(parseContrastProposal("[]")).toBeNull();
    expect(parseContrastProposal(JSON.stringify({ question_code: "HAB-15" }))).toBeNull();
    // An empty sentence is malformed, not a quiet card.
    expect(parseContrastProposal(JSON.stringify(proposal({ observed_line: "" })))).toBeNull();
  });
});

describe("validateContrastProposal — a clean card", () => {
  it("passes, and the quote it carries is byte-identical to the stored answer", () => {
    const s = sheet();
    const p = proposal();
    const verdict = validateContrastProposal(p, [s]);
    expect(verdict.ok).toBe(true);
    // VERIFY 4: not "equivalent", not "trimmed to match" — the same bytes.
    expect(p.declared_quote).toBe(s.declared_answer);
    expect([...p.declared_quote].map((c) => c.charCodeAt(0)))
      .toEqual([...s.declared_answer].map((c) => c.charCodeAt(0)));
  });

  it("permits a sentence that quotes the computed numbers", () => {
    const s = sheet();
    const p = proposal({ observed_line: "you kept 22 of 26 weekend days, against 35 of 64 weekdays." });
    expect(validateContrastProposal(p, [s]).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------
// VERIFY 2 — THE FORGERY PROOF. Three corruptions, each handed to the
// validator separately, each proven DROPPED. Reasoning about the validator
// is not proof; this is.
// ---------------------------------------------------------------------
describe("THE FORGERY PROOF", () => {
  it("drops a MISQUOTED DECLARATION, even one character off", () => {
    const s = sheet();
    const verdict = validateContrastProposal(proposal({ declared_quote: "let it slide" }), [s]);
    expect(verdict).toEqual({ ok: false, reason: "misquoted_declaration" });
  });

  it("drops a declaration that differs only by case or whitespace", () => {
    const s = sheet();
    expect(validateContrastProposal(proposal({ declared_quote: "Let it slip" }), [s]).ok).toBe(false);
    expect(validateContrastProposal(proposal({ declared_quote: "let it slip " }), [s]).ok).toBe(false);
    expect(validateContrastProposal(proposal({ declared_quote: "let it slip." }), [s]).ok).toBe(false);
  });

  it("drops an ALTERED NUMBER — a figure that is not one we computed", () => {
    const s = sheet();
    // 24 is plausible, close to the real 22, and entirely invented.
    const verdict = validateContrastProposal(
      proposal({ observed_line: "you kept 24 of 26 weekend days lately." }),
      [s]
    );
    expect(verdict).toEqual({ ok: false, reason: "invented_number" });
  });

  it("drops an altered number even when every other number is real", () => {
    const s = sheet();
    const verdict = validateContrastProposal(
      proposal({ observed_line: "22 of 26 weekend days, and 35 of 63 weekdays." }),
      [s]
    );
    expect(verdict).toEqual({ ok: false, reason: "invented_number" });
  });

  it("drops an INVENTED EVIDENCE ID — a date they never answered on", () => {
    const s = sheet();
    const verdict = validateContrastProposal(proposal({ declared_date: "2026-09-12" }), [s]);
    expect(verdict).toEqual({ ok: false, reason: "invented_evidence_ref" });
  });

  it("drops a card about a question that was never offered", () => {
    const verdict = validateContrastProposal(proposal({ question_code: "ENR-09" }), [sheet()]);
    expect(verdict).toEqual({ ok: false, reason: "unknown_candidate" });
  });

  it("drops the correction register, however it is phrased", () => {
    const s = sheet();
    for (const line of [
      "actually your weekends hold up fine.",
      "in fact your weekends hold up fine.",
      "but you keep your weekends, on the record.",
      "despite that, your weekends hold up.",
      "you are someone who protects weekends.",
      "your weekends suggest an introvert rhythm.",
    ]) {
      expect(validateContrastProposal(proposal({ observed_line: line }), [s]))
        .toEqual({ ok: false, reason: "banned_register" });
    }
  });

  it("drops an em dash (Cat's standing law: commas, not em dashes)", () => {
    const s = sheet();
    expect(validateContrastProposal(proposal({ observed_line: "your weekends held — mostly." }), [s]))
      .toEqual({ ok: false, reason: "em_dash" });
  });

  it("drops a sentence that has grown into a paragraph", () => {
    const s = sheet();
    const long = "your weekends have been holding up about as well as your weekdays have been holding up lately, on the record at least.";
    expect(validateContrastProposal(proposal({ observed_line: long }), [s]))
      .toEqual({ ok: false, reason: "too_long" });
  });
});

describe("allowedNumbers", () => {
  it("holds the counts and their percentages, and nothing else", () => {
    const permitted = allowedNumbers(sheet());
    expect(permitted.has("22")).toBe(true);
    expect(permitted.has("26")).toBe(true);
    expect(permitted.has("35")).toBe(true);
    expect(permitted.has("64")).toBe(true);
    expect(permitted.has("85")).toBe(true); // weekend rate as a percentage
    expect(permitted.has("55")).toBe(true); // weekday rate
    expect(permitted.has("30")).toBe(true); // the gap
    expect(permitted.has("23")).toBe(false);
    expect(permitted.has("100")).toBe(false);
  });
});

// ---------------------------------------------------------------------
// VERIFY 3 (second half) — the shared weekly budget.
// ---------------------------------------------------------------------
describe("contrastGate — scarcity", () => {
  it("a week that surfaced a new pattern NEVER also carries a contrast", () => {
    expect(contrastGate({ enabled: true, appliedNewPattern: true, vulnerable: false }))
      .toBe("weekly_budget_spent");
  });

  it("holds on a vulnerable day", () => {
    expect(contrastGate({ enabled: true, appliedNewPattern: false, vulnerable: true }))
      .toBe("vulnerable_day");
  });

  it("is silent whenever the kill switch is off, whatever else is true", () => {
    expect(contrastGate({ enabled: false, appliedNewPattern: false, vulnerable: false }))
      .toBe("switch_off");
  });

  it("opens only when the budget is unspent, the day is ordinary and the switch is on", () => {
    expect(contrastGate({ enabled: true, appliedNewPattern: false, vulnerable: false })).toBe("ok");
  });
});

describe("isVulnerableDay", () => {
  it("holds on a missed yesterday or a recent low mood", () => {
    expect(isVulnerableDay({ missedYesterday: true, lowMoodRecently: false })).toBe(true);
    expect(isVulnerableDay({ missedYesterday: false, lowMoodRecently: true })).toBe(true);
    expect(isVulnerableDay({ missedYesterday: false, lowMoodRecently: false })).toBe(false);
  });
});

describe("mergeContrastCard", () => {
  it("applies a clean card as surfaced", () => {
    const result = mergeContrastCard({ previous: contentWith(), sheet: sheet(), proposal: proposal(), nowIso: NOW });
    expect(result.applied).toBe(true);
    expect(result.contrasts).toHaveLength(1);
    expect(result.contrasts[0].key).toBe(contrastKey("HAB-15", "let it slip", "weekend_vs_weekday_checkin_rate"));
    expect(result.contrasts[0].status).toBe("surfaced");
    // The numbers ride along structurally, for the client's evidence line.
    expect(result.contrasts[0].weekend_checkins).toBe(22);
    expect(result.contrasts[0].weekday_days).toBe(64);
  });

  it("never shows the same PAIR twice, whatever the sentence says", () => {
    const first = mergeContrastCard({ previous: contentWith(), sheet: sheet(), proposal: proposal(), nowIso: NOW });
    const reworded = mergeContrastCard({
      previous: contentWith({ contrasts: first.contrasts.map((c) => ({ ...c, status: "confirmed" as const })) }),
      sheet: sheet(),
      proposal: proposal({ observed_line: "your weekends are running level with your weekdays." }),
      nowIso: NOW,
    });
    expect(reworded.applied).toBe(false);
    expect(reworded.skipped).toBe("already_exists");
  });

  it("never stacks a second card while one is still unanswered", () => {
    const first = mergeContrastCard({ previous: contentWith(), sheet: sheet(), proposal: proposal(), nowIso: NOW });
    const second = mergeContrastCard({
      previous: contentWith({ contrasts: first.contrasts }),
      sheet: sheet({ question_code: "HAB-10", declared_value: "before work", declared_answer: "before work" }),
      proposal: proposal({ question_code: "HAB-10", declared_quote: "before work" }),
      nowIso: NOW,
    });
    expect(second.applied).toBe(false);
    expect(second.skipped).toBe("open_card_pending");
  });

  it("refuses a sentence the person has already rejected", () => {
    const result = mergeContrastCard({
      previous: contentWith({ rejected_statements: ["Your weekends have been holding about as well as your weekdays lately."] }),
      sheet: sheet(),
      proposal: proposal(),
      nowIso: NOW,
    });
    expect(result.applied).toBe(false);
    expect(result.skipped).toBe("rejected_statement");
  });
});

describe("reconcileResponses — corrections reach the contrast lane", () => {
  it("a not_quite retires the pair AND banks its sentence permanently", () => {
    const seeded = mergeContrastCard({ previous: contentWith(), sheet: sheet(), proposal: proposal(), nowIso: NOW });
    const before = contentWith({ contrasts: seeded.contrasts });
    const key = seeded.contrasts[0].key;

    const after = reconcileResponses(before, [{ pattern_key: key, response: "not_quite", note: null }]);

    expect(after.contrasts?.[0].status).toBe("rejected");
    expect(after.rejected_statements).toContain(proposal().observed_line);

    // And the ban holds: the same claim cannot come back through the
    // statement door either.
    const retry = mergeContrastCard({
      previous: { ...after, contrasts: [] },
      sheet: sheet(),
      proposal: proposal(),
      nowIso: NOW,
    });
    expect(retry.applied).toBe(false);
    expect(retry.skipped).toBe("rejected_statement");
  });

  it("a confirmed contrast becomes confirmed and bans nothing", () => {
    const seeded = mergeContrastCard({ previous: contentWith(), sheet: sheet(), proposal: proposal(), nowIso: NOW });
    const before = contentWith({ contrasts: seeded.contrasts });
    const after = reconcileResponses(before, [
      { pattern_key: seeded.contrasts[0].key, response: "confirmed", note: null },
    ]);
    expect(after.contrasts?.[0].status).toBe("confirmed");
    expect(after.rejected_statements).toHaveLength(0);
  });

  it("leaves documents written before MN3 alone", () => {
    const legacy = contentWith();
    delete (legacy as { contrasts?: unknown }).contrasts;
    const after = reconcileResponses(legacy, []);
    expect(after.contrasts).toEqual([]);
  });
});

describe("buildContrastPrompt", () => {
  it("hands the model facts and forbids it from computing any", () => {
    const { system, user } = buildContrastPrompt([sheet()]);
    expect(system).toContain("may not compute");
    expect(system).toContain("STRICT JSON");
    expect(JSON.parse(user).candidates).toHaveLength(1);
  });
});
