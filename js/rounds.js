// 「次の一手」：同じ相談（ファイル）の中に、行動の結果ごとの診断（round）を積み上げる。画面には触れない。
// 診断データは「役所の対応」（data/gyosei）を共通で使い、入口 next から始める。
import * as E from './engine.js';
import { isPlanned } from './records.js';

export const NEXT_DOMAIN = 'gyosei';
const localToday = () => new Date().toLocaleDateString('sv-SE');

// 実際にした記録のうち、いちばん新しいもの（同じ日付なら後に書いたもの）
export function latestDone(records = [], today = localToday()) {
  let best = null, bi = -1;
  records.forEach((r, i) => {
    if (isPlanned(r, today)) return;
    if (!best || (r.date || '') > (best.date || '') || ((r.date || '') === (best.date || '') && i > bi)) { best = r; bi = i; }
  });
  return best;
}

// 記録から分かること（相手の種類 → 相手・したこと、方法 → したこと、相手の回答の種類 → 結果）
export function factsFromRecord(tree, rec) {
  if (!rec) return {};
  const m = tree.recordMap || {};
  const byType = m.toType?.[rec.toType] || {};
  const out = { ...byType };
  if (!out.did && out.target && m.method?.[rec.method]) Object.assign(out, m.method[rec.method]);
  // 相手の回答の種類：相手方（事業者など）への記録は、相手方の結果の選択肢に読み替える
  if (rec.resultType && out.target) {
    const v = out.target === 'party' ? m.partyResult?.[rec.resultType] : rec.resultType;
    if (v) out.result = v;
  }
  return out;
}

// 分野の診断の答えから分かること（tree.fromDomain の規則）。
// first：1回目で記録がまだないとき。そうでなければ always の規則（いつでも同じ答えになるもの）だけを使う
export function factsFromDomain(tree, domain, facts = {}, first = true) {
  const f = { ...facts, from: domain };
  const out = {};
  for (const r of tree.fromDomain || []) if ((first || r.always) && E.test(r.if, f)) Object.assign(out, r.set);
  return out;
}

// 新しい「次の一手」に最初から入れておく答え。
// 分野の診断から：変わらない事実（建物・困りごと・したこと。tree.carry）はいつも引き継ぐ。
// 1回目で、まだ実際の記録がなければ、相談の結果なども分野の診断の答えから。記録があれば、いちばん新しい記録から。
// 次の一手の答えから自動で作った記録（auto）は使わない（その回の答えそのものなので、次の回で同じ答えを聞かずに進めないため）
export function prefill(tree, file, today = localToday()) {
  const f = { from: file.domain };
  const rec = latestDone((file.records || []).filter(r => !r.auto), today);
  const first = !(file.rounds || []).length;
  const main = file.domain !== NEXT_DOMAIN && file.state?.node === E.RESULT ? file.state.facts : null;
  if (main) {
    for (const k of tree.carry || []) if (main[k] !== undefined) f[k] = main[k];
    Object.assign(f, factsFromDomain(tree, file.domain, main, first && !rec));
  }
  if (rec) Object.assign(f, factsFromRecord(tree, rec));
  return f;
}

// 答えの印（聞くけれど、前の診断の答えに合う選択肢を選んだ状態にしておく）：tree.hints[質問ID] = {fact, map}
export function hintsFor(tree, nodeId, facts) {
  const h = tree.hints?.[nodeId];
  if (!h) return [];
  const v = facts[h.fact];
  return [...new Set((Array.isArray(v) ? v : [v]).map(x => h.map[x]).filter(Boolean))];
}

export function newRound(tree, file, id, today = localToday()) {
  const facts = prefill(tree, file, today);
  return { id, createdAt: new Date().toISOString(), state: E.begin(tree, 'next', facts), done: false, chosen: [] };
}

// 再提案しない行動：この回より前の回（最初の診断＝main を含む）で選んだ行動と、この回以外で記録した行動
export function usedKeys(file, roundId) {
  const rounds = file.rounds || [];
  const idx = roundId === 'main' ? -1 : rounds.findIndex(r => r.id === roundId);
  const used = new Set();
  if (idx >= 0) for (const k of file.chosen || []) used.add(k);
  rounds.slice(0, Math.max(idx, 0)).forEach(r => (r.chosen || []).forEach(k => used.add(k)));
  for (const r of file.records || []) if (r.actionKey && r.round !== roundId) used.add(r.actionKey);
  return used;
}

// 案内を「まだ試していない」と「試した・選んだ」に分ける。key のない案内（分野の案内）はそのまま
export function splitActions(todo, used) {
  const fresh = [], tried = [];
  for (const c of todo) (c.key && used.has(c.key) ? tried : fresh).push(c);
  return { fresh, tried };
}

// 次の一手の答え（最後にしたこと・相手・結果）を、対応の記録の形（相手の種類・方法・相手の回答の種類）にする。
// recordMap の逆。labels（記録の選択肢）にないものは使わない。何もしていなければ null
const PREFER_DID = { owner: ['owner_side'] };
const PREFER_TARGET = { party: ['manager', 'owner', 'builder', 'corp', 'party'], school: ['school', 'school_lead', 'teacher'], other: ['other'] };
const PARTY_TO_RESULT = { refused: 'cannot' };
export function recordFromRound(tree, facts, labels) {
  if (!facts.did || facts.did === 'none') return null;
  const m = tree.recordMap?.toType || {}, mm = tree.recordMap?.method || {};
  const byDid = Object.keys(m).filter(k => m[k].did === facts.did);
  const byTarget = Object.keys(m).filter(k => !m[k].did && m[k].target === facts.target);
  const toType = [...(PREFER_DID[facts.did] || []), ...byDid, ...(PREFER_TARGET[facts.target] || []), ...byTarget, 'other'].find(k => k in labels.toType);
  if (!toType) return null;
  const method = Object.keys(mm).find(k => mm[k].did === facts.did && k in labels.method) || '';
  const rt = facts.target === 'party' ? PARTY_TO_RESULT[facts.result] || facts.result : facts.result;
  return { toType, method, resultType: rt in labels.result ? rt : '' };
}

// 案内カードの記録の「相手の種類」：カードの recType のうち、その分野の記録に使えるもの。
// recType のない分野の案内は、題名の言葉から推し量る（当てはまらなければ「その他」）
const GUESS = [[/警察/, ['police']], [/議員/, ['giin']], [/情報公開/, ['disclosure']], [/請願|陳情/, ['petition']], [/意見募集|パブリック/, ['pubcome']],
  [/弁護士|法テラス/, ['lawyer']], [/教育委員会/, ['board']], [/担任/, ['teacher']], [/校長|学校/, ['school_lead', 'school']], [/管理者|運営者/, ['manager', 'owner_side']],
  [/建築主|事業者/, ['owner', 'builder', 'owner_side']], [/自治体|役所|窓口|担当課|保健所/, ['gov']]];
export function recTypeFor(card, labels) {
  const t = (card.recType || []).find(x => labels[x]);
  if (t) return t;
  for (const [re, ts] of GUESS) if (re.test(String(card.title || ''))) { const g = ts.find(x => labels[x]); if (g) return g; }
  return labels.other ? 'other' : Object.keys(labels)[0] || 'other';
}
