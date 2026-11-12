// 事例の候補ファイルを、サイトのデータへ移す。
// 使い方：node tools/merge-cases.mjs <候補ファイル.json> [--only=id1,id2]
//   - 事例は data/<分野>/cases.json の最後に足す（照合用の evidence は外す）
//   - 資料は data/sources.json の最後に足す（同じIDが既にあれば足さない。URLが違えば止める）
//   - 先に node tools/verify-cases.mjs <候補ファイル> でエラー0を確かめておくこと
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!file) { console.log('使い方: node tools/merge-cases.mjs <候補ファイル.json> [--only=id1,id2]'); process.exit(1); }
const cand = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const casesPath = path.join(ROOT, 'data', cand.domain, 'cases.json');
const srcPath = path.join(ROOT, 'data', 'sources.json');

// 元のファイルは書き直さず、配列の最後の要素のうしろに文字として差し込む（手で整えた行や改行の記号をそのまま残す）
function load(p) {
  const text = fs.readFileSync(p, 'utf8'), data = JSON.parse(text);
  const key = Object.keys(data)[0], n0 = data[key].length;
  return {
    data, save: d => {
      const add = d[key].slice(n0);
      if (!add.length) return;
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const m = text.match(/\n([ \t]*)\}(\s*\]\s*\}\s*)$/);
      const unit = (text.match(/\n([ \t]+)"/) || [, ' '])[1];
      if (!m) throw new Error(p + ' の終わりの形が想定と違う');
      const body = add.map(x => m[1] + JSON.stringify(x, null, unit).split('\n').join(eol + m[1])).join(',' + eol);
      const out = text.slice(0, m.index) + '\n' + m[1] + '},' + eol + body + m[2];
      if (JSON.stringify(JSON.parse(out)) !== JSON.stringify(d)) throw new Error(p + ' の差し込みに失敗');
      fs.writeFileSync(p, out);
    },
  };
}
const FC = load(casesPath), FS = load(srcPath);
const C = FC.data, S = FS.data;

const picked = cand.cases.filter(c => !only.length || only.includes(c.id));
const have = new Set(C.cases.map(c => c.id));
const srcById = new Map(S.sources.map(s => [s.id, s]));
const need = new Set(picked.flatMap(c => c.sources.map(s => s.sourceId)));
let addS = 0;
for (const s of cand.sources || []) {
  if (!need.has(s.id)) continue;
  const old = srcById.get(s.id);
  if (old) { if (old.url !== s.url) { console.log(`止めました：資料 ${s.id} が別のURLで既にある`); process.exit(1); } continue; }
  S.sources.push(s); srcById.set(s.id, s); addS++;
}
for (const id of need) if (!srcById.has(id)) { console.log(`止めました：資料 ${id} がない`); process.exit(1); }
let addC = 0;
for (const c of picked) {
  if (have.has(c.id)) { console.log(`飛ばしました：${c.id} は既にある`); continue; }
  const { evidence, ...rest } = c;
  C.cases.push(rest); addC++;
}
FC.save(C);
FS.save(S);
console.log(`${cand.domain}：事例 ${addC} 件、資料 ${addS} 件を追加（事例は計 ${C.cases.length} 件）`);
