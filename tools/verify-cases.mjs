// 事例の照合：事例が出典の本文と食い違っていないかをプログラムで確かめる。
// 使い方：
//   node tools/verify-cases.mjs <候補ファイル.json>   … 追加前の候補（{domain, cases, sources}）を検査
//   node tools/verify-cases.mjs <分野>                … data/<分野>/cases.json を検査
// 詳細は、候補なら <候補ファイル>.report.txt、分野なら tools/verify-cases-report.txt に出る
// 検査すること：
//   1. 必須の項目・outcome・routes（その分野の状況の値）・資料ID・IDの重複
//   2. 禁止語（断定・属性・宗教・政党名）
//   3. evidence（{sourceId, quote}）の引用が、出典の本文にそのまま含まれるか（空白・全角半角・和暦の違いは無視）
//   4. 本文中の日付・金額・件数などの数字が、その事例の出典のどれかに含まれるか（見つからなければ「要確認」）
// 出典の本文は research/.cache-sources/ に保存し、2回目からはそれを使う（--refresh で取り直し）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const target = args.find(a => !a.startsWith('--'));
if (!target) { console.log('使い方: node tools/verify-cases.mjs <候補ファイル.json | 分野>'); process.exit(1); }

const DOMAINS = ['minpaku', 'kenchiku', 'gakko', 'gyosei', 'yosan'];
const isDomain = DOMAINS.includes(target);
let cand;
if (isDomain) cand = { domain: target, cases: J(`data/${target}/cases.json`).cases, sources: [] };
else cand = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8'));
const domain = cand.domain;
if (!DOMAINS.includes(domain)) { console.log('domain が不正: ' + domain); process.exit(1); }

const known = J('data/sources.json').sources;
const srcMap = new Map(known.map(s => [s.id, s]));
for (const s of cand.sources || []) srcMap.set(s.id, s);
const tree = J(`data/${domain}/tree.json`);
const nodes = Array.isArray(tree.nodes) ? tree.nodes : Object.values(tree.nodes);
const routesOK = new Set((nodes.find(n => n.fact === 'situation')?.options || []).map(o => o.value));
const existingIds = new Set(DOMAINS.flatMap(d => J(`data/${d}/cases.json`).cases.map(c => c.id)));

// ---- 本文の取得 ----
const CACHE = path.join(ROOT, 'research', '.cache-sources');
fs.mkdirSync(CACHE, { recursive: true });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', yen: '¥', times: '×', hellip: '…', mdash: '—', ndash: '–', rarr: '→', larr: '←' };
function htmlText(buf, ctype) {
  let cs = (ctype.match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) cs = (buf.subarray(0, 4000).toString('latin1').match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  cs = cs.toLowerCase().replace(/^(x-sjis|sjis|windows-31j|cp932|ms_kanji)$/, 'shift_jis');
  let s; try { s = new TextDecoder(cs).decode(buf); } catch { s = new TextDecoder('utf-8').decode(buf); }
  return s.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
// pdftotext と pypdf の両方で取り出し、日本語の文字が多く取れたほうを使う（日本語の字形表がなく取りこぼすPDFがあるため）
function pdfText(buf) {
  const f = path.join(os.tmpdir(), 'vc-' + crypto.randomBytes(6).toString('hex') + '.pdf');
  fs.writeFileSync(f, buf);
  const run = (cmd, a) => { try { return execFileSync(cmd, a, { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch { return ''; } };
  try {
    const cands = [run('pdftotext', ['-enc', 'UTF-8', f, '-']),
      run('python', ['-I', '-c', 'import sys,pypdf;sys.stdout.reconfigure(encoding="utf-8");print("\n".join(p.extract_text() or "" for p in pypdf.PdfReader(sys.argv[1]).pages))', f])];
    const cjk = t => (t.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
    const best = cands.sort((x, y) => cjk(y) - cjk(x))[0];
    if (!cjk(best)) throw new Error('PDFの文字を取り出せない（画像のPDFかもしれない）');
    return best;
  } finally { fs.rmSync(f, { force: true }); }
}
async function getText(url) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.txt');
  if (!refresh && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const ctype = res.headers.get('content-type') || '';
  const text = (/pdf/i.test(ctype) || buf.subarray(0, 5).toString('latin1') === '%PDF-') ? pdfText(buf) : htmlText(buf, ctype);
  fs.writeFileSync(file, url + '\n' + text);
  return url + '\n' + text;
}

// ---- 比べやすい形にそろえる（両方に同じ変換をかける） ----
const KN = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
function kanjiNum(s) {
  let total = 0, cur = 0, plain = '';
  for (const ch of s) {
    if (ch in KN) { cur = cur * 10 + KN[ch]; plain += KN[ch]; }
    else { const u = { '十': 10, '百': 100, '千': 1000 }[ch]; total += (cur || 1) * u; cur = 0; plain = null; }
  }
  return plain !== null && !/[十百千]/.test(s) ? String(+plain) : String(total + cur);
}
const ERA = { '令和': 2018, '平成': 1988, '昭和': 1925 };
function norm(s) {
  return String(s).normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .replace(/([〇零一二三四五六七八九十百千]+)(?=年|月|日|条|項|号|件|人|回|か所|箇所|校|円|万|億)/g, m => kanjiNum(m))
    .replace(/(?<![A-Za-z])([RHS])(\d{1,2})\.(\d{1,2})\.(\d{1,2})(?!\d)/g, (_, e, y, m, d) => `${{ R: 2018, H: 1988, S: 1925 }[e] + +y}年${+m}月${+d}日`)
    .replace(/(令和|平成|昭和)(元|\d+)年/g, (_, e, n) => (ERA[e] + (n === '元' ? 1 : +n)) + '年')
    .replace(/(\d{4})年\((\d{4})年\)/g, '$2年')
    .replace(/(\d),(?=\d{3})/g, '$1')
    .replace(/[‐‑‒–—―ー－]/g, 'ー')
    .replace(/[ヶケ箇](?=所)/g, 'か')
    .replace(/[“”"「」『』]/g, '');
}

// ---- 検査 ----
const BANNED = [/違法です/, /違反しています/, /違法営業です/, /犯罪です/, /国籍/, /民族/, /外国人(?!滞在施設経営事業)/, /中国人|韓国人/, /宗教(?!施設)/,
  /イスラム|ムスリム|モスク|キリスト教|カトリック|プロテスタント|仏教|神道|ヒンドゥー|ユダヤ|新興宗教|カルト/,
  /自民党|自由民主党|立憲民主|公明党|共産党|維新の会|国民民主党|れいわ|社民党|社会民主党|参政党|日本保守党|会派「/];
const TEXT_KEYS = ['title', 'period', 'situation', 'issue', 'response', 'result', 'after', 'lesson'];
const NUM = /\d{4}年\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月|\d{4}年度|\d{4}年|\d[\d,]*(?:\.\d+)?(?:万|億)?円|\d+(?:件|か所|人|校|回|日以内|か月|割|%)/g;

const out = [];
let nErr = 0, nWarn = 0;
const line = (lv, msg) => { out.push(`  ${lv} ${msg}`); if (lv === '×') nErr++; else if (lv === '△') nWarn++; };
const textCache = new Map();
async function srcText(id) {
  if (!textCache.has(id)) {
    const s = srcMap.get(id);
    textCache.set(id, s ? getText(s.url).then(t => ({ ok: true, t: norm(t) }), e => ({ ok: false, e: e.message })) : Promise.resolve({ ok: false, e: '資料が見つからない' }));
  }
  return textCache.get(id);
}

const seen = new Set();
for (const c of cand.cases) {
  out.push(`■ ${c.id}  ${c.title || ''}`);
  if (seen.has(c.id)) line('×', 'IDが候補の中で重複'); seen.add(c.id);
  if (!isDomain && existingIds.has(c.id)) line('×', 'IDが既存の事例と重複');
  for (const k of ['id', 'title', 'period', 'situation', 'issue', 'response', 'lesson', 'checked']) if (!c[k]) line('×', `${k} がない`);
  if (!c.result) line(isDomain ? '△' : '×', 'result がない');
  if (!c.place?.pref) line('×', 'place.pref がない');
  if (!['resolved', 'partial', 'unresolved', 'unknown'].includes(c.outcome)) line('×', 'outcome が不正');
  if (!c.routes?.length) line('×', 'routes がない');
  for (const r of c.routes || []) if (!routesOK.has(r)) line('×', `routes の ${r} は ${domain} の状況にない`);
  if (!Array.isArray(c.tags)) line('×', 'tags が配列でない');
  if (!c.sources?.length) line('×', 'sources がない');
  for (const s of c.sources || []) if (!srcMap.has(s.sourceId)) line('×', `資料 ${s.sourceId} がない`);
  const body = TEXT_KEYS.map(k => c[k] || '').join('\n') + '\n' + (c.laws || []).join('\n');
  for (const re of BANNED) { const m = body.match(re); if (m) line('×', `禁止語「${m[0]}」`); }

  const ids = [...new Set([...(c.sources || []).map(s => s.sourceId), ...(c.evidence || []).map(e => e.sourceId)])];
  const texts = {};
  for (const id of ids) {
    const r = await srcText(id);
    if (r.ok) texts[id] = r.t; else line('×', `資料 ${id} の本文を取得できない（${r.e}）${srcMap.get(id)?.url || ''}`);
  }
  const all = Object.values(texts).join('\n');
  let okQ = 0;
  for (const e of c.evidence || []) {
    if (!(e.sourceId in texts)) continue;
    if (texts[e.sourceId].includes(norm(e.quote))) okQ++;
    else line('×', `引用が ${e.sourceId} に見つからない：「${e.quote}」`);
  }
  if (c.evidence) out.push(`  引用 ${okQ}/${c.evidence.length} 件一致`);
  if (Object.keys(texts).length) {
    const nums = new Set();
    for (const k of TEXT_KEYS) for (const m of norm(c[k] || '').matchAll(NUM)) nums.add(m[0]);
    const miss = [...nums].filter(n => !all.includes(n));
    if (miss.length) line('△', `数字が出典に見つからない（要確認）：${miss.join('、')}`);
  }
}
const summary = `検査 ${new Date().toISOString()}  ${target}  事例 ${cand.cases.length} 件  エラー ${nErr}  要確認 ${nWarn}`;
const rep = isDomain ? path.join(ROOT, 'tools', 'verify-cases-report.txt') : path.resolve(target).replace(/\.json$/, '') + '.report.txt';
fs.writeFileSync(rep, summary + '\n' + out.join('\n') + '\n');
console.log(summary + '\n詳細: ' + rep);
process.exit(nErr ? 1 : 0);
