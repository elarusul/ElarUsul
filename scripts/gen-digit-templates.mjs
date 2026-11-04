/**
 * Generate digit NCC templates from labeled icon crops → src/app/army/scanner/digit-templates.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const cases = [
  ['t2-0.png', 2107],
  ['t2-1.png', 2156],
  ['t2-2.png', 2415],
  ['t2-3.png', 1851],
  ['t2-4.png', 1340],
  ['t2-5.png', 967],
  ['t2-6.png', 1080],
  ['m2-0.png', 216],
  ['m2-1.png', 63],
  ['m2-4.png', 510],
  ['m2-6.png', 84],
];

const TW = 12;
const TH = 16;
const dir = path.join(process.cwd(), 'tmp-scan');

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
function sat(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function compsInBand(mask, w, x0, x1, by0, by1) {
  const seen = new Uint8Array(mask.length);
  const comps = [];
  const stack = [];
  for (let y = by0; y < by1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = y * w + x;
      if (!mask[s] || seen[s]) continue;
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y,
        area = 0;
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        const cur = stack.pop();
        area++;
        const cx = cur % w;
        const cy = (cur / w) | 0;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx,
            ny = cy + dy;
          if (nx < x0 || ny < by0 || nx >= x1 || ny >= by1) continue;
          const ni = ny * w + nx;
          if (!mask[ni] || seen[ni]) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      comps.push({ minX, maxX, minY, maxY, area });
    }
  }
  return comps;
}

function extract(data, w, h) {
  const L = new Float32Array(w * h);
  const S = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    L[i] = luma(data[p], data[p + 1], data[p + 2]);
    S[i] = sat(data[p], data[p + 1], data[p + 2]);
  }
  const x0 = Math.floor(w * 0.26);
  const x1 = Math.floor(w * 0.86);
  const y0 = Math.floor(h * 0.48);
  const y1 = Math.floor(h * 0.92);
  const seed = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (L[i] < 148 || S[i] > 60) continue;
      let darkN = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const ny = y + dy,
            nx = x + dx;
          if (ny < 0 || nx < 0 || ny >= h || nx >= w) continue;
          if (L[ny * w + nx] < 100) darkN++;
        }
      }
      if (darkN >= 1 || L[i] >= 210) seed[i] = 1;
    }
  }
  const full = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!seed[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy,
            nx = x + dx;
          if (ny < y0 || ny >= y1 || nx < x0 || nx >= x1) continue;
          const j = ny * w + nx;
          if (L[j] >= 135 && S[j] <= 65) full[j] = 1;
        }
      }
    }
  }
  let best = { y0, y1: y0 + 12, score: -1, medH: 8 };
  for (let bandH = 9; bandH <= 14; bandH++) {
    for (let y = y0; y + bandH <= y1; y++) {
      const comps = compsInBand(full, w, x0, x1, y, y + bandH);
      const digits = comps.filter((c) => {
        const gw = c.maxX - c.minX + 1;
        const gh = c.maxY - c.minY + 1;
        return c.area >= 6 && gh >= 5 && gh <= 14 && gw >= 2 && gw <= 12;
      });
      if (digits.length < 2) continue;
      const heights = digits.map((d) => d.maxY - d.minY + 1).sort((a, b) => a - b);
      const medH = heights[Math.floor(heights.length / 2)];
      const consistent = digits.filter(
        (d) => Math.abs(d.maxY - d.minY + 1 - medH) <= 3,
      );
      if (consistent.length < 2) continue;
      let bg = 0,
        bn = 0;
      for (const d of consistent) {
        for (let yy = d.minY; yy <= d.maxY; yy++) {
          for (let xx = d.minX - 2; xx <= d.maxX + 2; xx++) {
            if (xx < 0 || xx >= w) continue;
            if (full[yy * w + xx]) continue;
            bg += L[yy * w + xx];
            bn++;
          }
        }
      }
      const meanBg = bn ? bg / bn : 255;
      let score = consistent.length * 25 + 40 + (y / y1) * 5;
      if (meanBg < 120) score += 30;
      if (meanBg > 160) score -= 40;
      if (score > best.score) best = { y0: y, y1: y + bandH, score, medH };
    }
  }
  const mask = new Uint8Array(w * h);
  const yA = Math.max(0, best.y0 - 2);
  const yB = Math.min(h, best.y1 + 2);
  for (let y = yA; y < yB; y++) {
    for (let x = x0; x < x1; x++) mask[y * w + x] = full[y * w + x];
  }
  const comps = compsInBand(mask, w, x0, x1, yA, yB);
  const mh = best.medH || 8;
  let glyphs = comps
    .filter((c) => {
      const gw = c.maxX - c.minX + 1;
      const gh = c.maxY - c.minY + 1;
      if (c.area < 3) return false;
      if (gh >= mh * 0.55 && gh <= mh * 1.45 && gw <= mh * 1.5) return true;
      if (gh <= mh * 0.4 && gw <= mh * 0.55) return true;
      return false;
    })
    .sort((a, b) => a.minX - b.minX);
  const digits = glyphs.filter((g) => g.maxY - g.minY + 1 >= mh * 0.55);
  if (digits.length) {
    const left = digits[0].minX;
    const right = digits[digits.length - 1].maxX;
    glyphs = glyphs.filter((g) => g.minX >= left - 2 && g.maxX <= right + 2);
  }
  return { mask, glyphs, medH: mh, w };
}

function toBitmap(mask, w, comp) {
  const gw = comp.maxX - comp.minX + 1;
  const gh = comp.maxY - comp.minY + 1;
  const out = new Uint8Array(TW * TH);
  const scale = Math.min((TW - 2) / gw, (TH - 2) / gh);
  const rw = Math.max(1, Math.round(gw * scale));
  const rh = Math.max(1, Math.round(gh * scale));
  const ox = 1 + (((TW - 2 - rw) / 2) | 0);
  const oy = 1 + (((TH - 2 - rh) / 2) | 0);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const sx = comp.minX + Math.min(gw - 1, ((x * gw) / rw) | 0);
      const sy = comp.minY + Math.min(gh - 1, ((y * gh) / rh) | 0);
      out[(y + oy) * TW + (x + ox)] = mask[sy * w + sx] ? 1 : 0;
    }
  }
  return out;
}

const bank = {};
for (const [file, expect] of cases) {
  const { data, info } = await sharp(path.join(dir, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ex = extract(data, info.width, info.height);
  const digitChars = String(expect).split('');
  const dGlyphs = ex.glyphs.filter((g) => g.maxY - g.minY + 1 >= ex.medH * 0.55);
  console.log(
    file,
    'digits',
    dGlyphs.length,
    'want',
    digitChars.length,
    'allGlyphs',
    ex.glyphs.length,
  );
  if (dGlyphs.length !== digitChars.length) continue;
  for (let i = 0; i < digitChars.length; i++) {
    const ch = digitChars[i];
    if (!bank[ch]) bank[ch] = [];
    bank[ch].push(Array.from(toBitmap(ex.mask, ex.w, dGlyphs[i])));
  }
}

const outPath = path.join(
  process.cwd(),
  'src/app/army/scanner/digit-templates.ts',
);
const body = `/* Auto-generated by scripts/gen-digit-templates.mjs — do not edit by hand. */
export const DIGIT_TW = ${TW};
export const DIGIT_TH = ${TH};
export const DIGIT_TEMPLATES: Record<string, number[][]> = ${JSON.stringify(bank, null, 2)};
`;
fs.writeFileSync(outPath, body);
console.log(
  'wrote',
  outPath,
  Object.fromEntries(Object.entries(bank).map(([k, v]) => [k, v.length])),
);
