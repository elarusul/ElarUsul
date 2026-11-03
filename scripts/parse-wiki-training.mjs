import fs from 'fs';

function parseUnits(html) {
  const units = [];
  const parts = html.split('<div class="nombre"');
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].slice(0, 3000);
    const nameM = block.match(/<b[^>]*>([^<]+)<\/b>/);
    const smallM = block.match(/<small[^>]*>([^<]+)<\/small>/);
    const marcaM = block.match(/<span class="marca"[^>]*>([^<]+)<\/span>/);
    if (!nameM) continue;
    const trainM = block.match(/>Training<\/span><b[^>]*>([^<]*)<\/b>/);
    units.push({
      tierMark: marcaM?.[1]?.trim() ?? '',
      name: nameM[1].trim(),
      kind: smallM?.[1]?.trim() ?? '',
      training: trainM?.[1]?.trim() ?? '',
    });
  }
  return units;
}

function parseNum(raw) {
  if (!raw) return null;
  // e.g. "2.53k 240" or "60" or "4.41k"
  const parts = raw.trim().split(/\s+/);
  return parts.map((p) => {
    const m = p.match(/^([\d.]+)k$/i);
    if (m) return Math.round(parseFloat(m[1]) * 1000);
    const n = Number(p.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  });
}

const g = fs.readFileSync(`${process.env.TEMP}/tb-g.html`, 'utf8');
const m = fs.readFileSync(`${process.env.TEMP}/tb-m.html`, 'utf8');

const guards = parseUnits(g).map((u) => ({ ...u, nums: parseNum(u.training) }));
const monsters = parseUnits(m).map((u) => ({ ...u, nums: parseNum(u.training) }));

console.log('=== GUARDSMEN ===');
for (const u of guards) {
  console.log(`${u.name}\t${u.kind}\t${u.training}\t=>\t${JSON.stringify(u.nums)}`);
}
console.log('=== MONSTERS ===');
for (const u of monsters) {
  console.log(`${u.name}\t${u.kind}\t${u.training}\t=>\t${JSON.stringify(u.nums)}`);
}
