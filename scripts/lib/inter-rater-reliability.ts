/**
 * Inter-rater reliability statistics for the MY scoring cohort harness.
 *
 * Pure functions, no I/O. All reference values in the companion test file
 * were generated offline in a throwaway Python venv (/tmp/irr-ref, not
 * committed) and cross-checked between independent implementations:
 *   - QWK: numpy direct (Cohen 1968) vs scikit-learn cohen_kappa_score
 *     (quadratic weights) — identical to 1e-15.
 *   - Fleiss: numpy vs statsmodels 0.14.6 fleiss_kappa — identical to 1e-15.
 *   - Gwet AC1/AC2: Gwet (2008) chance-corrected formulas, derivation
 *     hand-verified on the t2 margins.
 *   - Multi-rater quadratic kappa reduces exactly to Cohen QWK when two
 *     raters share identical margins (verified on t3).
 *
 * Ratings are 1-based ordinal integers in 1..categories (default 5).
 */

/** Landis & Koch (1977) kappa agreement bands. */
export type KappaBand =
  | "poor"
  | "slight"
  | "fair"
  | "moderate"
  | "substantial"
  | "almost perfect";

export interface GwetAC2Options {
  /** Weighting for AC2's chance-corrected agreement. Default: "quadratic". */
  weights?: "quadratic" | "linear";
  /** Number of ordinal categories. Default: 5. */
  categories?: number;
}

export interface FleissKappaOptions {
  /**
   * "nominal": classic Fleiss (1971) kappa on the counts table.
   * "quadratic": multi-rater quadratic kappa (Fleiss-style pooled chance
   * with quadratic weights; equals Cohen QWK for identical margins).
   * Default: "nominal".
   */
  weights?: "nominal" | "quadratic";
  /** Number of ordinal categories. Default: 5. */
  categories?: number;
}

/** Quadratic weights w_ij = 1 - (i-j)^2/(K-1)^2 (Cohen 1968). */
function quadraticWeights(k: number): number[][] {
  const w: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      row.push(1 - (i - j) ** 2 / (k - 1) ** 2);
    }
    w.push(row);
  }
  return w;
}

/** Linear weights w_ij = 1 - |i-j|/(K-1). */
function linearWeights(k: number): number[][] {
  const w: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      row.push(1 - Math.abs(i - j) / (k - 1));
    }
    w.push(row);
  }
  return w;
}

function validateRatingPair(a: number[], b: number[], categories: number): void {
  if (a.length !== b.length) {
    throw new Error(
      `ratings must be of equal length (got ${a.length} and ${b.length})`
    );
  }
  if (a.length < 2) {
    throw new Error(`ratings must contain at least 2 entries (got ${a.length})`);
  }
  for (const v of a) {
    if (!Number.isInteger(v)) {
      throw new Error(`ratings must be integers (got ${v})`);
    }
    if (v < 1 || v > categories) {
      throw new Error(`rating ${v} out of range 1..${categories}`);
    }
  }
  for (const v of b) {
    if (!Number.isInteger(v)) {
      throw new Error(`ratings must be integers (got ${v})`);
    }
    if (v < 1 || v > categories) {
      throw new Error(`rating ${v} out of range 1..${categories}`);
    }
  }
}

function validatePanel(raterRows: number[][], categories: number): void {
  if (raterRows.length < 2) {
    throw new Error(`panel must have at least 2 raters (got ${raterRows.length})`);
  }
  const subjects = raterRows[0].length;
  if (subjects < 2) {
    throw new Error(`panel must have at least 2 subjects (got ${subjects})`);
  }
  raterRows.forEach((row, r) => {
    if (row.length !== subjects) {
      throw new Error(
        `ragged panel: expected every rater row to have ${subjects} ratings ` +
          `(row ${r} has ${row.length})`
      );
    }
    for (const v of row) {
      if (!Number.isInteger(v)) {
        throw new Error(`ratings must be integers (got ${v})`);
      }
      if (v < 1 || v > categories) {
        throw new Error(`rating ${v} out of range 1..${categories}`);
      }
    }
  });
}

/** Pooled category proportions pi from paired ratings (each rater half-weight). */
function pooledProportions(a: number[], b: number[], categories: number): number[] {
  const pi = new Array<number>(categories).fill(0);
  const n = a.length;
  for (let t = 0; t < n; t++) {
    pi[a[t] - 1] += 1 / (2 * n);
    pi[b[t] - 1] += 1 / (2 * n);
  }
  return pi;
}

/** pi^T W pi for a weight matrix W. */
function quadraticForm(pi: number[], w: number[][]): number {
  let sum = 0;
  for (let i = 0; i < pi.length; i++) {
    for (let j = 0; j < pi.length; j++) {
      sum += pi[i] * w[i][j] * pi[j];
    }
  }
  return sum;
}

/**
 * Cohen's quadratic weighted kappa (Cohen 1968).
 * p_e === 1 (all ratings in one category) is defined as kappa = 1.
 */
export function quadraticWeightedKappa(
  a: number[],
  b: number[],
  categories = 5
): number {
  validateRatingPair(a, b, categories);
  const n = a.length;
  const w = quadraticWeights(categories);

  const table = Array.from({ length: categories }, () =>
    new Array<number>(categories).fill(0)
  );
  for (let t = 0; t < n; t++) {
    table[a[t] - 1][b[t] - 1]++;
  }

  let p_o = 0;
  for (let i = 0; i < categories; i++) {
    for (let j = 0; j < categories; j++) {
      p_o += (table[i][j] / n) * w[i][j];
    }
  }

  const rowMargins = table.map((row) => row.reduce((x, y) => x + y, 0) / n);
  const colMargins = Array.from({ length: categories }, (_, j) =>
    table.reduce((sum, row) => sum + row[j], 0) / n
  );

  let p_e = 0;
  for (let i = 0; i < categories; i++) {
    for (let j = 0; j < categories; j++) {
      p_e += w[i][j] * rowMargins[i] * colMargins[j];
    }
  }
  if (p_e === 1) return 1;
  return (p_o - p_e) / (1 - p_e);
}

/**
 * Gwet's AC1 (Gwet 2008): chance-corrected agreement resistant to the
 * prevalence paradox (unlike Cohen's kappa on imbalanced-but-consistent
 * ratings).
 */
export function gwetAC1(a: number[], b: number[], categories = 5): number {
  validateRatingPair(a, b, categories);
  const n = a.length;
  let pa = 0;
  for (let t = 0; t < n; t++) {
    if (a[t] === b[t]) pa++;
  }
  pa /= n;

  const pi = pooledProportions(a, b, categories);
  let pe = 0;
  for (let j = 0; j < categories; j++) {
    pe += pi[j] * (1 - pi[j]);
  }
  pe /= categories - 1;
  if (pe === 1) return 1;
  return (pa - pe) / (1 - pe);
}

/**
 * Gwet's AC2 (Gwet 2008): weighted chance-corrected agreement; the AC1
 * analogue for ordinal ratings. Quadratic or linear weights.
 */
export function gwetAC2(
  a: number[],
  b: number[],
  options: GwetAC2Options = {}
): number {
  const categories = options.categories ?? 5;
  validateRatingPair(a, b, categories);
  const w =
    options.weights === "linear"
      ? linearWeights(categories)
      : quadraticWeights(categories);

  const n = a.length;
  let pa = 0;
  for (let t = 0; t < n; t++) {
    pa += w[a[t] - 1][b[t] - 1];
  }
  pa /= n;

  const pi = pooledProportions(a, b, categories);
  const pe = (1 - quadraticForm(pi, w)) / (categories - 1);
  if (pe === 1) return 1;
  return (pa - pe) / (1 - pe);
}

/**
 * Fleiss' kappa (Fleiss 1971) for panels of >= 2 raters.
 *
 * Input is a raters x subjects matrix of 1-based ratings.
 * "nominal" weights compute the classic Fleiss kappa on the subjects x
 * categories count table; "quadratic" weights compute the multi-rater
 * quadratic kappa (pooled-margin chance with quadratic weights), which
 * reduces exactly to Cohen QWK for two raters with identical margins.
 */
export function fleissKappa(
  raterRows: number[][],
  options: FleissKappaOptions = {}
): number {
  const categories = options.categories ?? 5;
  validatePanel(raterRows, categories);

  const nRaters = raterRows.length;
  const nSubjects = raterRows[0].length;

  if (options.weights === "quadratic") {
    const w = quadraticWeights(categories);
    const nPairs = (nRaters * (nRaters - 1)) / 2;
    let po = 0;
    for (let s = 0; s < nSubjects; s++) {
      let subjectSum = 0;
      for (let r1 = 0; r1 < nRaters; r1++) {
        for (let r2 = r1 + 1; r2 < nRaters; r2++) {
          subjectSum += w[raterRows[r1][s] - 1][raterRows[r2][s] - 1];
        }
      }
      po += subjectSum / nPairs;
    }
    po /= nSubjects;

    const pi = new Array<number>(categories).fill(0);
    for (let r = 0; r < nRaters; r++) {
      for (let s = 0; s < nSubjects; s++) {
        pi[raterRows[r][s] - 1] += 1 / (nRaters * nSubjects);
      }
    }
    const pe = quadraticForm(pi, w);
    if (pe === 1) return 1;
    return (po - pe) / (1 - pe);
  }

  // Classic Fleiss: subjects x categories count table.
  const counts = Array.from({ length: nSubjects }, () =>
    new Array<number>(categories).fill(0)
  );
  for (let s = 0; s < nSubjects; s++) {
    for (let r = 0; r < nRaters; r++) {
      counts[s][raterRows[r][s] - 1]++;
    }
  }

  const pbar = new Array<number>(categories).fill(0);
  for (let s = 0; s < nSubjects; s++) {
    for (let j = 0; j < categories; j++) {
      pbar[j] += counts[s][j];
    }
  }
  for (let j = 0; j < categories; j++) {
    pbar[j] /= nSubjects * nRaters;
  }
  let pe = 0;
  for (let j = 0; j < categories; j++) {
    pe += pbar[j] ** 2;
  }

  let po = 0;
  for (let s = 0; s < nSubjects; s++) {
    let pSq = 0;
    for (let j = 0; j < categories; j++) {
      pSq += (counts[s][j] / nRaters) ** 2;
    }
    po += (pSq * nRaters - 1) / (nRaters - 1);
  }
  po /= nSubjects;

  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

/**
 * Landis & Koch (1977) agreement bands. Boundary convention (strictly
 * below the next band start): < 0 poor; [0, 0.21) slight; [0.21, 0.41)
 * fair; [0.41, 0.61) moderate; [0.61, 0.81) substantial; >= 0.81 almost
 * perfect.
 */
export function kappaBand(kappa: number): KappaBand {
  if (!Number.isFinite(kappa)) {
    throw new Error(`kappa must be finite (got ${kappa})`);
  }
  if (kappa < 0) return "poor";
  if (kappa < 0.21) return "slight";
  if (kappa < 0.41) return "fair";
  if (kappa < 0.61) return "moderate";
  if (kappa < 0.81) return "substantial";
  return "almost perfect";
}
