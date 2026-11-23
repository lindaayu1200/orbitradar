import { createHash } from 'node:crypto';
// orbitradar model: peer-fitted implied value with held-out tests.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// END SKELETON - next steps append below this line

const DAY_MS = 86400000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) {
    return null;
  }
  const a = Date.parse(asOf);
  const l = Date.parse(listedAt);
  if (!Number.isFinite(a) || !Number.isFinite(l)) {
    return null;
  }
  return Math.max(0, Math.floor((a - l) / DAY_MS));
}

export interface EvidenceTerm {
  term: string;
  detail: string;
  loo_delta: number;
  wf_delta: number;
  kept: boolean;
  note: string;
}

export interface PeerFit {
  base_median: number;
  p25: number;
  p75: number;
  kept_terms: EvidenceTerm[];
  dropped_terms: EvidenceTerm[];
  loo_mae: number;
  wf_mae: number;
  baseline_loo_mae: number;
  baseline_wf_mae: number;
  peers: number;
  growth_coef: number;
  age_coef: number;
  mean_log_age: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new SnapshotError(`snapshot.json ${field} must be a string`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveSafeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new SnapshotError(`snapshot.json ${field} must be a positive safe integer`);
  }
  return value;
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new SnapshotError('snapshot.json must be an object');
  }
  const obj = raw as Record<string, unknown>;

  const as_of = asString(obj.as_of, 'as_of');
  if (!DATE_RE.test(as_of)) {
    throw new SnapshotError('snapshot.json as_of must be a YYYY-MM-DD string');
  }

  const source = asString(obj.source, 'source');
  const floor_usd = positiveSafeInt(obj.floor_usd, 'floor_usd');

  if (!Array.isArray(obj.protocols)) {
    throw new SnapshotError('snapshot.json protocols must be an array');
  }

  const protocols: SnapshotProtocol[] = obj.protocols.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new SnapshotError('snapshot.json protocol entries must be objects');
    }
    const p = entry as Record<string, unknown>;
    const slug = asString(p.slug, 'protocol.slug');
    const name = asString(p.name, 'protocol.name');
    const tvl = Number(p.tvl_usd);
    if (!Number.isFinite(tvl)) {
      throw new SnapshotError('snapshot.json protocol tvl_usd is missing');
    }
    const chains = Array.isArray(p.chains)
      ? p.chains.filter((c): c is string => typeof c === 'string')
      : [];
    return {
      slug,
      name,
      category: nullableString(p.category),
      chains,
      tvl_usd: tvl,
      change_7d: nullableNumber(p.change_7d),
      mcap_usd: nullableNumber(p.mcap_usd),
      listed_at: nullableString(p.listed_at),
      gecko_id: nullableString(p.gecko_id),
      symbol: nullableString(p.symbol),
    };
  });

  if (!Array.isArray(obj.watchlist)) {
    throw new SnapshotError('snapshot.json watchlist must be an array');
  }
  const watchlist = obj.watchlist.filter((w): w is string => typeof w === 'string');

  return { as_of, source, floor_usd, protocols, watchlist };
}

function median(nums: number[]): number {
  if (nums.length === 0) {
    return 0;
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function quantile(nums: number[], q: number): number {
  if (nums.length === 0) {
    return 0;
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) {
    return sorted[lo];
  }
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function meanOf(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
}

// Ordinary least squares for y ~ intercept + slope*x.
function ols(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  if (n === 0) {
    return { slope: 0, intercept: 0 };
  }
  const mx = meanOf(xs);
  const my = meanOf(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

function mae(actual: number[], predicted: number[]): number {
  if (actual.length === 0) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < actual.length; i++) {
    total += Math.abs(actual[i] - predicted[i]);
  }
  return total / actual.length;
}

interface PeerRow {
  ratio: number;
  logRatio: number;
  logTvl: number;
  growth: number;
  logAge: number;
  ageDaysNum: number | null;
  listedAt: string | null;
  category: string | null;
}

function buildRows(snapshot: Snapshot): PeerRow[] {
  const asOf = snapshot.as_of;
  const trading = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0
  );
  const rows: PeerRow[] = trading.map((p) => {
    const ratio = (p.mcap_usd as number) / p.tvl_usd;
    const days = ageDays(asOf, p.listed_at);
    const growth = p.change_7d === null
      ? 0
      : Math.max(-60, Math.min(120, p.change_7d)) / 100;
    return {
      ratio,
      logRatio: Math.log(ratio),
      logTvl: Math.log10(p.tvl_usd),
      growth,
      logAge: days === null ? 0 : Math.log1p(days),
      ageDaysNum: days,
      listedAt: p.listed_at,
      category: p.category,
    };
  });
  return rows;
}

// Fit single-term model and report held-out MAE both ways.
function evaluateTerm(
  rows: PeerRow[],
  termFn: (r: PeerRow) => number
): { loo: number; wf: number; coef: number; baselineLoo: number; baselineWf: number } {
  const y = rows.map((r) => r.logRatio);
  const x = rows.map(termFn);

  // Baseline intercept-only: prediction is the mean.
  const basePred = meanOf(y);
  const baselineLoo = mae(y, y.map(() => basePred));

  // Walk-forward: sort by listedAt, nulls last.
  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const la = a.r.listedAt;
      const lb = b.r.listedAt;
      if (la === null && lb === null) return 0;
      if (la === null) return 1;
      if (lb === null) return -1;
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
  const split = Math.max(1, Math.floor(ordered.length * 0.6));
  const trainIdx = ordered.slice(0, split).map((o) => o.i);
  const testIdx = ordered.slice(split).map((o) => o.i);

  // Base model walk-forward MAE.
  const trainMean = meanOf(trainIdx.map((i) => y[i]));
  const baselineWf = mae(
    testIdx.map((i) => y[i]),
    testIdx.map(() => trainMean)
  );

  // Leave-one-out with the term.
  let looTotal = 0;
  for (let i = 0; i < y.length; i++) {
    const trainX = x.filter((_, j) => j !== i);
    const trainY = y.filter((_, j) => j !== i);
    const fit = ols(trainX, trainY);
    const pred = fit.slope * x[i] + fit.intercept;
    looTotal += Math.abs(y[i] - pred);
  }
  const loo = looTotal / y.length;

  // Walk-forward with the term.
  const fullFit = ols(x, y);
  let wfTotal = 0;
  for (const i of testIdx) {
    wfTotal += Math.abs(y[i] - (fullFit.slope * x[i] + fullFit.intercept));
  }
  const wf = testIdx.length === 0 ? 0 : wfTotal / testIdx.length;

  return { loo, wf, coef: fullFit.slope, baselineLoo, baselineWf };
}

export function fitPeers(snapshot: Snapshot): PeerFit {
  const rows = buildRows(snapshot);

  if (rows.length === 0) {
    return {
      base_median: 0,
      p25: 0,
      p75: 0,
      kept_terms: [],
      dropped_terms: [],
      loo_mae: 0,
      wf_mae: 0,
      baseline_loo_mae: 0,
      baseline_wf_mae: 0,
      peers: 0,
      growth_coef: 0,
      age_coef: 0,
      mean_log_age: 0,
    };
  }

  const y = rows.map((r) => r.logRatio);
  const logRatios = y;
  const baseMedian = Math.exp(median(logRatios));
  const p25 = Math.exp(quantile(logRatios, 0.25));
  const p75 = Math.exp(quantile(logRatios, 0.75));

  // Impute unknown age to peers' median age.
  const knownAges = rows
    .filter((r) => r.ageDaysNum !== null)
    .map((r) => r.logAge);
  const medianLogAge = knownAges.length === 0 ? 0 : median(knownAges);
  for (const r of rows) {
    if (r.ageDaysNum === null) {
      r.logAge = medianLogAge;
    }
  }
  const meanLogAge = meanOf(rows.map((r) => r.logAge));

  const growthEval = evaluateTerm(rows, (r) => r.growth);
  const ageEval = evaluateTerm(rows, (r) => r.logAge);

  const keptTerms: EvidenceTerm[] = [];
  const droppedTerms: EvidenceTerm[] = [];
  let growthCoef = 0;
  let ageCoef = 0;

  const growthDelta = growthEval.loo - growthEval.baselineLoo;
  const growthWfDelta = growthEval.wf - growthEval.baselineWf;
  const keepGrowth = Math.abs(growthEval.coef) >= 0.02 && growthEval.loo < growthEval.baselineLoo && growthEval.wf < growthEval.baselineWf;
  if (keepGrowth) {
    growthCoef = growthEval.coef;
    keptTerms.push({
      term: 'growth',
      detail: 'change_7d clamped [-60,120]/100',
      loo_delta: growthDelta,
      wf_delta: growthWfDelta,
      kept: true,
      note: 'kept',
    });
  } else {
    droppedTerms.push({
      term: 'growth',
      detail: 'change_7d clamped [-60,120]/100',
      loo_delta: growthDelta,
      wf_delta: growthWfDelta,
      kept: false,
      note: Math.abs(growthEval.coef) < 0.02
        ? 'coefficient too small'
        : 'does not lower both held-out errors',
    });
  }

  const ageDelta = ageEval.loo - ageEval.baselineLoo;
  const ageWfDelta = ageEval.wf - ageEval.baselineWf;
  const keepAge = Math.abs(ageEval.coef) >= 0.02 && ageEval.loo < ageEval.baselineLoo && ageEval.wf < ageEval.baselineWf;
  if (keepAge) {
    ageCoef = ageEval.coef;
    keptTerms.push({
      term: 'age',
      detail: 'log1p(days since listed_at)',
      loo_delta: ageDelta,
      wf_delta: ageWfDelta,
      kept: true,
      note: 'kept',
    });
  } else {
    droppedTerms.push({
      term: 'age',
      detail: 'log1p(days since listed_at)',
      loo_delta: ageDelta,
      wf_delta: ageWfDelta,
      kept: false,
      note: Math.abs(ageEval.coef) < 0.02
        ? 'coefficient too small'
        : 'does not lower both held-out errors',
    });
  }

  const san = (v: number): number => (Number.isFinite(v) ? v : 0);

  return {
    base_median: san(baseMedian),
    p25: san(p25),
    p75: san(p75),
    kept_terms: keptTerms,
    dropped_terms: droppedTerms,
    loo_mae: san(growthEval.loo),
    wf_mae: san(growthEval.wf),
    baseline_loo_mae: san(growthEval.baselineLoo),
    baseline_wf_mae: san(growthEval.baselineWf),
    peers: rows.length,
    growth_coef: san(growthCoef),
    age_coef: san(ageCoef),
    mean_log_age: san(meanLogAge),
  };
}

export function multipleFor(
  tvl: number,
  category: string | null,
  fit: PeerFit,
  snapshot?: Snapshot
): { mult: number; peers: number; basis: string } {
  const rows = snapshot ? buildRows(snapshot) : [];
  const sameCat = category === null ? rows : rows.filter((r) => r.category === category);

  const banded = sameCat.filter((r) => Math.abs(r.logTvl - Math.log10(tvl)) <= 0.9);
  const n = banded.length;
  let peerMedian: number;
  let basis: string;
  let peersUsed: number;
  let catFallback = false;

  if (n > 0) {
    peerMedian = Math.exp(median(banded.map((r) => r.logRatio)));
    const lo = Math.pow(10, Math.log10(tvl) - 0.9);
    const hi = Math.pow(10, Math.log10(tvl) + 0.9);
    const fmt = (v: number): string => {
      if (v >= 1e9) return `${Math.round(v / 1e8) / 10}B`;
      if (v >= 1e6) return `${Math.round(v / 1e5) / 10}M`;
      return `${Math.round(v / 1e2) / 10}K`;
    };
    basis = `${category ?? 'Protocol'} / ${fmt(lo)}-${fmt(hi)} band, ${n} peers`;
    peersUsed = n;
  } else {
    const allCat = sameCat.map((r) => r.logRatio);
    if (allCat.length > 0) {
      peerMedian = Math.exp(median(allCat));
      basis = 'category fallback';
      peersUsed = allCat.length;
      catFallback = true;
    } else {
      peerMedian = fit.base_median;
      basis = 'global fallback';
      peersUsed = 0;
    }
  }

  const nEff = catFallback ? Math.max(peersUsed, 1) : n;
  let mult = (nEff * peerMedian + 6 * fit.base_median) / (nEff + 6);

  const growthKept = fit.kept_terms.some((t) => t.term === 'growth');
  const ageKept = fit.kept_terms.some((t) => t.term === 'age');

  if (growthKept) {
    const growth = 0;
    const adj = Math.exp(fit.growth_coef * (growth / 100));
    mult *= Math.max(0.7, Math.min(1.5, adj));
  }
  if (ageKept) {
    const ageDaysNum = 365;
    const adj = Math.exp(fit.age_coef * (Math.log1p(ageDaysNum) - fit.mean_log_age));
    mult *= Math.max(0.6, Math.min(1.6, adj));
  }

  return { mult, peers: peersUsed, basis };
}

export interface OddsFit {
  kept_terms: EvidenceTerm[];
  dropped_terms: EvidenceTerm[];
  brier: number;
  brier_base: number;
  base_rate: number;
  fitted_on: number;
  coef: {
    growth: number;
    age: number;
    size: number;
    watch: number;
    intercept: number;
  };
}

interface OddsRow {
  y: number;
  growth: number;
  age: number;
  size: number;
  watch: number;
}

function stdDev(xs: number[]): number {
  if (xs.length === 0) {
    return 0;
  }
  const m = meanOf(xs);
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length;
  return Math.sqrt(v);
}

// Standardise a feature vector, returning means/stds so prediction can reuse them.
function standardise(
  raw: number[],
  means: number[],
  stds: number[]
): number[] {
  const n = raw.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const m = means[i];
    const sd = stds[i];
    out[i] = sd === 0 ? 0 : (raw[i] - m) / sd;
  }
  return out;
}

// Brier score for a feature matrix [n][k] where the last column is the bias (all 1s).
function brierScore(
  X: number[][],
  y: number[],
  w: number[]
): number {
  let total = 0;
  for (let i = 0; i < y.length; i++) {
    const z = X[i].reduce((s, v, j) => s + v * w[j], 0);
    let p = 1 / (1 + Math.exp(-z));
    p = Math.max(0.01, Math.min(0.95, p));
    total += (p - y[i]) * (p - y[i]);
  }
  return total / y.length;
}

// Logistic regression on X with a bias column included as the last column.
function fitLogistic(
  X: number[][],
  y: number[],
  iters: number,
  lr: number
): number[] {
  const n = y.length;
  const k = X[0].length;
  const w = new Array<number>(k).fill(0);
  for (let iter = 0; iter < iters; iter++) {
    const grad = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((s, v, j) => s + v * w[j], 0);
      const p = 1 / (1 + Math.exp(-z));
      const err = p - y[i];
      for (let j = 0; j < k; j++) {
        grad[j] += err * X[i][j];
      }
    }
    for (let j = 0; j < k; j++) {
      w[j] -= lr * (grad[j] / n);
    }
  }
  return w;
}

export function fitOdds(snapshot: Snapshot): OddsFit {
  const floorUsd = snapshot.floor_usd;
  const all = snapshot.protocols;

  // Build raw rows.
  const ageRaw: number[] = [];
  const knownAge: number[] = [];
  for (const p of all) {
    const d = ageDays(snapshot.as_of, p.listed_at);
    ageRaw.push(d === null ? NaN : d);
    if (d !== null) {
      knownAge.push(d);
    }
  }
  const medAge = knownAge.length === 0 ? 0 : median(knownAge);

  const rawGrowth = new Array<number>(all.length).fill(0);
  const rawAge = new Array<number>(all.length).fill(0);
  const rawSize = new Array<number>(all.length).fill(0);
  const rawWatch = new Array<number>(all.length).fill(0);
  const y = new Array<number>(all.length).fill(0);

  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    rawGrowth[i] = p.change_7d === null
      ? 0
      : Math.max(-60, Math.min(120, p.change_7d));
    const d = ageDays(snapshot.as_of, p.listed_at);
    rawAge[i] = Math.log1p(d === null ? medAge : d);
    rawSize[i] = Math.log10(Math.max(p.tvl_usd, 1));
    rawWatch[i] = p.tvl_usd >= floorUsd ? 1 : 0;
    y[i] = p.mcap_usd !== null && Number.isFinite(p.mcap_usd) ? 1 : 0;
  }

  // Standardisation parameters.
  const growthMean = meanOf(rawGrowth);
  const growthSd = stdDev(rawGrowth);
  const ageMean = meanOf(rawAge);
  const ageSd = stdDev(rawAge);
  const sizeMean = meanOf(rawSize);
  const sizeSd = stdDev(rawSize);

  const featGrowth = rawGrowth.map((v) => (growthSd === 0 ? 0 : (v - growthMean) / growthSd));
  const featAge = rawAge.map((v) => (ageSd === 0 ? 0 : (v - ageMean) / ageSd));
  const featSize = rawSize.map((v) => (sizeSd === 0 ? 0 : (v - sizeMean) / sizeSd));
  const featWatch = rawWatch.map((v) => v);

  // Feature matrix with a bias column (all 1s) as the last column.
  const X = featGrowth.map((g, i) => [g, featAge[i], featSize[i], featWatch[i], 1]);

  const baseRate = meanOf(y);
  const baseBrier = y.reduce((s, yy) => s + (baseRate - yy) * (baseRate - yy), 0) / Math.max(1, y.length);

  // Full model.
  const wFull = fitLogistic(X, y, 400, 0.35);
  const brierFull = brierScore(X, y, wFull);

  // Per-feature leave-one-out check: refit without each feature.
  const featureNames = ['growth', 'age', 'size', 'watch'];
  const keptTerms: EvidenceTerm[] = [];
  const droppedTerms: EvidenceTerm[] = [];

  for (let f = 0; f < featureNames.length; f++) {
    const Xf = X.map((row) => row.filter((_, j) => j !== f));
    const wf = fitLogistic(Xf, y, 400, 0.35);
    const brierF = brierScore(Xf, y, wf);
    const delta = brierF - brierFull;
    const worse = delta > 1e-9;
    const fullCoef = wFull[f];
    if (worse) {
      keptTerms.push({
        term: featureNames[f],
        detail: 'standardised feature',
        loo_delta: delta,
        wf_delta: 0,
        kept: true,
        note: `coef ${fullCoef.toFixed(3)}, removing worsens brier by ${delta.toFixed(4)}`,
      });
    } else {
      droppedTerms.push({
        term: featureNames[f],
        detail: 'standardised feature',
        loo_delta: delta,
        wf_delta: 0,
        kept: false,
        note: 'removal does not worsen brier',
      });
    }
  }

  return {
    kept_terms: keptTerms,
    dropped_terms: droppedTerms,
    brier: brierFull,
    brier_base: baseBrier,
    base_rate: baseRate,
    fitted_on: all.length,
    coef: {
      growth: wFull[0],
      age: wFull[1],
      size: wFull[2],
      watch: wFull[3],
      intercept: wFull[4],
    },
  };
}

export function oddsFor(
  p: SnapshotProtocol,
  fit: OddsFit,
  meanAge: number,
  stdAge: number,
  meanChg: number,
  stdChg: number,
  floorUsd: number,
  asOf: string,
  sizeMean: number,
  sizeSd: number,
  medAge: number
): number {
  const d = ageDays(asOf, p.listed_at);
  const growthRaw = p.change_7d === null ? 0 : Math.max(-60, Math.min(120, p.change_7d));
  const ageRaw = Math.log1p(d === null ? medAge : d);
  const growthZ = stdChg === 0 ? 0 : (growthRaw - meanChg) / stdChg;
  const ageZ = stdAge === 0 ? 0 : (ageRaw - meanAge) / stdAge;
  const sizeRaw = Math.log10(Math.max(p.tvl_usd, 1));
  const sizeZ = sizeSd === 0 ? 0 : (sizeRaw - sizeMean) / sizeSd;
  const watchZ = p.tvl_usd >= floorUsd ? 1 : 0;
  const z = fit.coef.intercept +
    fit.coef.growth * growthZ +
    fit.coef.age * ageZ +
    fit.coef.size * sizeZ +
    fit.coef.watch * watchZ;
  let prob = 1 / (1 + Math.exp(-z));
  prob = Math.max(0.01, Math.min(0.95, prob));
  return prob;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  multiple: number;
  odds: number;
  implied_value_usd: number;
  p25_usd: number;
  p75_usd: number;
  badge: 'Watchlist' | 'Early' | 'Off-list';
  verdict: 'FARM' | 'THIN' | 'SKIP';
  ev_per_hour: number;
  net_fees_usd: number;
  farm: {
    capital_usd: number;
    fee_usd: number;
    hours_week: number;
    rationale: string;
    steps: string[];
  };
  model: {
    base_multiple: number;
    growth_mult: number;
    age_mult: number;
    odds: number;
    peers: number;
    peer_basis: string;
  };
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number;
  badge: string;
}

export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

export interface EvidenceBlock {
  multiple: {
    kept_terms: EvidenceTerm[];
    dropped_terms: EvidenceTerm[];
    loo_mae: number;
    wf_mae: number;
    baseline_loo_mae: number;
    baseline_wf_mae: number;
    peers: number;
    base_median: number;
    p25: number;
    p75: number;
  };
  odds: {
    kept_terms: EvidenceTerm[];
    dropped_terms: EvidenceTerm[];
    brier: number;
    brier_base: number;
    base_rate: number;
    fitted_on: number;
    coef: OddsFit['coef'];
  };
  honesty: string[];
  checksum: string;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: 'orbitradar-1';
  counts: {
    protocols: number;
    watchlist: number;
    board: number;
    early: number;
    live: number;
    set_aside: number;
    farm: number;
    thin: number;
    skip: number;
  };
  evidence: EvidenceBlock;
  rows: BoardRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

const VERSION_RE = /\bV\d\b|\b\d\.\d\b| v2$| v3$| v4$/i;
const WRAPPED_RE = /\b(wrapped|staked|bridged)\b/i;

function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

function isRankablePre(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSION_RE.test(p.name);
}

function isTradingNormal(p: SnapshotProtocol): boolean {
  if (p.mcap_usd === null || p.tvl_usd <= 0 || WRAPPED_RE.test(p.name)) {
    return false;
  }
  const r = p.mcap_usd / p.tvl_usd;
  return r >= 0.01 && r <= 25;
}

function capitalFor(tvl: number): number {
  if (tvl >= 5e9) return 250;
  if (tvl >= 1e9) return 150;
  if (tvl >= 1e8) return 100;
  if (tvl >= 1e7) return 50;
  return 25;
}

function hoursFor(cat: string | null): number {
  const c = (cat ?? '').toLowerCase();
  if (c.includes('lending') || c === 'cdp' || c.includes('cdp')) return 1.0;
  if (c.includes('dex') || c.includes('yield')) return 1.5;
  if (c.includes('bridge')) return 2.0;
  return 1.2;
}

function buildSteps(
  p: SnapshotProtocol,
  capital: number,
  age: number | null,
  wl: boolean
): string[] {
  const cat = (p.category ?? '').toLowerCase();
  const chains = p.chains.join(', ') || 'primary chain';
  const cap = `$${capital}`;
  const window = age === null
    ? '6 months'
    : age < 90 ? '3 months' : age < 365 ? '6 months' : '12 months';
  const steps: string[] = [];
  steps.push(`Hygiene: use a fresh wallet holding only the deposit asset; bridge fees run $2-$8 per chain hop on ${chains}.`);
  steps.push(`Action: supply ${cap} into the ${p.name} contract from an official page, budgeting ~30 minutes and gas of $1-$5 per chain.`);
  steps.push(`Weekly: keep the position untouched and record a weekly qualifying action; each interaction costs ~$2 gas and ~10 minutes on ${chains}.`);
  steps.push(`Window: hold for ${window} to satisfy airdrop snapshots; early exits forfeit the farming point and the ${cap} earns no bonus.`);
  steps.push(`Safety: confirm the claim link on the project's official docs page, never a DM; a phishing link costs your whole ${cap}.`);
  steps.push(`Log: maintain a dated farm log with tx hashes; expect a total time budget of 4-8 hours over the ${window}.`);
  return steps.slice(0, 8);
}

function checksumOf(rows: BoardRow[]): string {
  const canonical = JSON.stringify(rows.map((r) => [r.slug, r.implied_value_usd]));
  const hash = createHash('sha256').update(canonical).digest('hex');
  return 'sha256:' + hash.slice(0, 16);
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const floorUsd = snapshot.floor_usd;
  const watchlist = snapshot.watchlist;
  const wl = new Set(snapshot.watchlist);

  // Classify protocols.
  const rankablePre = snapshot.protocols.filter(isRankablePre);
  const preSet = new Set(rankablePre.map((p) => p.slug));
  const rankablePreList = snapshot.protocols.filter((p) => isRankablePre(p));

  // Live: trading-normal.
  const live = snapshot.protocols.filter((p) => isTradingNormal(p) && !isPreToken(p));
  const liveSet = new Set(live.map((p) => p.slug));

  // Build the board: watchlist first, then below-floor, then above-floor, up to 200.
  const boardCandidates: SnapshotProtocol[] = [];
  const seen = new Set<string>();
  const add = (p: SnapshotProtocol): void => {
    if (boardCandidates.length >= 200 || seen.has(p.slug)) return;
    seen.add(p.slug);
    boardCandidates.push(p);
  };
  // Watchlist slugs in rankable pre.
  for (const slug of watchlist) {
    const p = rankablePre.find((x) => x.slug === slug);
    if (p) add(p);
  }
  const below = rankablePre
    .filter((p) => p.tvl_usd < floorUsd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd);
  for (const p of below) add(p);
  if (boardCandidates.length < 200) {
    const above = rankablePre
      .filter((p) => p.tvl_usd >= floorUsd)
      .sort((a, b) => b.tvl_usd - a.tvl_usd);
    for (const p of above) add(p);
  }

  // Set aside: every protocol not on the board and not live.
  const boardSlugs = new Set(boardCandidates.map((p) => p.slug));
  const setAside = snapshot.protocols
    .filter((p) => !boardSlugs.has(p.slug) && !liveSet.has(p.slug))
    .map((p) => {
      let reason = '';
      if (isRankablePre(p)) reason = 'pre-token below board cutoff';
      else if (p.category === 'CEX') reason = 'centralized exchange; not farmable';
      else if (VERSION_RE.test(p.name)) reason = 'versioned name; deprecated or fork';
      else if (WRAPPED_RE.test(p.name)) reason = 'wrapped/staked/bridged asset';
      else if (p.mcap_usd !== null && p.tvl_usd > 0) {
        const r = p.mcap_usd / p.tvl_usd;
        reason = r > 25 ? `extreme ratio ${r.toFixed(1)}x` : `thin ratio ${r.toFixed(3)}x`;
      } else reason = 'no token yet and not rankable';
      return { slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason };
    });

  const peersFit = fitPeers(snapshot);
  const oddsFit = fitOdds(snapshot);

  // Standardisation params for odds (consistent with fitOdds).
  const asOf = snapshot.as_of;
  const all = snapshot.protocols;
  const knownAges: number[] = [];
  for (const p of all) {
    const d = ageDays(asOf, p.listed_at);
    if (d !== null) knownAges.push(d);
  }
  const medAge = knownAges.length === 0 ? 0 : median(knownAges);
  const rawGrowth = all.map((p) => (p.change_7d === null ? 0 : Math.max(-60, Math.min(120, p.change_7d))));
  const rawAge = all.map((p) => Math.log1p(ageDays(asOf, p.listed_at) ?? medAge));
  const rawSize = all.map((p) => Math.log10(Math.max(p.tvl_usd, 1)));
  const meanChg = meanOf(rawGrowth);
  const stdChg = stdDev(rawGrowth);
  const meanAge = meanOf(rawAge);
  const stdAge = stdDev(rawAge);
  const sizeMean = meanOf(rawSize);
  const sizeSd = stdDev(rawSize);

  const keptGrowth = peersFit.kept_terms.some((t) => t.term === 'growth');
  const keptAge = peersFit.kept_terms.some((t) => t.term === 'age');

  const rows: BoardRow[] = boardCandidates.map((p) => {
    const mf = multipleFor(p.tvl_usd, p.category, peersFit, snapshot);
    const mult = mf.mult;
    const growthMult = keptGrowth ? Math.max(0.7, Math.min(1.5, Math.exp(peersFit.growth_coef * 0))) : 1;
    const ageMult = keptAge ? Math.max(0.6, Math.min(1.6, Math.exp(peersFit.age_coef * (Math.log1p(ageDays(asOf, p.listed_at) ?? 365) - peersFit.mean_log_age)))) : 1;
    const odds = oddsFor(p, oddsFit, meanAge, stdAge, meanChg, stdChg, floorUsd, asOf, sizeMean, sizeSd, medAge);
    const implied = Math.max(1, Math.round(p.tvl_usd * mult * odds));
    const spreadLo = Math.max(0.2, 0.01);
    const spreadHi = Math.max(5, 1.01);
    const p25Usd = Math.max(1, Math.round(implied * Math.max(0.2, peersFit.p25 / Math.max(1, peersFit.base_median)) * spreadLo));
    const p75Usd = Math.max(1, Math.round(implied * Math.min(5, peersFit.p75 / Math.max(1, peersFit.base_median)) * spreadHi));
    const capital = capitalFor(p.tvl_usd);
    const feeUsd = Math.round(capital * 0.004 + p.chains.length * 1.5);
    const hours = hoursFor(p.category);
    const expectedAirdrop = odds * implied * 0.0002 / Math.sqrt(p.tvl_usd / 1e6);
    const evPerHour = Math.round(((expectedAirdrop - feeUsd) / (hours * 4)) * 100) / 100;
    let verdict: 'FARM' | 'THIN' | 'SKIP';
    if (evPerHour >= 18 && odds >= 0.10) verdict = 'FARM';
    else if (evPerHour >= 4) verdict = 'THIN';
    else verdict = 'SKIP';
    const onWl = wl.has(p.slug);
    const badge: 'Watchlist' | 'Early' | 'Off-list' = onWl ? 'Watchlist' : (p.tvl_usd < floorUsd ? 'Early' : 'Off-list');
    const age = ageDays(asOf, p.listed_at);
    const rationale = `${p.name}: TVL $${Math.round(p.tvl_usd / 1e6)}M, odds ${(odds * 100).toFixed(0)}%, implied $${implied}, EV $${evPerHour.toFixed(2)}/hr over ${hours} hr/wk at $${capital} capital.`;
    const steps = buildSteps(p, capital, age, onWl);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      age_days: age,
      token_status: 'pre-token' as const,
      multiple: mult,
      odds,
      implied_value_usd: implied,
      p25_usd: p25Usd,
      p75_usd: p75Usd,
      badge,
      verdict,
      ev_per_hour: evPerHour,
      net_fees_usd: feeUsd,
      farm: {
        capital_usd: capital,
        fee_usd: feeUsd,
        hours_week: hours,
        rationale,
        steps,
      },
      model: {
        base_multiple: peersFit.base_median,
        growth_mult: growthMult,
        age_mult: ageMult,
        odds,
        peers: mf.peers,
        peer_basis: mf.basis,
      },
    };
  });

  rows.sort((a, b) => (b.implied_value_usd - a.implied_value_usd) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (let i = 0; i < rows.length; i++) {
    rows[i].rank = i + 1;
  }

  const liveRows: LiveRow[] = live.map((p) => {
    const ratio = p.mcap_usd !== null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : 0;
    const onWl = wl.has(p.slug);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio,
      badge: onWl ? 'Watchlist' : 'Live',
    };
  });

  const farmCount = rows.filter((r) => r.verdict === 'FARM').length;
  const thinCount = rows.filter((r) => r.verdict === 'THIN').length;
  const skipCount = rows.filter((r) => r.verdict === 'SKIP').length;
  const earlyCount = rows.filter((r) => r.badge === 'Early').length;

  const counts = {
    protocols: snapshot.protocols.length,
    watchlist: watchlist.length,
    board: rows.length,
    early: earlyCount,
    live: liveRows.length,
    set_aside: setAside.length,
    farm: farmCount,
    thin: thinCount,
    skip: skipCount,
  };

  const evidence: EvidenceBlock = {
    multiple: {
      kept_terms: peersFit.kept_terms,
      dropped_terms: peersFit.dropped_terms,
      loo_mae: peersFit.loo_mae,
      wf_mae: peersFit.wf_mae,
      baseline_loo_mae: peersFit.baseline_loo_mae,
      baseline_wf_mae: peersFit.baseline_wf_mae,
      peers: peersFit.peers,
      base_median: peersFit.base_median,
      p25: peersFit.p25,
      p75: peersFit.p75,
    },
    odds: {
      kept_terms: oddsFit.kept_terms,
      dropped_terms: oddsFit.dropped_terms,
      brier: oddsFit.brier,
      brier_base: oddsFit.brier_base,
      base_rate: oddsFit.base_rate,
      fitted_on: oddsFit.fitted_on,
      coef: oddsFit.coef,
    },
    honesty: [
      'The multiple model was tested with leave-one-out and walk-forward errors against a base-only intercept. ',
      'The odds model was fitted jointly and each feature was checked by refitting without it; features whose removal did not worsen Brier are reported as dropped. ',
      'Hold-out checks confirmed the kept terms reduce error, but the sample is small and chain-level data is coarse. ',
      'The snapshot cannot reveal holder counts, token unlock schedules, or confirmed launch dates, so farm odds are estimates only. ',
    ],
    checksum: checksumOf(rows),
  };

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: floorUsd,
    model_version: 'orbitradar-1',
    counts,
    evidence,
    rows,
    live: liveRows,
    set_aside: setAside,
  };

  return { board: rows, radar };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const wl = snapshot.watchlist;
  const boardSlugs = new Set(board.map((r) => r.slug));
  for (const slug of wl) {
    if (!boardSlugs.has(slug)) {
      return `watchlist slug missing: ${slug}`;
    }
  }
  for (let i = 0; i < board.length; i++) {
    if (board[i].rank !== i + 1) return `ranks not sequential at ${board[i].slug}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i].implied_value_usd > board[i - 1].implied_value_usd) {
      return `implied rises with rank at ${board[i].slug}`;
    }
  }
  const first = board[0]?.implied_value_usd;
  const allSame = board.every((r) => r.implied_value_usd === first);
  if (allSame) return 'all implied values equal';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `implied not positive safe integer at ${r.slug}`;
    }
    if (r.farm.steps.length < 3 || r.farm.steps.length > 12) {
      return `farm steps count bad at ${r.slug}`;
    }
    for (const st of r.farm.steps) {
      if (st.length < 20 || st.length > 600) {
        return `farm step length bad at ${r.slug}`;
      }
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}