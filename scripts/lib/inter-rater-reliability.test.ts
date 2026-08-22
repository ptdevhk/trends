import { describe, expect, it } from "vitest";

import {
  fleissKappa,
  gwetAC1,
  gwetAC2,
  kappaBand,
  quadraticWeightedKappa,
} from "./inter-rater-reliability.js";

// ---------------------------------------------------------------------------
// Reference values (hermetic): generated offline with Python 3.14 (throwaway
// venv /tmp/irr-ref, not committed), script /tmp/irr-ref/gen_refs.py.
//   - QWK: direct numpy implementation (Cohen 1968, quadratic weights
//     w_ij = 1 - (i-j)^2/(K-1)^2), cross-checked against scikit-learn 1.9.0
//     `cohen_kappa_score(weights="quadratic")` — identical to 1e-15.
//   - Fleiss: statsmodels 0.14.6 `stats.stats.inter_rater.fleiss_kappa` on
//     subjects x categories count tables.
//   - Gwet AC1/AC2: Gwet (2008) chance-corrected agreement formulas
//     (AC1 pe = sum_j pi_j(1-pi_j)/(K-1); AC2 pe* = (1 - pi^T W pi)/(K-1)),
//     implemented in numpy; derivation hand-verified on the t2 margins.
//   - Multi-rater quadratic kappa (Fleiss-style chance with quadratic
//     weights): numpy implementation; reduces exactly to Cohen QWK when the
//     two raters share identical margins (mrq_t3_2rater === qwk t3).
// ---------------------------------------------------------------------------

// t1: 10 paired ratings, K=5, uniform-ish margins.
const T1_A = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5];
const T1_B = [1, 2, 2, 4, 5, 2, 3, 3, 4, 5];

// t2: prevalence-paradox table — imbalanced margins (mostly 3s), consistent
// ratings. Cohen's kappa = -0.111 (paradoxically low) while AC1 = 0.679.
const T2_A = [3, 3, 3, 3, 3, 3, 2, 3, 3, 4, 3, 3, 3, 3, 2, 3, 3, 3, 4, 3];
const T2_B = [3, 3, 3, 2, 3, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];

// t3: identical margins (1x3, 2x2, 3x5), permuted — reduction test table.
const T3_A = [1, 1, 1, 2, 2, 3, 3, 3, 3, 3];
const T3_B = [1, 1, 2, 1, 3, 2, 3, 3, 3, 3];

// shifted: cyclic shift — systematic disagreement, QWK = 0 exactly.
const SHIFT_A = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5];
const SHIFT_B = [2, 3, 4, 5, 1, 2, 3, 4, 5, 1];

const QWK_REF = {
  t1: 0.9189189189189186, // sklearn cross-check: 0.9189189189189189
  t2: 0.0,
  t3: 0.7368421052631584, // sklearn: 0.736842105263158
  shifted: 0.0, // sklearn: 2.22e-16
};

const AC1_REF = {
  t1: 0.625585023400936,
  t2: 0.6786072982926012,
  t3: 0.5266272189349112,
  shifted: -0.25,
};

const AC2_REF = {
  t1: 0.9801011524749191,
  t2: 0.9811616954474097,
  t3: 0.9743918053777209,
  shifted: 0.7333333333333333,
};

const AC2_LINEAR_REF = {
  t1: 0.9170411337711718,
  t2: 0.9236762601367468,
  shifted: 0.5555555555555556,
};

// --- Fleiss tables (subjects x categories counts) ---------------------------
// Classic Fleiss (1971) worked example: 14 subjects, 5 raters, 5 categories.
const FLEISS_CLASSIC = [
  [0, 0, 0, 0, 14],
  [0, 2, 6, 4, 2],
  [0, 0, 3, 5, 6],
  [0, 3, 9, 2, 0],
  [2, 2, 8, 1, 1],
  [7, 7, 0, 0, 0],
  [3, 2, 6, 3, 0],
  [2, 5, 3, 2, 2],
  [6, 5, 2, 1, 0],
  [0, 2, 2, 3, 7],
  [0, 0, 3, 2, 9],
  [0, 0, 0, 5, 9],
  [0, 3, 9, 2, 0],
  [0, 4, 7, 3, 0],
];

// Good agreement, spread margins: 15 subjects x 5 raters (10 perfect rows,
// 5 rows with a single 4-1 split). Kappa = 0.833 — panel gate-pass reference.
const FLEISS_GOOD = [
  [5, 0, 0, 0, 0],
  [0, 5, 0, 0, 0],
  [0, 0, 5, 0, 0],
  [0, 0, 0, 5, 0],
  [0, 0, 0, 0, 5],
  [4, 1, 0, 0, 0],
  [0, 4, 1, 0, 0],
  [0, 0, 4, 1, 0],
  [0, 0, 1, 4, 0],
  [1, 0, 0, 0, 4],
  [5, 0, 0, 0, 0],
  [0, 5, 0, 0, 0],
  [0, 0, 5, 0, 0],
  [0, 0, 0, 5, 0],
  [0, 0, 0, 0, 5],
];

// Prevalence-skewed panel: 10 subjects x 4 raters, mostly category 3.
// Kappa = -0.034 (prevalence paradox on the Fleiss side too).
const FLEISS_HIGH = [
  [0, 0, 4, 0, 0],
  [0, 1, 3, 0, 0],
  [0, 0, 4, 0, 0],
  [0, 0, 3, 1, 0],
  [1, 0, 3, 0, 0],
  [0, 0, 4, 0, 0],
  [0, 0, 3, 1, 0],
  [0, 1, 3, 0, 0],
  [0, 0, 4, 0, 0],
  [0, 0, 2, 2, 0],
];

// Moderate agreement: 10 subjects x 5 raters, clustered 2/3/4.
const FLEISS_MID = [
  [3, 2, 0, 0, 0],
  [2, 3, 0, 0, 0],
  [0, 3, 2, 0, 0],
  [0, 2, 3, 0, 0],
  [0, 0, 3, 2, 0],
  [0, 0, 2, 3, 0],
  [0, 0, 0, 3, 2],
  [0, 0, 0, 2, 3],
  [1, 1, 3, 0, 0],
  [0, 1, 3, 1, 0],
];

// Multi-rater quadratic references (ratings matrices built from the count
// tables above, raters exchangeable).
const MRQ_REF = {
  t3_2rater: 0.7368421052631582, // must equal QWK t3 (identical margins)
  fleiss_good: 0.8629636396857295,
  fleiss_mid: 0.7231367853935954,
};

/** Expand subjects x categories counts into a raters x subjects matrix. */
function countsToRatings(table: number[][]): number[][] {
  const nRaters = table[0].reduce((a, b) => a + b, 0);
  const out: number[][] = Array.from({ length: nRaters }, () => []);
  for (const counts of table) {
    const col: number[] = [];
    counts.forEach((n, cat) => {
      for (let t = 0; t < n; t++) col.push(cat + 1);
    });
    // Rater r receives the r-th entry of the expanded column (raters are
    // exchangeable) — mirrors the Python reference counts_to_ratings.
    out.forEach((row, r) => row.push(col[r]));
  }
  return out;
}

describe("quadraticWeightedKappa", () => {
  it("matches the offline reference values", () => {
    expect(quadraticWeightedKappa(T1_A, T1_B)).toBeCloseTo(QWK_REF.t1, 9);
    expect(quadraticWeightedKappa(T2_A, T2_B)).toBeCloseTo(QWK_REF.t2, 9);
    expect(quadraticWeightedKappa(T3_A, T3_B)).toBeCloseTo(QWK_REF.t3, 9);
    expect(quadraticWeightedKappa(SHIFT_A, SHIFT_B)).toBeCloseTo(QWK_REF.shifted, 9);
  });

  it("returns 1 for perfect agreement", () => {
    expect(quadraticWeightedKappa(T1_A, T1_A)).toBe(1);
    expect(quadraticWeightedKappa([5, 5, 5, 5], [5, 5, 5, 5])).toBe(1);
  });

  it("returns 1 when all ratings fall in a single category", () => {
    expect(quadraticWeightedKappa([3, 3, 3, 3], [3, 3, 3, 3])).toBe(1);
  });

  it("honors a custom category count", () => {
    // K=3 weights: w_ij = 1 - (i-j)^2/4; one magnitude-1 disagreement of 4
    // ratings on 1..3 gives QWK = (0.9375 - 0.6875)/(1 - 0.6875) = 0.8.
    expect(
      quadraticWeightedKappa([1, 2, 3, 3], [1, 2, 2, 3], 3)
    ).toBeCloseTo(0.8, 9);
  });
});

describe("gwetAC1", () => {
  it("matches the offline reference values", () => {
    expect(gwetAC1(T1_A, T1_B)).toBeCloseTo(AC1_REF.t1, 9);
    expect(gwetAC1(T2_A, T2_B)).toBeCloseTo(AC1_REF.t2, 9);
    expect(gwetAC1(T3_A, T3_B)).toBeCloseTo(AC1_REF.t3, 9);
    expect(gwetAC1(SHIFT_A, SHIFT_B)).toBeCloseTo(AC1_REF.shifted, 9);
  });

  it("returns 1 for perfect agreement", () => {
    expect(gwetAC1(T1_A, T1_A)).toBe(1);
  });

  it("is prevalence-paradox resistant (Cohen kappa = -0.111 on t2)", () => {
    // t2 is imbalanced-but-consistent: QWK ~ 0 by chance correction, Cohen
    // kappa = -0.111 (reference), yet AC1 stays high.
    expect(quadraticWeightedKappa(T2_A, T2_B)).toBeCloseTo(0, 9);
    expect(gwetAC1(T2_A, T2_B)).toBeGreaterThan(0.6);
  });
});

describe("gwetAC2", () => {
  it("matches the offline reference values (quadratic weights)", () => {
    expect(gwetAC2(T1_A, T1_B)).toBeCloseTo(AC2_REF.t1, 9);
    expect(gwetAC2(T2_A, T2_B)).toBeCloseTo(AC2_REF.t2, 9);
    expect(gwetAC2(T3_A, T3_B)).toBeCloseTo(AC2_REF.t3, 9);
    expect(gwetAC2(SHIFT_A, SHIFT_B)).toBeCloseTo(AC2_REF.shifted, 9);
  });

  it("matches the offline reference values (linear weights)", () => {
    expect(gwetAC2(T1_A, T1_B, { weights: "linear" })).toBeCloseTo(AC2_LINEAR_REF.t1, 9);
    expect(gwetAC2(T2_A, T2_B, { weights: "linear" })).toBeCloseTo(AC2_LINEAR_REF.t2, 9);
    expect(gwetAC2(SHIFT_A, SHIFT_B, { weights: "linear" })).toBeCloseTo(AC2_LINEAR_REF.shifted, 9);
  });

  it("returns 1 for perfect agreement", () => {
    expect(gwetAC2(T1_A, T1_A)).toBe(1);
  });
});

describe("fleissKappa (nominal)", () => {
  it("matches statsmodels on the classic 14x5x5 table", () => {
    expect(fleissKappa(countsToRatings(FLEISS_CLASSIC))).toBeCloseTo(
      0.21780692663459605,
      9
    );
  });

  it("matches statsmodels on the good-agreement table (gate-pass reference)", () => {
    expect(fleissKappa(countsToRatings(FLEISS_GOOD))).toBeCloseTo(
      0.8332592263228105,
      9
    );
  });

  it("matches statsmodels on the prevalence-skewed table", () => {
    expect(fleissKappa(countsToRatings(FLEISS_HIGH))).toBeCloseTo(
      -0.03401360544217675,
      9
    );
  });

  it("matches statsmodels on the mid table", () => {
    expect(fleissKappa(countsToRatings(FLEISS_MID))).toBeCloseTo(
      0.19186652763295098,
      9
    );
  });

  it("returns 1 for a unanimous panel", () => {
    const unanimous = [
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
    ];
    expect(fleissKappa(unanimous)).toBe(1);
  });
});

describe("fleissKappa (quadratic weights)", () => {
  it("reduces to Cohen QWK when 2 raters share identical margins", () => {
    // t3 margins are identical (same multiset) -> pooled chance = Cohen chance.
    expect(
      fleissKappa([T3_A, T3_B], { weights: "quadratic" })
    ).toBeCloseTo(MRQ_REF.t3_2rater, 9);
    expect(fleissKappa([T3_A, T3_B], { weights: "quadratic" })).toBeCloseTo(
      quadraticWeightedKappa(T3_A, T3_B),
      9
    );
  });

  it("matches the offline reference values on panel tables", () => {
    expect(
      fleissKappa(countsToRatings(FLEISS_GOOD), { weights: "quadratic" })
    ).toBeCloseTo(MRQ_REF.fleiss_good, 9);
    expect(
      fleissKappa(countsToRatings(FLEISS_MID), { weights: "quadratic" })
    ).toBeCloseTo(MRQ_REF.fleiss_mid, 9);
  });

  it("returns 1 for a unanimous panel", () => {
    const unanimous = [
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
    ];
    expect(fleissKappa(unanimous, { weights: "quadratic" })).toBe(1);
  });
});

describe("kappaBand (Landis & Koch 1977)", () => {
  it("maps reference values to the expected bands", () => {
    expect(kappaBand(-0.034)).toBe("poor");
    expect(kappaBand(0.1919)).toBe("slight");
    expect(kappaBand(0.2178)).toBe("fair");
    expect(kappaBand(0.8333)).toBe("almost perfect");
  });

  it("handles band boundaries", () => {
    expect(kappaBand(0)).toBe("slight");
    expect(kappaBand(0.2)).toBe("slight");
    expect(kappaBand(0.21)).toBe("fair");
    expect(kappaBand(0.41)).toBe("moderate");
    expect(kappaBand(0.61)).toBe("substantial");
    expect(kappaBand(0.81)).toBe("almost perfect");
    expect(kappaBand(1)).toBe("almost perfect");
  });
});

describe("input validation", () => {
  it("rejects mismatched lengths", () => {
    expect(() => quadraticWeightedKappa([1, 2], [1])).toThrow(/equal length/);
    expect(() => gwetAC1([1, 2], [1])).toThrow(/equal length/);
  });

  it("rejects fewer than 2 ratings", () => {
    expect(() => quadraticWeightedKappa([1], [1])).toThrow(/at least 2/);
  });

  it("rejects non-integer ratings", () => {
    expect(() => quadraticWeightedKappa([1, 2.5], [1, 2])).toThrow(/integer/);
  });

  it("rejects out-of-range ratings", () => {
    expect(() => quadraticWeightedKappa([1, 6], [1, 2])).toThrow(/out of range/);
    expect(() => quadraticWeightedKappa([1, 0], [1, 2])).toThrow(/out of range/);
    expect(() => gwetAC2([1, 7], [1, 2])).toThrow(/out of range/);
  });

  it("rejects invalid fleiss panels", () => {
    expect(() => fleissKappa([[1, 2]])).toThrow(/at least 2 raters/);
    expect(() => fleissKappa([[1], [1]])).toThrow(/at least 2 subjects/);
    expect(() => fleissKappa([[1, 2], [1]])).toThrow(/expected/);
    expect(() => fleissKappa([[1, 9], [1, 2]])).toThrow(/out of range/);
  });

  it("rejects non-finite kappa in kappaBand", () => {
    expect(() => kappaBand(Number.NaN)).toThrow(/finite/);
  });
});
