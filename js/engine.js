// 診断エンジン：分野ごとのJSON（tree / cards / checklists / cases）を読んで動く。画面（DOM）には触れない。
// 分野を追加するときは data/<分野>/ にJSONを置くだけで、このファイルは変えない。

export const RESULT = '@result';
export const EMERGENCY = '@emergency';
export const YESNO = [
  { value: 'yes', label: 'はい', short: 'はい' },
  { value: 'no', label: 'いいえ', short: 'いいえ' },
  { value: 'unknown', label: 'わからない', short: 'わからない' }
];

// ---- 条件の判定 ----
// {fact, eq} {fact, ne} {fact, has} {fact, in:[...]} {fact, answered:true} {all:[...]} {any:[...]} {not:{...}}
export function test(cond, facts) {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every(c => test(c, facts));
  if (cond.all) return cond.all.every(c => test(c, facts));
  if (cond.any) return cond.any.some(c => test(c, facts));
  if (cond.not) return !test(cond.not, facts);
  const v = facts[cond.fact];
  if ('answered' in cond) return (v !== undefined) === cond.answered;
  if ('eq' in cond) return v === cond.eq;
  if ('ne' in cond) return v !== cond.ne;
  if ('has' in cond) return Array.isArray(v) ? v.includes(cond.has) : v === cond.has;
  if ('in' in cond) return Array.isArray(v) ? v.some(x => cond.in.includes(x)) : cond.in.includes(v);
  throw new Error('不明な条件: ' + JSON.stringify(cond));
}

// ---- 質問 ----
export function optionsOf(tree, node) {
  if (node.type === 'yesno') return YESNO;
  const base = node.options || tree.optionSets?.[node.optionSet] || [];
  return base.concat(node.extraOptions || []);
}

export function labelOf(tree, nodeId, value) {
  const node = tree.nodes[nodeId];
  const opts = optionsOf(tree, node);
  const one = v => (opts.find(o => o.value === v) || {}).short || v;
  return Array.isArray(value) ? value.map(one).join('・') : one(value);
}

function resolve(next, facts) {
  if (!next) return null;
  if (typeof next === 'string') return next;
  if (Array.isArray(next)) {
    for (const r of next) if (test(r.if, facts)) return r.go;
    return null;
  }
  return null;
}

// 回答後の行き先。選択肢ごとの next が優先、次に yes/no/unknown 別、最後に node.next
export function nextOf(tree, nodeId, value, facts) {
  const node = tree.nodes[nodeId];
  if (node.type === 'choice') {
    const opt = optionsOf(tree, node).find(o => o.value === value);
    if (opt?.next) return resolve(opt.next, facts);
  }
  if (node.type === 'yesno' && node.next && !Array.isArray(node.next) && typeof node.next === 'object') {
    return resolve(node.next[value], facts);
  }
  return resolve(node.next, facts);
}

// 複数選択の「何も分からない」などは、他と同時に選べない
export function normalizeMulti(tree, node, values) {
  const opts = optionsOf(tree, node);
  const ex = values.filter(v => opts.find(o => o.value === v)?.exclusive);
  if (ex.length && values.length > 1) return [ex[ex.length - 1]];
  return values;
}

// ---- 進行（状態は {node, facts, history} の普通のオブジェクト。保存しやすい） ----
// entry：tree.entries の入口名（「次の一手」など）。facts：すでに分かっている答え（記録や前の診断から引き継ぐ）
export function begin(tree, entry, facts = {}) {
  const node = (entry && tree.entries?.[entry]) || tree.start;
  return settle(tree, { node, facts: { ...facts }, history: [] });
}

// すでに答えが分かっている質問は聞かずに進める（auto:true の履歴として残すので、戻れば選び直せる）
function known(tree, node, v) {
  if (v === undefined) return false;
  const opts = optionsOf(tree, node);
  if (node.type === 'multi') return Array.isArray(v) && v.length > 0 && v.every(x => opts.some(o => o.value === x));
  return opts.some(o => o.value === v);
}
export function settle(tree, state) {
  let s = state;
  for (let i = 0; i < 50; i++) {
    const node = tree.nodes[s.node];
    if (!node || !known(tree, node, s.facts[node.fact])) return s;
    const to = nextOf(tree, s.node, s.facts[node.fact], s.facts);
    if (!to) return s;
    s = { node: to, facts: s.facts, history: [...s.history, { node: s.node, facts: s.facts, auto: true }] };
  }
  return s;
}

export function answer(tree, state, value) {
  const node = tree.nodes[state.node];
  if (!node) throw new Error('質問がありません: ' + state.node);
  if (node.type === 'multi') {
    if (!Array.isArray(value) || value.length === 0) throw new Error('選択がありません');
    value = normalizeMulti(tree, node, value);
  } else {
    const ok = optionsOf(tree, node).some(o => o.value === value);
    if (!ok) throw new Error('選択肢にない回答: ' + value);
  }
  // 選択肢の sets：その答えで同時に分かること（例：「問題ないと言われた」→ 結果＝問題ないと回答）
  const opt = node.type === 'multi' ? null : optionsOf(tree, node).find(o => o.value === value);
  const facts = { ...state.facts, ...(opt?.sets || {}), [node.fact]: value };
  const to = nextOf(tree, state.node, value, facts);
  if (!to) throw new Error('行き先がありません: ' + state.node);
  return settle(tree, {
    node: to,
    facts,
    history: [...state.history, { node: state.node, facts: state.facts }]
  });
}

// 戻る：1つ前の質問へ。記録などから引き継いで自動で進んだ質問にも戻れる（引き継いだ答えが違うとき、そこで選び直せる）
export function back(state) {
  if (!state.history.length) return state;
  const h = state.history.slice();
  const prev = h.pop();
  return { node: prev.node, facts: prev.facts, history: h };
}

// 進み具合：この質問から先に、最も多くて何問あるか（ループは検査で禁止しているが念のため打ち切る）
export function maxRemaining(tree, nodeId, seen = new Set()) {
  if (!tree.nodes[nodeId]) return 0;
  if (seen.has(nodeId)) return 0;
  seen.add(nodeId);
  let best = 0;
  for (const t of targetsOf(tree, nodeId)) best = Math.max(best, maxRemaining(tree, t, new Set(seen)));
  return 1 + best;
}

// 質問から出ていく可能性のある行き先をすべて列挙（検査・進み具合用）
export function targetsOf(tree, nodeId) {
  const node = tree.nodes[nodeId];
  const out = new Set();
  const add = n => {
    if (!n) return;
    if (typeof n === 'string') out.add(n);
    else if (Array.isArray(n)) n.forEach(r => out.add(r.go));
    else Object.values(n).forEach(add);
  };
  if (node.type === 'choice') optionsOf(tree, node).forEach(o => add(o.next));
  add(node.next);
  return [...out];
}

// ---- 結果 ----
// ①あなたの状況：答えた順に「見出し：答え」を並べる
export function summarize(tree, state) {
  const order = state.history.map(h => h.node);
  return order.map(id => {
    const n = tree.nodes[id];
    return { label: n.sum, value: labelOf(tree, id, state.facts[n.fact]) };
  });
}

const byPriority = (a, b) => (b.priority || 0) - (a.priority || 0);
// boost: [{if:条件, add:数}] で、状況に応じて表示順を上げ下げする
const prio = (c, facts) => (c.priority || 0) + (c.boost || []).reduce((s, b) => s + (test(b.if, facts) ? b.add : 0), 0);

export function compose(data, facts) {
  const pick = sec => (data.cards || []).filter(c => c.section === sec && test(c.when, facts))
    .map(c => ({ ...c, priority: prio(c, facts) })).sort(byPriority);
  const checklist = (data.checklists || []).filter(i => test(i.when, facts)).sort(byPriority);
  const cases = (data.cases || [])
    .map(c => ({ c, score: caseScore(c, facts) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.c);
  // 「よくなった」と答えた人には、見守りの案内（onImproved）だけを「次にすること」に出し、
  // ほかの相談・要望の案内は「また起きたとき・ほかの困りごとが残るとき」（recur）へ回す
  const all = pick('do');
  const improved = facts.outcome === 'improved';
  const todo = improved ? all.filter(c => c.onImproved) : all.filter(c => !c.onImproved);
  const recur = improved ? all.filter(c => !c.onImproved) : [];
  return { todo, recur, check: pick('check'), checklist, cases, ifnot: pick('ifnot'), dont: pick('dont'), cause: pick('cause'), none: pick('none') };
}

// 事例の近さ：同じ状況（A〜E）なら+2、困りごと・理由・施設の種類・望むことなどのタグが重なるごとに+1
export function caseScore(c, facts) {
  let s = (c.routes || []).includes(facts.situation) ? 2 : 0;
  const tags = new Set([...(facts.problems || []), ...(facts.rule_goal || []), ...(facts.reasons || []), facts.facility, facts.goal].filter(Boolean));
  if (facts.situation === 'C') tags.add('unlicensed');
  if (facts.situation === 'D' || facts.gov_response) tags.add('gov_response');
  if (facts.situation === 'E' || facts.goal === 'rule') tags.add('rule_change');
  if (['same_condo', 'same_rental'].includes(facts.building)) tags.add('mansion');
  for (const t of c.tags || []) if (tags.has(t)) s += 1;
  return s;
}
