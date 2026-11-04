import type { RgbaImage } from './image-utils';

const BINS = 6;

export interface IconFeatures {
  hist: Float64Array;
  hnorm: number;
  gray: Float32Array;
  mask: Uint8Array;
  mean: [number, number, number];
  width: number;
  height: number;
}

/** Features from portrait ROI (skip tier badge + count bar). */
export function extractFeatures(img: RgbaImage): IconFeatures {
  const { data, width: w, height: h } = img;
  const hist = new Float64Array(BINS ** 3);
  const gray = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  let n = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const x0 = Math.floor(w * 0.16);
  const x1 = Math.floor(w * 0.84);
  const y0 = Math.floor(h * 0.16);
  const y1 = Math.floor(h * 0.72);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const a = data[p + 3];
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[i] = L;
      const use = a > 40 && x >= x0 && x < x1 && y >= y0 && y < y1 && L > 25;
      mask[i] = use ? 1 : 0;
      if (!use) continue;
      const br = Math.min(BINS - 1, (r * BINS) >> 8);
      const bg = Math.min(BINS - 1, (g * BINS) >> 8);
      const bb = Math.min(BINS - 1, (b * BINS) >> 8);
      hist[(br * BINS + bg) * BINS + bb] += 1;
      sr += r;
      sg += g;
      sb += b;
      n++;
    }
  }

  let hnorm = 0;
  for (let i = 0; i < hist.length; i++) {
    hist[i] = n ? hist[i] / n : 0;
    hnorm += hist[i] * hist[i];
  }
  return {
    hist,
    hnorm: Math.sqrt(hnorm) || 1,
    gray,
    mask,
    mean: n ? [sr / n, sg / n, sb / n] : [0, 0, 0],
    width: w,
    height: h,
  };
}

export function scoreFeatures(a: IconFeatures, b: IconFeatures): number {
  let dot = 0;
  for (let i = 0; i < a.hist.length; i++) dot += a.hist[i] * b.hist[i];
  const cos = dot / (a.hnorm * b.hnorm);

  let sumIT = 0;
  let sumI = 0;
  let sumT = 0;
  let sumII = 0;
  let sumTT = 0;
  let n = 0;
  const len = Math.min(a.gray.length, b.gray.length);
  for (let i = 0; i < len; i++) {
    if (!a.mask[i] || !b.mask[i]) continue;
    const iv = a.gray[i];
    const tv = b.gray[i];
    sumI += iv;
    sumT += tv;
    sumII += iv * iv;
    sumTT += tv * tv;
    sumIT += iv * tv;
    n++;
  }
  let ncc = 0;
  if (n > 30) {
    const num = n * sumIT - sumI * sumT;
    const den = Math.sqrt(
      (n * sumII - sumI * sumI) * (n * sumTT - sumT * sumT),
    );
    ncc = den > 1e-6 ? num / den : 0;
  }

  const dr = a.mean[0] - b.mean[0];
  const dg = a.mean[1] - b.mean[1];
  const db = a.mean[2] - b.mean[2];
  const color = 1 - Math.sqrt(dr * dr + dg * dg + db * db) / 441;

  return cos * 0.45 + ((ncc + 1) / 2) * 0.35 + color * 0.2;
}
