// 全データの自動検査。使い方: node tools/check.mjs [分野名=minpaku]
// 結果の詳細は tools/report.txt に保存し、画面には要約だけ出す。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../js/engine.js';
import { renderDoc, docLines } from '../js/docs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const domain = process.argv[2] || 'minpaku';
const rd = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const opt = p => (existsSync(path.join(ROOT, p)) ? rd(p) : null);

const errors = [], warns = [], info = [];
const err = m => errors.push(m), warn = m => warns.push(m);

const tree = rd(`data/${domain}/tree.json`);
const cards = opt(`data/${domain}/cards.json`)?.cards || [];
const checklists = opt(`data/${domain}/checklists.json`)?.items || [];
const cases = opt(`data/${domain}/cases.json`)?.cases || [];
const docs = opt(`data/${domain}/docs.json`)?.docs || [];
const glossary = opt(`data/${domain}/glossary.json`)?.terms || [];
const facts = opt(`data/${domain}/facts.json`)?.facts || [];
const sources = opt('data/sources.json')?.sources || [];
const srcIds = new Set(sources.map(s => s.id));
const factIds = new Set(facts.map(f => f.id));
const TODAY = new Date();

// ---- 1. 質問データの形 ----
const ids = Object.keys(tree.nodes);
if (!tree.nodes[tree.start]) err('開始の質問がない: ' + tree.start);
const exists = t => t === E.RESULT || t === E.EMERGENCY || !!tree.nodes[t];
for (const id of ids) {
  const n = tree.nodes[id];
  if (!['yesno', 'choice', 'multi'].includes(n.type)) err(`${id}: type が不正`);
  for (const k of ['fact', 'sum', 'text']) if (!n[k]) err(`${id}: ${k} がない`);
  if (n.optionSet && !tree.optionSets?.[n.optionSet]) err(`${id}: optionSet ${n.optionSet} がない`);
  const opts = E.optionsOf(tree, n);
  if (opts.length < 2) err(`${id}: 選択肢が2つ未満`);
  const vals = opts.map(o => o.value);
  if (new Set(vals).size !== vals.length) err(`${id}: 選択肢の値が重複`);
  for (const t of E.targetsOf(tree, id)) if (!exists(t)) err(`${id}: 行き先 ${t} が存在しない`);
  if (!E.targetsOf(tree, id).length) err(`${id}: 行き先がない（行き止まり）`);
}

// ---- 2. 到達できるか・ループがないか ----
const reach = new Set();
(function walk(id) { if (!tree.nodes[id] || reach.has(id)) return; reach.add(id); E.targetsOf(tree, id).forEach(walk); })(tree.start);
for (const id of ids) if (!reach.has(id)) err(`${id}: どこからもたどり着けない`);
(function cyc(id, stack) {
  if (!tree.nodes[id]) return;
  if (stack.includes(id)) { err('ループ: ' + [...stack, id].join(' → ')); return; }
  E.targetsOf(tree, id).forEach(t => cyc(t, [...stack, id]));
})(tree.start, []);

// ---- 3. 全経路をたどる ----
// 複数選択は：分岐条件に使う質問は全組み合わせ、それ以外は「1つずつ」と「全部」
const condFacts = new Set();
const collect = c => { if (!c) return; if (Array.isArray(c)) return c.forEach(collect); if (c.all) return c.all.forEach(collect); if (c.any) return c.any.forEach(collect); if (c.not) return collect(c.not); condFacts.add(c.fact); };
for (const id of ids) { const n = tree.nodes[id]; if (Array.isArray(n.next)) n.next.forEach(r => collect(r.if)); }
function answersFor(n) {
  const opts = E.optionsOf(tree, n).map(o => o.value);
  if (n.type !== 'multi') return opts;
  const plain = E.optionsOf(tree, n).filter(o => !o.exclusive).map(o => o.value);
  const set = new Map();
  const add = a => { const k = E.normalizeMulti(tree, n, a).slice().sort().join(','); if (!set.has(k)) set.set(k, E.normalizeMulti(tree, n, a)); };
  if (condFacts.has(n.fact)) {
    for (let m = 1; m < 1 << opts.length; m++) add(opts.filter((_, i) => m & (1 << i)));
  } else { opts.forEach(o => add([o])); add(plain); }
  return [...set.values()];
}

let paths = 0, maxLen = 0, emptySec = {}, noCase = 0;
const finals = [];
const data = { cards, checklists, cases };
function dfs(state) {
  if (state.node === E.RESULT) {
    paths++;
    const len = state.history.length;
    maxLen = Math.max(maxLen, len);
    if (len > tree.maxQuestions) err(`質問が${len}問の経路: ` + state.history.map(h => h.node).join('→'));
    const seen = new Set();
    for (const h of state.history) { const f = tree.nodes[h.node].fact; if (seen.has(f)) err('同じ事実を2回聞く経路: ' + f); seen.add(f); }
    if (cards.length) {
      const r = E.compose(data, state.facts);
      for (const sec of ['todo', 'check', 'checklist', 'ifnot', 'dont']) if (!r[sec].length) { emptySec[sec] = (emptySec[sec] || 0) + 1; if (emptySec[sec] <= 3) err(`結果の「${sec}」が空: ` + JSON.stringify(state.facts)); }
      if (!r.cases.length) noCase++;
      const shown = new Set([...r.todo, ...r.check, ...r.ifnot, ...r.dont].map(c => c.id));
      for (const c of cards) if (shown.has(c.id)) for (const x of c.conflicts || []) if (shown.has(x)) err(`同時に出てはいけない ${c.id} と ${x} が出た: ` + JSON.stringify(state.facts));
      if (paths % 5000 === 1) finals.push({ facts: state.facts, todo: r.todo.slice(0, 3).map(c => c.id) });
    }
    return;
  }
  if (state.node === E.EMERGENCY) return;
  const n = tree.nodes[state.node];
  for (const a of answersFor(n)) {
    let s;
    try { s = E.answer(tree, state, a); } catch (e) { err(`${state.node} に ${a} と答えると失敗: ${e.message}`); continue; }
    dfs(s);
  }
}
dfs(E.begin(tree));
info.push(`経路数 ${paths} / 最長 ${maxLen} 問（上限 ${tree.maxQuestions}）`);
if (cards.length) info.push(`似た事例が出ない経路 ${noCase}`);

// ---- 4. カード・資料・用語 ----
const allIds = new Set();
for (const c of cards) {
  if (allIds.has(c.id)) err('カードIDの重複: ' + c.id); allIds.add(c.id);
  if (!['do', 'check', 'ifnot', 'dont'].includes(c.section)) err(`${c.id}: section が不正`);
  if (c.section === 'do') for (const k of ['where', 'check', 'bring', 'script', 'ifNoAnswer']) if (!c[k] || (Array.isArray(c[k]) && !c[k].length)) err(`${c.id}: 今できることに ${k} がない`);
  for (const s of c.sources || []) if (!srcIds.has(s)) warn(`${c.id}: 資料 ${s} が sources.json にない`);
  for (const f of c.facts || []) if (!factIds.has(f)) warn(`${c.id}: 事実 ${f} が facts.json にない`);
  try { E.test(c.when, {}); } catch (e) { err(`${c.id}: 条件が不正 ${e.message}`); }
  for (const x of c.conflicts || []) if (!cards.some(k => k.id === x)) err(`${c.id}: conflicts の ${x} がない`);
}
for (const s of sources) {
  if (!s.url || !s.checked) err(`資料 ${s.id}: url か checked がない`);
  else if ((TODAY - new Date(s.checked)) / 864e5 > 183) warn(`資料 ${s.id}: 確認から6か月以上たっている`);
}
for (const c of cases) {
  if (!c.sources?.length) err(`事例 ${c.id}: 資料がない`);
  for (const s of c.sources || []) if (!srcIds.has(s.sourceId)) err(`事例 ${c.id}: 資料 ${s.sourceId} が sources.json にない`);
  if (!['resolved', 'partial', 'unresolved', 'unknown'].includes(c.outcome)) err(`事例 ${c.id}: outcome が不正`);
}
const terms = new Set(glossary.map(g => g.term));
const allText = JSON.stringify({ tree, cards, checklists, docs });
for (const m of allText.matchAll(/\[\[([^\]]+)\]\]/g)) if (!terms.has(m[1])) warn('用語の説明がない: ' + m[1]);

// ---- 5. 表現の検査（断定・属性） ----
// 「宗教施設」は建物の種類として使う（分野名）。それ以外の「宗教」や、特定の宗教・宗派の名前は質問・結果に入れない
const BANNED = [/違法です/, /違反しています/, /違法営業です/, /犯罪です/, /国籍/, /民族/, /外国人(?!滞在施設経営事業)/, /中国人|韓国人/, /宗教(?!施設)/, /イスラム|ムスリム|モスク|キリスト教|カトリック|プロテスタント|仏教|神道|ヒンドゥー|ユダヤ|新興宗教|カルト/];
const texts = [];
const pushTexts = (o, where) => { if (typeof o === 'string') texts.push([where, o]); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) pushTexts(v, where); };
pushTexts(tree, 'tree'); cards.forEach(c => pushTexts(c, c.id)); checklists.forEach(c => pushTexts(c, c.id)); docs.forEach(d => pushTexts(d, d.id));
for (const [w, t] of texts) for (const re of BANNED) if (re.test(t)) err(`表現の検査: ${w} に「${t.match(re)[0]}」`);

// ---- 6. 文書ひな形：入力していない事実を書かないか ----
for (const d of docs) {
  const emptyLines = docLines(d, {});
  const fixed = d.body.filter(l => !l.requires?.length).length;
  if (emptyLines.length !== fixed) err(`文書 ${d.id}: 空欄なのに入力が必要な行が出る`);
  if (/\{[a-z_]+\}/.test(renderDoc(d, {}))) err(`文書 ${d.id}: 置き換えられていない欄がある`);
  for (const line of d.body) if (!line.requires?.length && /\{/.test(line.text)) err(`文書 ${d.id}: 「${line.text.slice(0, 16)}…」は欄を使うのに requires がない`);
  for (const line of d.body) for (const m of line.text.matchAll(/\{([a-z_]+)\}/g)) {
    if (!d.fields.some(f => f.id === m[1])) err(`文書 ${d.id}: 欄 ${m[1]} が fields にない`);
    if (!(line.requires || []).includes(m[1])) err(`文書 ${d.id}: 「${line.text.slice(0, 16)}…」は ${m[1]} を使うのに requires にない`);
  }
}

// ---- 出力 ----
const out = [`検査日時 ${TODAY.toISOString()}  分野 ${domain}`, ...info, '', `エラー ${errors.length} 件`, ...errors.slice(0, 200), '', `注意 ${warns.length} 件`, ...warns.slice(0, 200), '', '抜き取り（5000経路ごと）', ...finals.map(f => JSON.stringify(f))];
writeFileSync(path.join(ROOT, 'tools/report.txt'), out.join('\n'));
console.log(info.join('\n'));
console.log(`エラー ${errors.length} 件 / 注意 ${warns.length} 件（詳細: tools/report.txt）`);
errors.slice(0, 8).forEach(e => console.log('  ✗ ' + e));
warns.slice(0, 5).forEach(e => console.log('  △ ' + e));
process.exit(errors.length ? 1 : 0);
