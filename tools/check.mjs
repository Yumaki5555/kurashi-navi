// 全データの自動検査。使い方: node tools/check.mjs [分野名=minpaku]
// 結果の詳細は tools/report.txt に保存し、画面には要約だけ出す。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../js/engine.js';
import { renderDoc, docLines } from '../js/docs.js';
import { ladderState, isPlanned } from '../js/records.js';

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
const starts = [tree.start, ...Object.values(tree.entries || {})];
for (const s0 of starts) (function walk(id) { if (!tree.nodes[id] || reach.has(id)) return; reach.add(id); E.targetsOf(tree, id).forEach(walk); })(s0);
// legacy：以前の流れの質問。保存されている古い答え（途中の状態を含む）を表示・再開するために残す。新しい流れからは通らなくてよい
for (const id of ids) if (!reach.has(id) && !tree.nodes[id].legacy) err(`${id}: どこからもたどり着けない`);
for (const id of ids) if (tree.nodes[id].legacy) for (const t of E.targetsOf(tree, id)) if (!exists(t)) err(`${id}（以前の質問）: 行き先 ${t} がない`);
const cyc = function (id, stack) {
  if (!tree.nodes[id]) return;
  if (stack.includes(id)) { err('ループ: ' + [...stack, id].join(' → ')); return; }
  E.targetsOf(tree, id).forEach(t => cyc(t, [...stack, id]));
};
for (const s0 of starts) cyc(s0, []);

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
      const shown = new Set([...r.todo, ...r.recur, ...r.check, ...r.ifnot, ...r.dont].map(c => c.id));
      // 「よくなった」なら見守りの案内だけを先に出す。そうでなければ見守りの案内は出さない
      if (state.facts.outcome === 'improved' && r.todo.some(c => !c.onImproved)) err('よくなったのに相談・要望の案内が「次にすること」に出た: ' + JSON.stringify(state.facts));
      if (state.facts.outcome !== 'improved' && r.todo.some(c => c.onImproved)) err('よくなっていないのに見守りの案内が出た: ' + JSON.stringify(state.facts));
      for (const c of cards) if (shown.has(c.id)) for (const x of c.conflicts || []) if (shown.has(x)) err(`同時に出てはいけない ${c.id} と ${x} が出た: ` + JSON.stringify(state.facts));
      // 同じ行動（key）の案内が、1つの結果に2枚出ないこと
      const keys = r.todo.map(c => c.key).filter(Boolean);
      if (new Set(keys).size !== keys.length) err('同じ行動の案内が2枚出た: ' + keys.join(',') + ' ' + JSON.stringify(state.facts));
      // 選択肢の sets と同じ事実を、あとで聞き直していないこと（自動で進んだ質問は除く）
      for (const h of state.history) if (!h.auto && h.facts[tree.nodes[h.node].fact] !== undefined) err('分かっていることを聞き直す経路: ' + h.node + ' ' + JSON.stringify(state.facts));
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
for (const [name, node] of [['', tree.start], ...Object.entries(tree.entries || {})]) dfs(E.begin(tree, name || undefined));
info.push(`経路数 ${paths} / 最長 ${maxLen} 問（上限 ${tree.maxQuestions}）`);
if (cards.length) info.push(`似た事例が出ない経路 ${noCase}`);

// ---- 4. カード・資料・用語 ----
const allIds = new Set();
for (const c of cards) {
  if (allIds.has(c.id)) err('カードIDの重複: ' + c.id); allIds.add(c.id);
  if (!['do', 'check', 'ifnot', 'dont', 'cause', 'none'].includes(c.section)) err(`${c.id}: section が不正`);
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
  if (c.matchIf) try { E.test(c.matchIf, {}); } catch (e) { err(`事例 ${c.id}: matchIf が不正 ${e.message}`); }
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
  // 空欄のときに出てよいのは、入力のいらない決まった行だけ（中身のない見出しは出さないので、数は減ってよい）
  const fixed = d.body.filter(l => !l.requires?.length).map(l => l.text);
  if (emptyLines.some(t => !fixed.includes(t))) err(`文書 ${d.id}: 空欄なのに入力が必要な行が出る`);
  if (/\{[a-z_]+\}/.test(renderDoc(d, {}))) err(`文書 ${d.id}: 置き換えられていない欄がある`);
  for (const line of d.body) if (!line.requires?.length && /\{/.test(line.text)) err(`文書 ${d.id}: 「${line.text.slice(0, 16)}…」は欄を使うのに requires がない`);
  for (const line of d.body) for (const m of line.text.matchAll(/\{([a-z_]+)\}/g)) {
    if (!d.fields.some(f => f.id === m[1])) err(`文書 ${d.id}: 欄 ${m[1]} が fields にない`);
    if (!(line.requires || []).includes(m[1])) err(`文書 ${d.id}: 「${line.text.slice(0, 16)}…」は ${m[1]} を使うのに requires にない`);
  }
}

// ---- 7. 対応記録の判定：予定（これから・先の日付）を「済んだ」に数えないか ----
const ladder = opt(`data/${domain}/ladder.json`);
if (ladder) {
  const T = '2026-11-11', LATER = '2026-12-01';
  for (const k of ['todo', 'doing', 'answered', 'done']) if (!ladder.states?.[k]) err(`段階: 記録の状況「${k}」の名前がない`);
  const st = ladder.steps.find(s => s.toTypes?.length && !s.methods && !s.showIf);
  if (!st) err('段階: 検査に使える段階がない');
  else {
    const rec = (state, date = T, toName = '') => ({ toType: st.toTypes[0], method: 'phone', state, date, toName });
    const doneOf = recs => ladderState(ladder, {}, recs, T).done.some(s => s.id === st.id);
    if (doneOf([rec('todo')])) err(`段階 ${st.id}: 「これから」の記録で済んだことになる`);
    if (doneOf([rec('doing', LATER)])) err(`段階 ${st.id}: 先の日付の記録で済んだことになる`);
    if (!doneOf([rec('doing')])) err(`段階 ${st.id}: 実際にした記録で済んだことにならない`);
    if (!doneOf([rec('answered')])) err(`段階 ${st.id}: 「回答があった」の記録で済んだことにならない`);
    const rep = recs => ladderState(ladder, {}, recs, T).repeated.length;
    if (rep([rec('todo'), rec('todo')])) err('段階: 予定2件を「繰り返し相談」と数えた');
    if (rep([rec('doing', T, 'A課'), rec('done', T, 'B課')])) err('段階: 別の部署への相談を「繰り返し相談」と数えた');
    if (!rep([rec('doing', T, 'A課'), rec('done', T, 'A 課')])) err('段階: 同じ部署への2回の相談を数えない');
    if (!isPlanned(rec('doing', LATER), T) || isPlanned(rec('done'), T)) err('段階: 予定の判定が違う');
  }
}

// ---- 8. 「声を届ける」の電話・メールのページは、いちばん上が文章づくりの画面。
//         このサイトで作った文章を作り直させないよう、必ず読むところの見出し（section）へ飛ばす ----
// 見出しの名前は「声を届ける」の公開版で確認したもの（2026-11-12）。向こうが変わったら、ここも直す
const CH = ['ch0', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7'];
const TODOKERU_SECTIONS = { phone: ['manual', 'checklist', 'fear-tips', ...CH], email: ['manual', 'checklist', 'call-target', 'mail', 'form', 'post', ...CH] };
const guideLinks = [];
const collectGuide = (o, where) => {
  if (Array.isArray(o)) o.forEach(x => collectGuide(x, where));
  else if (o && typeof o === 'object') { if (o.type === 'todokeru-guide') guideLinks.push([where, o]); Object.values(o).forEach(v => collectGuide(v, where)); }
};
collectGuide(tree, "tree"); cards.forEach(c => collectGuide(c, c.id)); docs.forEach(d => collectGuide(d, d.id)); collectGuide(ladder, "ladder"); collectGuide(opt("data/actions.json"), "actions");
for (const [w, l] of guideLinks) {
  const ok = TODOKERU_SECTIONS[l.guide];
  if (ok && !ok.includes(l.section)) err(`${w}: 声を届けるの ${l.guide} ページへのリンクに、飛び先の見出し（section）がない・知らない名前: ${l.section ?? 'なし'}`);
}
const appSrc = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
for (const m of appSrc.matchAll(/\{[^{}]*type: 'todokeru-guide'[^{}]*\}/g)) {
  const g = m[0].match(/guide: '([^']+)'/)?.[1], s = m[0].match(/section: '([^']+)'/)?.[1];
  if (TODOKERU_SECTIONS[g] && !TODOKERU_SECTIONS[g].includes(s)) err(`js/app.js: 声を届けるの ${g} ページへのリンクに、飛び先の見出しがない: ${m[0].slice(0, 60)}`);
}
// 下書きの中の「ほかの下書きへ」ボタンの行き先と、（共通）の欄の名前
const INFO_KEYS = JSON.parse((appSrc.match(/const INFO = (\[[^\]]*\])/)?.[1] || '[]').replace(/'/g, '"'));
for (const d of docs) {
  for (const l of [...(d.links || []), ...(d.deliver || []).flatMap(g => g.links || [])]) if (l.type === 'doc' && !docs.some(x => x.id === l.doc)) err(`文書 ${d.id}: 行き先の下書き ${l.doc} がない`);
  for (const f of d.fields) if (f.info && !INFO_KEYS.includes(f.info)) err(`文書 ${d.id}: 共通の欄 ${f.info} が js/app.js の INFO にない（保存されない）`);
}

// ---- 出力 ----
const out = [`検査日時 ${TODAY.toISOString()}  分野 ${domain}`, ...info, '', `エラー ${errors.length} 件`, ...errors.slice(0, 200), '', `注意 ${warns.length} 件`, ...warns.slice(0, 200), '', '抜き取り（5000経路ごと）', ...finals.map(f => JSON.stringify(f))];
writeFileSync(path.join(ROOT, 'tools/report.txt'), out.join('\n'));
console.log(info.join('\n'));
console.log(`エラー ${errors.length} 件 / 注意 ${warns.length} 件（詳細: tools/report.txt）`);
errors.slice(0, 8).forEach(e => console.log('  ✗ ' + e));
warns.slice(0, 5).forEach(e => console.log('  △ ' + e));
process.exit(errors.length ? 1 : 0);
