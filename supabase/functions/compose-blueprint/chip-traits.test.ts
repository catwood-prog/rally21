import {
  ChipAnswer,
  chipTraitKey,
  findDominantChipCandidates,
  mergeChipTraitCandidates,
} from "./chip-traits";
import { BlueprintTrait } from "./synthesis";

const NOW = "2026-07-07T20:00:00.000Z";

/** One question, asked repeatedly — the shape RA1's re-ask cycle creates.
 * Spaced 30 days apart, the cycle's own cadence. */
function asks(
  questionCode: string,
  values: string[],
  startDate = "2026-06-01",
  everyDays = 30
): ChipAnswer[] {
  const dimension = questionCode.split("-")[0];
  const start = new Date(startDate + "T00:00:00.000Z");
  return values.map((v, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * everyDays);
    return {
      local_date: d.toISOString().slice(0, 10),
      question_code: questionCode,
      dimension,
      chip_value: v,
    };
  });
}

describe("chipTraitKey", () => {
  it("namespaces by question code + a slugified chip value, never colliding with LLM trait keys", () => {
    expect(chipTraitKey("ENR-09", "Quiet time")).toBe("chip_enr_09_quiet_time");
    expect(chipTraitKey("VAL-07", "Giver")).toBe("chip_val_07_giver");
  });

  it("gives the two sides of a colliding chip value different keys", () => {
    // MN3's finding, from the live bank: "people" is what DRAINS you in
    // ENR-04 and what RESTORES you in ENR-09. One key would have meant one
    // trait, built from answers that say opposite things.
    expect(chipTraitKey("ENR-04", "people")).not.toBe(chipTraitKey("ENR-09", "people"));
  });
});

describe("findDominantChipCandidates", () => {
  it("surfaces a candidate when one value wins 3 of the last 4 asks of a question", () => {
    const rows = asks("ENR-09", ["quiet", "quiet", "people", "quiet"]);
    const candidates = findDominantChipCandidates(rows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].questionCode).toBe("ENR-09");
    expect(candidates[0].dimension).toBe("ENR");
    expect(candidates[0].chipValue).toBe("quiet");
    expect(candidates[0].evidence_refs).toHaveLength(3);
  });

  it("does not surface a tie (2 of 4) as a candidate", () => {
    const rows = asks("VAL-07", ["spent", "spent", "invested", "invested"]);
    expect(findDominantChipCandidates(rows)).toHaveLength(0);
  });

  it("only looks at the last 4 asks, ignoring older history", () => {
    const older = asks("VAL-07", ["spent", "spent", "spent"], "2026-01-01");
    const recent = asks("VAL-07", ["invested", "slipping", "invested", "invested"], "2026-06-01");
    const candidates = findDominantChipCandidates([...older, ...recent]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].chipValue).toBe("invested");
  });

  it("requires at least 3 asks of the same question before considering it at all", () => {
    expect(findDominantChipCandidates(asks("HAB-03", ["midweek", "midweek"]))).toHaveLength(0);
  });

  it("evaluates each question independently", () => {
    const rows = [
      ...asks("ENR-09", ["quiet", "quiet", "quiet"]),
      ...asks("MOOD-09", ["being heard", "being heard", "being heard"]),
    ];
    const candidates = findDominantChipCandidates(rows);
    expect(candidates.map((c) => c.questionCode).sort()).toEqual(["ENR-09", "MOOD-09"]);
  });

  describe("THE COLLISION (RA1 job 3 / MN3's second finding)", () => {
    it("never lets two questions in one dimension pool into a single trait, even on the same value", () => {
      // Two "people" answers to ENR-04 (what drained you) and two to ENR-09
      // (what restores you). Under the old dimension grouping these were 4
      // of 4 in ENR and built one confident, meaningless "people" trait.
      const rows = [
        ...asks("ENR-04", ["people", "people"], "2026-06-01"),
        ...asks("ENR-09", ["people", "people"], "2026-06-15"),
      ];
      expect(findDominantChipCandidates(rows)).toHaveLength(0);
    });

    it("keeps a genuine per-question repeat and its opposite-meaning twin apart", () => {
      const rows = [
        ...asks("ENR-04", ["people", "people", "people"], "2026-01-01"),
        ...asks("ENR-09", ["quiet", "quiet", "quiet"], "2026-02-01"),
      ];
      const candidates = findDominantChipCandidates(rows);
      expect(candidates).toHaveLength(2);
      const byKey = new Map(candidates.map((c) => [c.key, c.chipValue]));
      expect(byKey.get("chip_enr_04_people")).toBe("people");
      expect(byKey.get("chip_enr_09_quiet")).toBe("quiet");
    });

    it("does not treat the ENR-02 / ENR-11 'evening' pair as one rhythm", () => {
      // "evening" is when ENR-02 says you were MOST ALERT and when ENR-11
      // says you RUN OUT OF STEAM.
      const rows = [
        ...asks("ENR-02", ["evening", "evening"], "2026-06-01"),
        ...asks("ENR-11", ["evening", "evening"], "2026-06-15"),
      ];
      expect(findDominantChipCandidates(rows)).toHaveLength(0);
    });

    it("does not treat the MOT-03 / MOT-05 'mood' pair as one motivator", () => {
      // "mood" is what BROUGHT you in MOT-05 and what made you SKIP in MOT-03.
      const rows = [
        ...asks("MOT-05", ["mood", "mood"], "2026-06-01"),
        ...asks("MOT-03", ["mood", "mood"], "2026-06-15"),
      ];
      expect(findDominantChipCandidates(rows)).toHaveLength(0);
    });
  });
});

describe("mergeChipTraitCandidates", () => {
  const candidate = (key: string, label: string, questionCode: string, evidence: string[] = []) => ({
    key,
    label,
    questionCode,
    dimension: questionCode.split("-")[0],
    chipValue: label,
    evidence_refs: evidence,
  });

  it("introduces a brand-new chip trait at the 0.4 base confidence", () => {
    const result = mergeChipTraitCandidates({
      previousTraits: [],
      candidates: [
        candidate("chip_enr_09_quiet", "quiet", "ENR-09", ["2026-06-01", "2026-07-01", "2026-07-31"]),
      ],
      nowIso: NOW,
    });
    expect(result.newTraitApplied).toBe(true);
    expect(result.traits).toHaveLength(1);
    expect(result.traits[0]).toMatchObject({ key: "chip_enr_09_quiet", confidence: 0.4 });
  });

  it("nudges confidence up by 0.1 on a repeat of the same dominant value", () => {
    const prev: BlueprintTrait = {
      key: "chip_enr_09_quiet", label: "quiet", confidence: 0.4,
      evidence_refs: ["2026-05-01"], first_surfaced_at: "2026-06-01T00:00:00.000Z", last_updated_at: "2026-06-01T00:00:00.000Z",
    };
    const result = mergeChipTraitCandidates({
      previousTraits: [prev],
      candidates: [candidate("chip_enr_09_quiet", "quiet", "ENR-09", ["2026-06-01"])],
      nowIso: NOW,
    });
    expect(result.newTraitApplied).toBe(false);
    expect(result.traits.find((t) => t.key === "chip_enr_09_quiet")?.confidence).toBeCloseTo(0.5);
  });

  it("caps repeat growth at confidence 1.0", () => {
    const prev: BlueprintTrait = {
      key: "chip_enr_09_quiet", label: "quiet", confidence: 0.95,
      evidence_refs: [], first_surfaced_at: NOW, last_updated_at: NOW,
    };
    const result = mergeChipTraitCandidates({
      previousTraits: [prev],
      candidates: [candidate("chip_enr_09_quiet", "quiet", "ENR-09")],
      nowIso: NOW,
    });
    expect(result.traits.find((t) => t.key === "chip_enr_09_quiet")?.confidence).toBe(1);
  });

  it("demotes the old trait by 0.2 when the SAME question's dominant value changes", () => {
    const prev: BlueprintTrait = {
      key: "chip_enr_09_quiet", label: "quiet", confidence: 0.6,
      evidence_refs: [], first_surfaced_at: "2026-05-01T00:00:00.000Z", last_updated_at: "2026-05-01T00:00:00.000Z",
    };
    const result = mergeChipTraitCandidates({
      previousTraits: [prev],
      candidates: [candidate("chip_enr_09_movement", "movement", "ENR-09", ["2026-06-01"])],
      nowIso: NOW,
    });
    expect(result.traits.find((t) => t.key === "chip_enr_09_quiet")?.confidence).toBeCloseTo(0.4);
    expect(result.traits.find((t) => t.key === "chip_enr_09_movement")).toMatchObject({ confidence: 0.4 });
    expect(result.newTraitApplied).toBe(true);
  });

  it("does NOT treat a different question in the same dimension as a contradiction", () => {
    // The other half of the collision: ENR-04 "people" (what drains you)
    // must not demote ENR-09 "quiet" (what restores you). They are two
    // facts about one person, not a person changing their mind.
    const prev: BlueprintTrait = {
      key: "chip_enr_09_quiet", label: "quiet", confidence: 0.6,
      evidence_refs: [], first_surfaced_at: "2026-05-01T00:00:00.000Z", last_updated_at: "2026-05-01T00:00:00.000Z",
    };
    const result = mergeChipTraitCandidates({
      previousTraits: [prev],
      candidates: [candidate("chip_enr_04_people", "people", "ENR-04", ["2026-06-01"])],
      nowIso: NOW,
    });
    expect(result.traits.find((t) => t.key === "chip_enr_09_quiet")?.confidence).toBe(0.6);
    expect(result.traits.find((t) => t.key === "chip_enr_04_people")).toMatchObject({ confidence: 0.4 });
  });

  it("never demotes a contradicted trait below 0", () => {
    const prev: BlueprintTrait = {
      key: "chip_enr_09_quiet", label: "quiet", confidence: 0.1,
      evidence_refs: [], first_surfaced_at: NOW, last_updated_at: NOW,
    };
    const result = mergeChipTraitCandidates({
      previousTraits: [prev],
      candidates: [candidate("chip_enr_09_movement", "movement", "ENR-09")],
      nowIso: NOW,
    });
    expect(result.traits.find((t) => t.key === "chip_enr_09_quiet")?.confidence).toBe(0);
  });

  it("enforces a weekly cap of exactly one brand-new chip trait per run", () => {
    const result = mergeChipTraitCandidates({
      previousTraits: [],
      candidates: [
        candidate("chip_enr_09_quiet", "quiet", "ENR-09"),
        candidate("chip_mood_09_being_heard", "being heard", "MOOD-09"),
      ],
      nowIso: NOW,
    });
    expect(result.traits.filter((t) => t.key.startsWith("chip_"))).toHaveLength(1);
  });

  it("leaves LLM-derived (non-chip) traits completely untouched", () => {
    const llmTrait: BlueprintTrait = {
      key: "consistency_driven", label: "consistency-driven", confidence: 0.7,
      evidence_refs: ["2026-06-01"], first_surfaced_at: "2026-06-01T00:00:00.000Z", last_updated_at: "2026-06-01T00:00:00.000Z",
    };
    const result = mergeChipTraitCandidates({
      previousTraits: [llmTrait],
      candidates: [candidate("chip_enr_09_quiet", "quiet", "ENR-09")],
      nowIso: NOW,
    });
    expect(result.traits.find((t) => t.key === "consistency_driven")).toEqual(llmTrait);
    expect(result.legacyKeysDropped).toEqual([]);
  });

  it("carries forward a previous chip trait unchanged when its question has no candidate this run", () => {
    const prev: BlueprintTrait = {
      key: "chip_hab_03_midweek", label: "midweek", confidence: 0.5,
      evidence_refs: [], first_surfaced_at: NOW, last_updated_at: NOW,
    };
    const result = mergeChipTraitCandidates({ previousTraits: [prev], candidates: [], nowIso: NOW });
    expect(result.traits).toEqual([prev]);
  });

  describe("pre-RA1 keys re-derive rather than migrate", () => {
    it("drops a dimension-grouped chip key instead of carrying its claim forward", () => {
      const legacy: BlueprintTrait = {
        key: "chip_enr_people", label: "people", confidence: 0.9,
        evidence_refs: ["2026-05-01"], first_surfaced_at: NOW, last_updated_at: NOW,
      };
      const result = mergeChipTraitCandidates({ previousTraits: [legacy], candidates: [], nowIso: NOW });
      expect(result.traits).toEqual([]);
      expect(result.legacyKeysDropped).toEqual(["chip_enr_people"]);
    });

    it("lets the same claim come back at base confidence when the raw answers still support it", () => {
      const legacy: BlueprintTrait = {
        key: "chip_enr_people", label: "people", confidence: 0.9,
        evidence_refs: [], first_surfaced_at: NOW, last_updated_at: NOW,
      };
      const result = mergeChipTraitCandidates({
        previousTraits: [legacy],
        candidates: [candidate("chip_enr_09_people", "people", "ENR-09", ["2026-06-01"])],
        nowIso: NOW,
      });
      expect(result.traits).toHaveLength(1);
      // Base confidence, not the inherited 0.9 — the old number was earned
      // by evidence that may have been pointing the other way.
      expect(result.traits[0]).toMatchObject({ key: "chip_enr_09_people", confidence: 0.4 });
      expect(result.legacyKeysDropped).toEqual(["chip_enr_people"]);
    });
  });
});
