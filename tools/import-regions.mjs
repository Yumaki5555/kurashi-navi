// 地域データの取り込み（読み取りのみ。元のサイトは変更しない）
//  1) 自治体一覧：「声を届ける」が公開している総務省コードの一覧 → data/regions/areas.json
//  2) 施設一覧の出典：「民泊・旅館業マップ」の registry.csv → data/regions/minpaku-lists.json
// 使い方: node tools/import-regions.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/regions');
const TODOKERU = 'https://yumaki5555.github.io/todokeru/data/master/';
const REGISTRY = 'https://raw.githubusercontent.com/yumaki5555/minpaku-map/main/registry.csv';
const today = new Date().toLocaleDateString('sv-SE');

async function get(url, json = true) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} を読めませんでした (${r.status})`);
  return json ? r.json() : r.text();
}

// CSV（ダブルクォート対応）
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const ymd = s => (s || '').trim().replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1') || null;

const [prefs, munis] = await Promise.all([get(TODOKERU + 'prefectures.json'), get(TODOKERU + 'municipalities.json')]);
const areas = {
  source: prefs.source, source_url: prefs.source_url, via: TODOKERU, checked_at: munis.checked_at, imported: today,
  prefs: prefs.items.map(p => ({ code: p.code, name: p.name, cities: munis.items.filter(m => m.pref_code === p.code).map(m => [m.code, m.name]) }))
};
const cityCodes = new Set(munis.items.map(m => m.code));

const csv = parseCSV(await get(REGISTRY, false));
const head = csv[0].map(h => h.trim());
const col = name => { const i = head.indexOf(name); if (i < 0) throw new Error('registry.csv に列がありません: ' + name); return i; };
const C = { key: col('自治体コード'), name: col('自治体名'), title: col('文書タイトル'), count: col('登録件数'), dataDate: col('元データ日付'), basis: col('日付の根拠'), run: col('実行日'), doc: col('文書リンク'), page: col('元HP') };
const KIND = { '民': 'jutaku', '旅': 'ryokan', '民特': 'tokku' };
const byCode = {}; const problems = []; const fixed = new Set(); let n = 0;
for (const r of csv.slice(1)) {
  const [code, k] = (r[C.key] || '').trim().split('_');
  const kind = KIND[k];
  if (!code || !kind) { problems.push('読めない行: ' + r[C.key]); continue; }
  let key = code;
  if (/^\d{2}000$/.test(code)) key = code.slice(0, 2); // 都道府県単位
  else if (!cityCodes.has(code)) {
    // コードが総務省の一覧と合わないときは、同じ都道府県の同じ名前の自治体に引き直す
    const nm = r[C.name].trim();
    const hit = munis.items.find(m => m.pref_code === code.slice(0, 2) && m.name === nm);
    if (hit) { key = hit.code; fixed.add(`${nm}: ${code} → ${hit.code}`); }
    else problems.push(`自治体コードが一覧にない: ${code} ${nm}`);
  }
  const url = (r[C.page] || '').trim() || (r[C.doc] || '').trim();
  if (!/^https?:\/\//.test(url)) { problems.push('URLがない: ' + r[C.key]); continue; }
  (byCode[key] ||= []).push({
    kind, owner: r[C.name].trim(), title: r[C.title].trim(), url, doc: (r[C.doc] || '').trim() || null,
    count: Number(r[C.count]) || null, dataDate: ymd(r[C.dataDate]), dateBasis: (r[C.basis] || '').trim() || null, checked: ymd(r[C.run])
  });
  n++;
}
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'areas.json'), JSON.stringify(areas));
writeFileSync(path.join(OUT, 'minpaku-lists.json'), JSON.stringify({ source: '民泊・旅館業マップ（registry.csv）', source_url: REGISTRY, imported: today, byCode }, null, 1));
console.log(`都道府県 ${areas.prefs.length} / 市区町村 ${munis.items.length}`);
console.log(`registry.csv ${csv.length - 1} 行 → 取り込み ${n} 件（地域 ${Object.keys(byCode).length}）`);
fixed.forEach(p => console.log('  コードを名前で引き直し ' + p));
problems.forEach(p => console.log('  △ ' + p));
// 抜き取り確認：新宿区・大阪市・京都市
for (const c of ['131041', '271004', '261009']) console.log(`  抜き取り ${c}: ` + (byCode[c] || []).map(x => `${x.kind}「${x.title}」${x.dataDate || ''}`).join(' / '));
