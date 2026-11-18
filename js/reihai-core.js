// 礼拝施設の確認チェックリスト：答えから「関係する項目・優先する項目・部署別の質問・相談票・比較表・記録表・次の行動」を組み立てる。
// 画面に触れない（node でも検査できる）。データは data/reihai/checklist.json。
export const KEY = 'kurashi-navi:reihai';
export const DONE = ['ok', 'fixed', 'na'];   // 確かめ終わった状態（優先・質問一覧から外す。違反の数としては数えない）
const ADDR = '〇〇（施設の所在地）';

export function emptyState() {
  return { v: 1, rev: 0, updatedAt: '', ans: {}, info: {}, st: {}, memo: {}, picks: {}, cross: { summary: {}, rows: {}, pit: {} }, log: [] };
}

// 条件：{q, in:[…]}（1つ選ぶ質問）／{q, has:[…]}（いくつでも選ぶ質問のどれか）／{pick, in}（項目で記録した値）／{any}／{all}
export function test(w, s) {
  if (!w) return true;
  if (w.any) return w.any.some(x => test(x, s));
  if (w.all) return w.all.every(x => test(x, s));
  if (w.pick) return (w.in || []).includes(s.picks?.[w.pick]);
  const v = s.ans?.[w.q];
  if (w.in) return w.in.includes(v);
  if (w.has) return Array.isArray(v) && w.has.some(x => v.includes(x));
  return false;
}

export const questionsFor = (D, s) => D.questions.filter(q => test(q.when, s));
export const statusOf = (s, id) => s.st?.[id] || 'todo';
export const statusLabel = (D, v) => (D.statuses.find(x => x.v === v) || D.statuses[0]).label;
export const fill = (t, s) => String(t || '').replaceAll('{addr}', s.info?.addr?.trim() || ADDR);

// 今は表示されない質問（例：「困っていない」に変えたあとの困りごとの質問）の古い答えは、判定に使わない
export function active(D, s) {
  const vis = new Set(questionsFor(D, s).map(q => q.id));
  return { ...s, ans: Object.fromEntries(Object.entries(s.ans || {}).filter(([k]) => vis.has(k))) };
}

// 関係する項目（条件なし＝基本の項目、または条件に合う）と、そのほかの項目
export function relevant(D, s) {
  const a = active(D, s), rel = [], other = [];
  for (const it of D.items) (test(it.when, a) ? rel : other).push(it);
  return { rel, other };
}

// 条件に合った理由（優先の説明に使う）
function reasons(D, it, s) {
  if (!it.when) return ['最初に確かめる基本の項目'];
  const out = [];
  const walk = w => {
    if (w.any || w.all) return (w.any || w.all).forEach(walk);
    if (!test(w, s)) return;
    if (w.pick) { out.push('区域の確認の結果から'); return; }
    const q = D.questions.find(x => x.id === w.q); if (!q) return;
    const v = s.ans[w.q], vs = Array.isArray(v) ? v.filter(x => (w.has || []).includes(x)) : [v];
    vs.forEach(x => { const o = q.options.find(o => o.v === x); if (o) out.push(`「${o.label}」と答えたため`); });
  };
  walk(it.when);
  return [...new Set(out)];
}

// 優先して確かめる項目：関係する項目のうち、確かめ終わっていないもの。今の困りごとに関係する生活環境・通学路の項目を先に
export function priority(D, s0, n = 5) {
  const s = active(D, s0), now = (s.ans.worry || []).includes('now');
  return relevant(D, s).rel
    .filter(it => !DONE.includes(statusOf(s, it.id)))
    .map(it => ({ it, score: it.pri + (now && it.when && ['F', 'G'].includes(it.g) ? 15 : 0) + (statusOf(s, it.id) === 'wait' ? 8 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(({ it }) => ({ it, why: reasons(D, it, s) }));
}

export function counts(D, s) {
  const c = Object.fromEntries(D.statuses.map(x => [x.v, 0]));
  for (const it of relevant(D, s).rel) c[statusOf(s, it.id)]++;
  return c;
}

// 部署別の質問一覧：確かめ終わっていない関係項目の質問文を、相談先ごとにまとめる（運営者へのお願いは、直接連絡しない希望なら外す）
export function byDept(D, s) {
  const noOp = s.ans.contact === 'gov';
  const map = new Map();
  for (const it of relevant(D, s).rel) {
    if (!it.ask || DONE.includes(statusOf(s, it.id))) continue;
    for (const d of it.dept || []) {
      if (d === 'op' && noOp) continue;
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(it);
    }
  }
  const order = Object.keys(D.depts);
  return [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([dept, items]) => ({ dept, name: D.depts[dept], items }));
}

const label = (D, qid, v) => D.questions.find(q => q.id === qid)?.options?.find(o => o.v === v)?.label || '';
const labels = (D, qid, vs) => (vs || []).map(v => label(D, qid, v)).filter(Boolean).join('、');
const day = d => (d ? d.replace(/^(\d{4})-(\d\d)-(\d\d)$/, (_, y, m, dd) => `${+y}年${+m}月${+dd}日`) : '');
const today = () => new Date().toLocaleDateString('sv-SE');
export const REAL = { real: '実際に起きた', worry: 'これからの心配', heard: '人から聞いた・まだ確かめていない' };
export const RESULT = { better: 'よくなった', part: '一部よくなった', same: '変わらない', worse: '悪くなった' };

export const evLine = e => [day(e.date), e.time, e.place && `場所：${e.place}`, e.dur && `続いた時間：${e.dur}`, e.freq && `頻度：${e.freq}`, e.harm && `支障：${e.harm}`, e.mat && `資料：${e.mat}`].filter(Boolean).join('／');

// 1. 優先して確認する項目
export function priorityText(D, s) {
  return ['優先して確かめる項目', ...priority(D, s).map(({ it, why }, i) => `${i + 1}. ${it.t}\n   （${statusLabel(D, statusOf(s, it.id))}。${why.join('・')}）`)].join('\n');
}

// 2. 担当部署別の質問一覧
export function deptText(D, s) {
  const out = ['担当部署別の質問一覧'];
  for (const g of byDept(D, s)) {
    out.push('', `■ ${g.name}`);
    g.items.forEach((it, i) => out.push(`${i + 1}. ${fill(it.ask, s)}`));
  }
  return out.join('\n');
}

// 3. 相談票（部署を選ぶと、その部署あての質問だけを入れる）
export function sheetText(D, s, dept = '', hope = '') {
  const A = active(D, s).ans, I = s.info || {};
  // 一度に出す質問は、優先度の高い順に5つまで（残りは「担当部署別の質問一覧」に出る）
  const all = relevant(D, s).rel.filter(it => it.ask && !DONE.includes(statusOf(s, it.id)) && (!dept || (it.dept || []).includes(dept)) && !(it.dept || []).every(d => d === 'op'))
    .sort((a, b) => b.pri - a.pri);
  const items = all.slice(0, 5), rest = all.length - items.length;
  const ev = k => (s.log || []).filter(e => e.type === 'ev' && e.real === k).map(e => `・${evLine(e)}`);
  const memos = items.map(it => s.memo?.[it.id] && `・${s.memo[it.id]}`).filter(Boolean);
  const crossUsed = Object.values(s.cross?.rows || {}).some(r => r && (r.now || r.rec || r.match));
  const out = [
    `相談票（${day(today())}）`,
    dept ? `あて先：${D.depts[dept]}` : 'あて先：〇〇（担当部署）',
    '',
    '1. 施設について',
    `　所在地：${I.addr || ADDR}`,
    `　名称：${I.name || '（分かれば）'}`,
    I.srcNote ? `　知った経緯：${I.srcNote}` : '',
    `　段階：${label(D, 'stage', A.stage) || '分からない'}／建物：${label(D, 'bldg', A.bldg) || '分からない'}`,
    '',
    '2. 確かめた事実（日時・場所など）',
    ...(ev('real').length || memos.length ? [...ev('real'), ...memos] : ['　（記録表に「実際に起きた」として書いたことが、ここに入ります）']),
    '',
    '3. これからの心配（まだ起きていないこと）',
    ...(ev('worry').length ? ev('worry') : [(A.worry || []).includes('future') ? `　${labels(D, 'trouble', A.trouble) || '今後のこと'}について心配しています。` : '　（なし）']),
    '',
    '4. まだ確かめられていない情報（人から聞いた話など）',
    ...(ev('heard').length ? ev('heard') : ['　（なし）']),
    '',
    '5. 確認していただきたいこと',
    ...(items.length ? items.map((it, i) => `（${i + 1}）${fill(it.ask, s)}`) : ['　（質問文を選んでください）']),
    rest > 0 ? `　※ このほかの質問（${rest}件）は「担当部署別の質問一覧」にあります。必要なものを書き足してください。` : '',
    '',
    '6. お願い',
    `　${D.askClose}`,
    '',
    '7. 添付する資料',
    ...[...new Set((s.log || []).filter(e => e.mat).map(e => `・${e.mat}`))],
    crossUsed ? '・建物の情報の比較表（現況と各制度の記録）' : '',
    '・（登記事項証明書・写真など、添えるものを書き足してください）',
    '',
    '8. 回答について',
    hope ? `　${day(hope)}ごろまでに、文書またはメールでご回答いただけると助かります（希望です）。難しい場合は、途中の状況だけでもお知らせください。` : '　回答の時期の見込みを教えてください。',
    '',
    '相談者：（氏名・連絡先は、提出するときに書き入れてください）'
  ];
  return out.filter(x => x !== '').join('\n').replace(/\n(\d\. )/g, '\n\n$1');
}

// 4. 比較表
export function crossText(D, s) {
  const C = s.cross || {}, M = Object.fromEntries(D.cross.match.map(m => [m.v, m.label]));
  const out = ['建物の情報の比較表（現況と、各制度の記録）', '', '■ 現況（現地・公開資料から）'];
  D.cross.summary.forEach(f => out.push(`　${f.label}：${C.summary?.[f.k] || '—'}`));
  for (const r of D.cross.rows) {
    const v = C.rows?.[r.id] || {};
    out.push('', `■ ${r.label}`,
      `　現況：${v.now || '—'}`, `　この制度の記録：${v.rec || '—'}`, `　一致・不一致・不明：${M[v.match || ''] || 'まだ'}`,
      `　確認先：${v.where || D.depts[r.dept]}`, `　回答：${v.ans || '—'}`, `　次の対応：${v.next || '—'}`);
  }
  out.push('', '※ 制度ごとに用語や分類が違います。記録の違いだけで違反とは決めつけていません。');
  return out.join('\n');
}

// 5. 記録表
export function logText(D, s) {
  const rows = (s.log || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const it = id => D.items.find(x => x.id === id);
  const out = ['相談・回答・改善の記録表'];
  for (const e of rows) {
    const head = `${day(e.date) || '日付なし'}${e.item ? `（${e.item} ${it(e.item)?.t.slice(0, 24) || ''}…）` : ''}`;
    if (e.type === 'ev') out.push('', `【出来事・${REAL[e.real] || ''}】${head}`, `　${evLine(e)}`);
    if (e.type === 'co') out.push('', `【相談・回答】${head}`, `　相手：${e.dept || '—'}　方法：${e.method || '—'}`, `　伝えた・聞いたこと：${e.ask || '—'}`, `　回答：${e.ans || '—'}`, `　次の対応：${e.next || '—'}${e.due ? `（${day(e.due)}ごろ）` : ''}`);
    if (e.type === 'fx') out.push('', `【改善の確認】${head}`, `　様子：${e.what || '—'}　結果：${RESULT[e.result] || '—'}`);
  }
  if (rows.length === 0) out.push('（まだ記録がありません）');
  return out.join('\n');
}

// 6. 回答がない・改善しないときの次の行動
export function nextList(D, s) {
  const resp = (active(D, s).ans.resp || []).filter(v => v !== 'unk');
  const fromResp = D.responses.filter(r => resp.includes(r.id));
  const waiting = relevant(D, s).rel.filter(it => statusOf(s, it.id) === 'wait');
  const overdue = (s.log || []).filter(e => e.type === 'co' && e.due && e.due < today());
  return { fromResp, waiting, overdue, routes: D.routes };
}
export function nextText(D, s) {
  const { fromResp, waiting, overdue, routes } = nextList(D, s);
  const out = ['回答がない・改善しないときの次の行動'];
  if (fromResp.length) {
    out.push('', '■ もらった回答ごとに、次に聞くこと');
    fromResp.forEach(r => out.push(`・${r.said}：${r.ask}`, ...r.then.map(t => `　→ ${t}`)));
  }
  if (overdue.length) { out.push('', '■ 回答の希望日・確かめる時期を過ぎたもの'); overdue.forEach(e => out.push(`・${day(e.due)}：${e.dept || ''} ${e.next || e.ask || ''}`)); }
  if (waiting.length) { out.push('', '■ 改善待ちの項目（時期が来たら様子を記録表で確かめる）'); waiting.forEach(it => out.push(`・${it.t}`, ...(it.next || []).map(t => `　→ ${t}`))); }
  out.push('', '■ 進める方法（目的に合うものを選ぶ）');
  routes.forEach(r => out.push(`・${r.t}`, `　${r.d}`));
  return out.join('\n');
}
