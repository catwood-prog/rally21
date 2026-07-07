import {
  BlueprintContent,
  buildSynthesisPrompt,
  emptyBlueprintContent,
  mergeSynthesisProposal,
  parseSynthesisProposal,
  pseudonymizeInput,
  reconcileResponses,
  synthesizeNextContent,
  SynthesisProposal,
} from "./synthesis";

const NOW = "2026-07-07T20:00:00.000Z";
const GENERATED_FROM = { reflections_through: "2026-07-06", completions_through: "2026-07-06", is_backfill: false };

function emptyContent(): BlueprintContent {
  return emptyBlueprintContent({ reflections_through: null, completions_through: null, is_backfill: true });
}

function fiveDates(prefix = "2026-06-2"): string[] {
  return [1, 2, 3, 4, 5].map((d) => `${prefix.slice(0, 8)}${d}`);
}

describe("pseudonymizeInput", () => {
  it("never carries through fields it doesn't declare (no id/name/email possible)", () => {
    const raw = {
      reflections: [
        { local_date: "2026-07-01", mood: 4, line1: "my friends", line2: "patience", question_dimension: "VAL", question_answer: "quiet mornings" },
      ],
      completions: [{ local_date: "2026-07-01" }],
      responses: [{ pattern_key: "test", response: "confirmed" as const, note: null }],
    };
    const out = pseudonymizeInput(raw);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toMatch(/@/); // no email could ever appear
    expect(Object.keys(out)).toEqual(["reflections", "completion_dates", "responses"]);
    expect(Object.keys(out.reflections[0]).sort()).toEqual(
      ["line1", "line2", "local_date", "mood", "question_answer", "question_dimension"].sort()
    );
  });
});

describe("buildSynthesisPrompt — no PII in the outbound payload", () => {
  it("the composed user prompt contains none of a sample name/email/uuid", () => {
    const input = pseudonymizeInput({
      reflections: [{ local_date: "2026-07-01", mood: 4, line1: "grateful for my mom", line2: "learned patience" }],
      completions: [{ local_date: "2026-07-01" }],
      responses: [],
    });
    const { system, user } = buildSynthesisPrompt(input, {
      existingPatternKeys: [],
      hasActiveWant: false,
      rejectedStatements: [],
      isFirstSynthesis: false,
    });
    const combined = system + user;
    expect(combined).not.toContain("catherine.f.harwood@gmail.com");
    expect(combined).not.toContain("75ec0d88-27de-4227-ab62-3d049b369960");
    expect(combined).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/); // no email-shaped string at all
  });
});

describe("parseSynthesisProposal", () => {
  const valid = {
    traits: [{ key: "consistency_driven", label: "Consistency-driven", confidence: 0.7, evidence_refs: fiveDates() }],
    new_pattern: null,
    want: null,
    coverage: { energy: 0.2, values: 0.5, habits: 0.6, mood: 0.9, relationships: 0.3 },
  };

  it("accepts a well-formed proposal", () => {
    expect(parseSynthesisProposal(JSON.stringify(valid))).toEqual(valid);
  });

  it("strips a markdown code fence the model wasn't supposed to add", () => {
    const fenced = "```json\n" + JSON.stringify(valid) + "\n```";
    expect(parseSynthesisProposal(fenced)).toEqual(valid);
  });

  it("rejects invalid JSON", () => {
    expect(parseSynthesisProposal("not json{{{")).toBeNull();
  });

  it("rejects a confidence outside 0-1", () => {
    const bad = { ...valid, traits: [{ ...valid.traits[0], confidence: 1.4 }] };
    expect(parseSynthesisProposal(JSON.stringify(bad))).toBeNull();
  });

  it("rejects a missing coverage field", () => {
    const { coverage, ...rest } = valid;
    expect(parseSynthesisProposal(JSON.stringify(rest))).toBeNull();
  });

  it("rejects a new_pattern missing evidence_dates", () => {
    const bad = { ...valid, new_pattern: { key: "x", statement: "y" } };
    expect(parseSynthesisProposal(JSON.stringify(bad))).toBeNull();
  });
});

describe("mergeSynthesisProposal — the ±0.1 weekly trait cap", () => {
  it("clamps a large confidence jump to the previous value ± 0.1", () => {
    const previous: BlueprintContent = {
      ...emptyContent(),
      traits: [{ key: "t1", label: "Thing", confidence: 0.4, evidence_refs: fiveDates(), first_surfaced_at: "2026-06-01", last_updated_at: "2026-06-01" }],
    };
    const proposal: SynthesisProposal = {
      traits: [{ key: "t1", label: "Thing", confidence: 0.9, evidence_refs: fiveDates() }], // +0.5 jump
      new_pattern: null,
      want: null,
      coverage: {},
    };
    const result = mergeSynthesisProposal({ previous, proposal, nowIso: NOW, generatedFrom: GENERATED_FROM });
    const t1 = result.content.traits.find((t) => t.key === "t1")!;
    expect(t1.confidence).toBeCloseTo(0.5, 5); // 0.4 + 0.1, never 0.9
    expect(result.clampedTraits).toContain("t1");
  });

  it("gates a brand-new trait on the minimum evidence bar", () => {
    const proposal: SynthesisProposal = {
      traits: [{ key: "new_trait", label: "New", confidence: 0.6, evidence_refs: ["2026-06-21", "2026-06-22"] }], // only 2
      new_pattern: null,
      want: null,
      coverage: {},
    };
    const result = mergeSynthesisProposal({ previous: emptyContent(), proposal, nowIso: NOW, generatedFrom: GENERATED_FROM });
    expect(result.content.traits).toHaveLength(0);
    expect(result.droppedForEvidence).toContain("new_trait");
  });
});

describe("mergeSynthesisProposal — one new pattern at a time", () => {
  it("applies a qualifying new_pattern as surfaced", () => {
    const proposal: SynthesisProposal = {
      traits: [],
      new_pattern: { key: "grateful_people", statement: "When you're grateful, it's almost always about people.", evidence_dates: fiveDates() },
      want: null,
      coverage: {},
    };
    const result = mergeSynthesisProposal({ previous: emptyContent(), proposal, nowIso: NOW, generatedFrom: GENERATED_FROM });
    expect(result.appliedNewPattern).toBe(true);
    expect(result.content.patterns).toHaveLength(1);
    expect(result.content.patterns[0].status).toBe("surfaced");
    expect(result.content.patterns[0].source).toBe("synthesis");
  });

  it("drops a new_pattern below the evidence bar without touching existing patterns", () => {
    const previous: BlueprintContent = {
      ...emptyContent(),
      patterns: [{ key: "existing", statement: "Existing pattern.", evidence_dates: fiveDates(), status: "surfaced", source: "synthesis", first_surfaced_at: "2026-06-01", last_updated_at: "2026-06-01" }],
    };
    const proposal: SynthesisProposal = {
      traits: [],
      new_pattern: { key: "thin", statement: "Thin evidence pattern.", evidence_dates: ["2026-06-21"] },
      want: null,
      coverage: {},
    };
    const result = mergeSynthesisProposal({ previous, proposal, nowIso: NOW, generatedFrom: GENERATED_FROM });
    expect(result.appliedNewPattern).toBe(false);
    expect(result.droppedForEvidence).toContain("thin");
    expect(result.content.patterns).toHaveLength(1);
    expect(result.content.patterns[0].key).toBe("existing");
  });
});

describe("mergeSynthesisProposal / reconcileResponses — rejected statement never resurfaces", () => {
  it("bans a not_quite pattern's exact statement permanently, and refuses to re-apply it even if proposed again verbatim", () => {
    const previous: BlueprintContent = {
      ...emptyContent(),
      patterns: [{ key: "old_pattern", statement: "You always journal about work stress.", evidence_dates: fiveDates(), status: "surfaced", source: "synthesis", first_surfaced_at: "2026-06-01", last_updated_at: "2026-06-01" }],
    };
    const responses = [{ pattern_key: "old_pattern", response: "not_quite" as const, note: "not work stress, that was my dad's hospital visit" }];

    const reconciled = reconcileResponses(previous, responses);
    expect(reconciled.patterns[0].status).toBe("rejected");
    expect(reconciled.rejected_statements).toContain("You always journal about work stress.");

    // A future week's model somehow proposes the exact same statement text
    // under a NEW key — it must still be refused.
    const proposal: SynthesisProposal = {
      traits: [],
      new_pattern: { key: "reworded_key", statement: "you always journal about work stress.", evidence_dates: fiveDates() }, // case-insensitive match
      want: null,
      coverage: {},
    };
    const result = mergeSynthesisProposal({ previous: reconciled, proposal, nowIso: NOW, generatedFrom: GENERATED_FROM });
    expect(result.appliedNewPattern).toBe(false);
    expect(result.droppedForRejected).toContain("reworded_key");
  });

  it("a not_quite note changes the next run's output end-to-end via synthesizeNextContent", () => {
    const previous: BlueprintContent = {
      ...emptyContent(),
      patterns: [{ key: "old_pattern", statement: "Old statement.", evidence_dates: fiveDates(), status: "surfaced", source: "synthesis", first_surfaced_at: "2026-06-01", last_updated_at: "2026-06-01" }],
    };
    const responses = [{ pattern_key: "old_pattern", response: "not_quite" as const, note: "wrong" }];
    const proposal: SynthesisProposal = { traits: [], new_pattern: null, want: null, coverage: {} };

    const before = previous.patterns[0].status;
    const result = synthesizeNextContent({ previous, responses, proposal, nowIso: NOW, generatedFrom: GENERATED_FROM });
    expect(before).toBe("surfaced");
    expect(result.content.patterns[0].status).toBe("rejected");
    expect(result.content.rejected_statements).toContain("Old statement.");
  });
});

describe("mergeSynthesisProposal — one want at a time", () => {
  it("applies a qualifying want when none is active", () => {
    const proposal: SynthesisProposal = {
      traits: [],
      new_pattern: null,
      want: { key: "shorter_checkins", statement: "You keep reaching for a calmer morning routine.", evidence_refs: fiveDates() },
      coverage: {},
    };
    const result = mergeSynthesisProposal({ previous: emptyContent(), proposal, nowIso: NOW, generatedFrom: GENERATED_FROM });
    expect(result.appliedWant).toBe(true);
    expect(result.content.wants).toHaveLength(1);
  });

  it("refuses a second want while one is already active", () => {
    const previous: BlueprintContent = {
      ...emptyContent(),
      wants: [{ key: "existing_want", statement: "You keep reaching for X.", evidence_refs: fiveDates(), status: "surfaced", confirmed_at: null }],
    };
    const proposal: SynthesisProposal = {
      traits: [],
      new_pattern: null,
      want: { key: "second_want", statement: "You keep reaching for Y.", evidence_refs: fiveDates() },
      coverage: {},
    };
    const result = mergeSynthesisProposal({ previous, proposal, nowIso: NOW, generatedFrom: GENERATED_FROM });
    expect(result.appliedWant).toBe(false);
    expect(result.content.wants).toHaveLength(1);
    expect(result.content.wants[0].key).toBe("existing_want");
  });
});

describe("backfill produces a non-empty blueprint from pre-existing cohort data", () => {
  it("a first-ever run (empty previous content) with qualifying data produces traits + a pattern", () => {
    const proposal: SynthesisProposal = {
      traits: [{ key: "socially_motivated", label: "Socially motivated", confidence: 0.65, evidence_refs: fiveDates() }],
      new_pattern: { key: "grateful_people", statement: "When you're grateful, it's almost always about people.", evidence_dates: fiveDates() },
      want: null,
      coverage: { energy: 0.1, values: 0.4, habits: 0.5, mood: 0.8, relationships: 0.6 },
    };
    const result = synthesizeNextContent({
      previous: emptyContent(),
      responses: [],
      proposal,
      nowIso: NOW,
      generatedFrom: { reflections_through: "2026-07-06", completions_through: "2026-07-06", is_backfill: true },
    });
    expect(result.content.traits.length).toBeGreaterThan(0);
    expect(result.content.patterns.length).toBeGreaterThan(0);
    expect(result.content.generated_from.is_backfill).toBe(true);
  });
});
