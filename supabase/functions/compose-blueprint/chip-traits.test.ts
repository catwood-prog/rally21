import {
  ChipAnswer,
  chipTraitKey,
  findDominantChipCandidates,
  mergeChipTraitCandidates,
} from "./chip-traits";
import { BlueprintTrait } from "./synthesis";

const NOW = "2026-07-07T20:00:00.000Z";

function answers(dimension: string, values: string[], startDate = "2026-06-01"): ChipAnswer[] {
  const start = new Date(startDate + "T00:00:00.000Z");
  return values.map((v, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    return { local_date: d.toISOString().slice(0, 10), dimension, chip_value: v };
  });
}

describe("chipTraitKey", () => {
  it("namespaces by dimension + a slugified chip value, never colliding with LLM trait keys", () => {
    expect(chipTraitKey("ENR", "Quiet time")).toBe("chip_enr_quiet_time");
    expect(chipTraitKey("VAL", "Giver")).toBe("chip_val_giver");
  });
});

describe("findDominantChipCandidates", () => {
  it("surfaces a candidate when one value wins 3 of the last 4 asks in a dimension", () => {
    const rows = answers("ENR", ["Quiet time", "Quiet time", "With people", "Quiet time"]);
    const candidates = findDominantChipCandidates(rows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].dimension).toBe("ENR");
    expect(candidates[0].chipValue).toBe("Quiet time");
    expect(candidates[0].evidence_refs).toHaveLength(3);
  });

  it("does not surface a tie (2 of 4) as a candidate", () => {
    const rows = answers("VAL", ["Giver", "Giver", "Receiver", "Receiver"]);
    expect(findDominantChipCandidates(rows)).toHaveLength(0);
  });

  it("only looks at the last 4 asks, ignoring older history", () => {
    // 3 "Giver" answers, all outside the trailing window of 4, plus 4
    // recent answers where "Receiver" wins 3-1 -- should surface
    // Receiver, not Giver, since only the last 4 count.
    const older = answers("VAL", ["Giver", "Giver", "Giver"], "2026-01-01");
    const recent = answers("VAL", ["Receiver", "Both", "Receiver", "Receiver"], "2026-06-01");
    const candidates = findDominantChipCandidates([...older, ...recent]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].chipValue).toBe("Receiver");
  });

  it("requires at least 3 total asks before considering a dimension at all", () => {
    const rows = answers("HAB", ["Morning", "Morning"]);
    expect(findDominantChipCandidates(rows)).toHaveLength(0);
  });

  it("evaluates each dimension independently", () => {
    const rows = [
      ...answers("ENR", ["Quiet time", "Quiet time", "Quiet time"]),
      ...answers("VAL", ["Giver", "Giver", "Giver"]),
    ];
    const candidates = findDominantChipCandidates(rows);
    expect(candidates.map((c) => c.dimension).sort()).toEqual(["ENR", "VAL"]);
  });
});

describe("mergeChipTraitCandidates", () => {
  it("introduces a brand-new chip trait at the 0.4 base confidence", () => {
    const result = mergeChipTraitCandidates({
      previousTraits: [],
      candidates: [{ key: "chip_enr_quiet_time", label: "Quiet time", dimension: "ENR", chipValue: "Quiet time", evidence_refs: ["2026-06-01", "2026-06-08", "2026-06-15"] }],
      nowIso: NOW,
    });
    expect(result.newTraitApplied).toBe(true);
    expect(result.traits).toHaveLength(1);
    expect(result.traits[0]).toMatchObject({ key: "chip_enr_quiet_time", confidence: 0.4 });
  });

  it("nudges confidence up by 0.1 on a repeat of the same dominant value", () => {
    const prev: BlueprintTrait = {
      key: "chip_enr_quiet_time", label: "Quiet time", confidence: 0.4,
      evidence_refs: ["2026-05-01"], first_surfaced_at: "2026-06-01T00:00:00.000Z", last_updated_at: "2026-06-01T00:00:00.000Z",
    };
    const result = mergeChipTraitCandidates({
      previousTraits: [prev],
      candidates: [{ key: "chip_enr_quiet_time", label: "Quiet time", dimension: "ENR", chipValue: "Quiet time", evidence_refs: ["2026-06-01", "2026-06-08", "2026-06-15"] }],
      nowIso: NOW,
    });
    expect(result.newTraitApplied).toBe(false);
    expect(result.traits.find((t) => t.key === "chip_enr_quiet_time")?.confidence).toBeCloseTo(0.5);
  });

  it("caps repeat growth at confidence 1.0", () => {
    const prev: BlueprintTrait = {
      key: "chip_enr_quiet_time", label: "Quiet time", confidence: 0.95,
      evidence_refs: [], first_surfaced_at: NOW, last_updated_at: NOW,
    };
    const result = mergeChipTraitCandidates({
      previousTraits: [prev],
      candidates: [{ key: "chip_enr_quiet_time", label: "Quiet time", dimension: "ENR", chipValue: "Quiet time", evidence_refs: [] }],
      nowIso: NOW,
    });
    expect(result.traits.find((t) => t.key === "chip_enr_quiet_time")?.confidence).toBe(1);
  });

  it("demotes the old trait by 0.2 on a contradiction (a new value now dominates) and surfaces the new one fresh", () => {
    const prev: BlueprintTrait = {
      key: "chip_val_giver", label: "Giver", confidence: 0.6,
      evidence_refs: [], first_surfaced_at: "2026-05-01T00:00:00.000Z", last_updated_at: "2026-05-01T00:00:00.000Z",
    };
    const result = mergeChipTraitCandidates({
      previousTraits: [prev],
      candidates: [{ key: "chip_val_receiver", label: "Receiver", dimension: "VAL", chipValue: "Receiver", evidence_refs: ["2026-06-01", "2026-06-08", "2026-06-15"] }],
      nowIso: NOW,
    });
    const old = result.traits.find((t) => t.key === "chip_val_giver");
    const fresh = result.traits.find((t) => t.key === "chip_val_receiver");
    expect(old?.confidence).toBeCloseTo(0.4);
    expect(fresh).toMatchObject({ confidence: 0.4 });
    expect(result.newTraitApplied).toBe(true);
  });

  it("never demotes a contradicted trait below 0", () => {
    const prev: BlueprintTrait = {
      key: "chip_val_giver", label: "Giver", confidence: 0.1,
      evidence_refs: [], first_surfaced_at: NOW, last_updated_at: NOW,
    };
    const result = mergeChipTraitCandidates({
      previousTraits: [prev],
      candidates: [{ key: "chip_val_receiver", label: "Receiver", dimension: "VAL", chipValue: "Receiver", evidence_refs: [] }],
      nowIso: NOW,
    });
    expect(result.traits.find((t) => t.key === "chip_val_giver")?.confidence).toBe(0);
  });

  it("enforces a weekly cap of exactly one brand-new chip trait per run", () => {
    const result = mergeChipTraitCandidates({
      previousTraits: [],
      candidates: [
        { key: "chip_enr_quiet_time", label: "Quiet time", dimension: "ENR", chipValue: "Quiet time", evidence_refs: [] },
        { key: "chip_val_giver", label: "Giver", dimension: "VAL", chipValue: "Giver", evidence_refs: [] },
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
      candidates: [{ key: "chip_enr_quiet_time", label: "Quiet time", dimension: "ENR", chipValue: "Quiet time", evidence_refs: [] }],
      nowIso: NOW,
    });
    expect(result.traits.find((t) => t.key === "consistency_driven")).toEqual(llmTrait);
  });

  it("carries forward a previous chip trait unchanged when its dimension has no candidate this run", () => {
    const prev: BlueprintTrait = {
      key: "chip_hab_morning", label: "Morning", confidence: 0.5,
      evidence_refs: [], first_surfaced_at: NOW, last_updated_at: NOW,
    };
    const result = mergeChipTraitCandidates({ previousTraits: [prev], candidates: [], nowIso: NOW });
    expect(result.traits).toEqual([prev]);
  });
});
