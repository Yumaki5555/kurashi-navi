// 利用者を想定したテスト（ケースA〜K）。使い方: node tools/scenarios.mjs
// 診断の進み方・結果・「次の一手」・保存と復元を、画面を通さずに確かめる。詳細は tools/scenarios-report.txt に保存。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../js/engine.js';
import * as N from '../js/rounds.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const opt = p => (existsSync(path.join(ROOT, p)) ? rd(p) : null);
const DOMAINS = ['minpaku', 'kenchiku', 'gakko', 'gyosei', 'yosan'];

function load(d) {
  const g = n => opt(`data/${d}/${n}.json`);
  return {
    tree: g('tree'), cards: g('cards')?.cards || [], checklists: g('checklists')?.items || [], cases: g('cases')?.cases || [],
    docs: g('docs')?.docs || [], ladder: g('ladder') || { steps: [] }, facts: Object.fromEntries((g('facts')?.facts || []).map(f => [f.id, f]))
  };
}
const D = Object.fromEntries(DOMAINS.map(d => [d, load(d)]));
const NX = D[N.NEXT_DOMAIN];
const PAST = '2026-01-10';

const log = [];
let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++; else fail++;
  log.push(`${cond ? 'OK  ' : 'NG  '}${name}${detail ? ' … ' + detail : ''}`);
}
const titles = cs => cs.map(c => `${c.key || c.id}「${String(c.title).replace(/\[\[|\]\]/g, '')}」`).join(' / ');
const BAD = /違法(です|だ|である)|違反しています|必ず(勝|通|改善)/;
const textOf = cs => JSON.stringify(cs);

// 答えの表（質問ID → 答え）にそって最後まで進める。表にない質問が出たら止める
function run(tree, answers, { entry, facts } = {}) {
  let st = E.begin(tree, entry, facts || {});
  const asked = [];
  for (let i = 0; st.node !== E.RESULT && st.node !== E.EMERGENCY && i < 30; i++) {
    if (!(st.node in answers)) throw new Error(`想定外の質問 ${st.node}（これまで: ${asked.join('→')}）`);
    asked.push(st.node);
    st = E.answer(tree, st, answers[st.node]);
  }
  return { st, asked, autos: st.history.filter(h => h.auto).map(h => h.node) };
}
function result(data, st, used = new Set()) {
  const r = E.compose(data, st.facts);
  const { fresh, tried } = N.splitActions(r.todo, used);
  return { ...r, fresh, tried, top: fresh.slice(0, 3) };
}
const mainFile = (domain, st, extra = {}) => ({ id: 'f1', domain, state: st, done: true, records: [], rounds: [], chosen: [], ...extra });
function section(title, lines) { log.push('', `## ${title}`, ...lines.map(l => '    ' + l)); }

function caseRun(name, fn) {
  try { fn(); } catch (e) { fail++; log.push(`NG  ${name} … 例外: ${e.message}`); }
}

// ---- 0. 引き継ぎ規則（fromDomain / recordMap）の値が、実在する選択肢か ----
caseRun('引き継ぎ規則', () => {
  const optsOf = (tree, fact) => Object.values(tree.nodes).filter(n => n.fact === fact).flatMap(n => E.optionsOf(tree, n).map(o => o.value));
  // markers：質問では聞かず、引き継ぎだけで入れるしるし（例：開業前の相談から来た pre_open）
  const valid = (tree, fact, v) => optsOf(tree, fact).includes(v) || !!tree.markers?.[fact]?.values?.includes(v);
  const conds = c => (c.all || c.any) ? (c.all || c.any).flatMap(conds) : c.not ? conds(c.not) : [c];
  let bad = [];
  for (const r of NX.tree.fromDomain || []) {
    const cs = conds(r.if);
    const fromC = cs.find(c => c.fact === 'from');
    const doms = fromC ? (fromC.in || [fromC.eq]) : DOMAINS.filter(d => d !== N.NEXT_DOMAIN);
    for (const c of cs.filter(c => c.fact !== 'from')) {
      const vals = c.in || [c.eq];
      for (const v of vals) if (!doms.some(d => valid(D[d].tree, c.fact, v))) bad.push(`条件 ${c.fact}=${v}`);
    }
    for (const [f, v] of Object.entries(r.set)) if (!valid(NX.tree, f, v)) bad.push(`設定 ${f}=${v}`);
  }
  const allTypes = new Set([...DOMAINS.flatMap(d => Object.keys(D[d].ladder.recordTypes || {})), ...Object.keys(NX.ladder.commonRecordTypes || {})]);
  const allMethods = new Set(DOMAINS.flatMap(d => Object.keys(D[d].ladder.methods || {})));
  for (const [k, set] of Object.entries(NX.tree.recordMap.toType)) {
    if (!allTypes.has(k)) bad.push(`記録の相手の種類 ${k} がどの分野にもない`);
    for (const [f, v] of Object.entries(set)) if (!valid(NX.tree, f, v)) bad.push(`記録→${f}=${v}`);
  }
  for (const [k, set] of Object.entries(NX.tree.recordMap.method)) {
    if (!allMethods.has(k)) bad.push(`記録の方法 ${k} がどの分野にもない`);
    for (const [f, v] of Object.entries(set)) if (!valid(NX.tree, f, v)) bad.push(`方法→${f}=${v}`);
  }
  ok('引き継ぎ規則の値がすべて実在する選択肢', !bad.length, bad.join(', '));
  const noKey = NX.cards.filter(c => c.section === 'do' && !c.key).map(c => c.id);
  ok('次の一手の案内すべてに「行動の種類」（key）がある', !noKey.length, noKey.join(','));
});

// ---- A. 民泊の騒音（まだ何もしていない） ----
caseRun('A', () => {
  const { st, asked } = run(D.minpaku.tree, { situation: 'B', b_problems: ['noise'], b_ongoing: 'yes', b_building: 'house', b_know: ['sign'], b_sign: 'jutaku', b_done: ['none'] });
  const r = result(D.minpaku, st);
  const c = r.top[0];
  ok('A 結果まで8問以内', asked.length <= 8, `${asked.length}問`);
  ok('A 次にすることが1〜3件出る', r.top.length >= 1);
  ok('A 1件目に「どこへ・確認・持ち物・伝え方」がそろう', !!(c?.where && c?.check && c?.bring?.length && c?.script));
  ok('A 管理者への連絡が最初の候補に入る', r.top.some(x => x.id === 'do_contact_manager'), titles(r.top));
  ok('A 断定的な表現がない', !BAD.test(textOf([...r.todo, ...r.check])));
  section('A 民泊の騒音（何もしていない）', [`質問: ${asked.join(' → ')}`, `次にすること: ${titles(r.top)}`]);
});

// ---- B. 民泊で管理者に連絡したが改善しない ----
caseRun('B', () => {
  const { st } = run(D.minpaku.tree, { situation: 'B', b_problems: ['noise'], b_ongoing: 'yes', b_building: 'house', b_know: ['sign', 'contact'], b_sign: 'unknown', b_done: ['manager'], b_outcome: 'same' });
  const r = result(D.minpaku, st);
  ok('B 管理者への連絡を繰り返させない', !r.todo.some(x => x.id === 'do_contact_manager'), titles(r.top));
  // 管理者に電話した記録から「次の一手」を始める
  const file = mainFile('minpaku', st, { records: [{ id: 'r1', date: PAST, toType: 'manager', method: 'phone', state: 'doing' }] });
  const r1 = N.newRound(NX.tree, file, 'n1');
  const run1 = run(NX.tree, { result_party: 'same', facts_ready: 'no', ongoing: 'yes' }, { entry: 'next', facts: r1.state.facts });
  ok('B 記録から「したこと・相手」を引き継ぎ、聞き直さない', run1.asked[0] === 'result_party' && run1.autos.includes('next_did') && run1.autos.includes('target'), `質問: ${run1.asked.join('→')}`);
  const res1 = result(NX, run1.st, N.usedKeys(file, 'n1'));
  ok('B 見立て：相手方に言っても変わらない', res1.cause.some(x => x.id === 'cause_party'), titles(res1.cause));
  ok('B 行政の窓口に事実を伝える案内が出る', res1.top.some(x => x.key === 'tell_gov'), titles(res1.top));
  // 1回目で「行政に伝える」を選んだあと、2回目では同じ提案をしない
  file.rounds = [{ ...r1, state: run1.st, done: true, chosen: ['tell_gov'] }];
  file.records.push({ id: 'r2', date: PAST, toType: 'gov', method: 'phone', state: 'doing', actionKey: 'tell_gov', round: 'n1' });
  const r2 = N.newRound(NX.tree, file, 'n2');
  ok('B 2回目は新しい記録（行政に電話）から始まる', r2.state.facts.target === 'gov' && r2.state.facts.did === 'phone', JSON.stringify(r2.state.facts));
  const run2 = run(NX.tree, { result: 'will_do_nochange', reason_given: 'no', deadline_set: 'no', in_writing: 'no', facts_ready: 'yes', ongoing: 'yes' }, { entry: 'next', facts: r2.state.facts });
  const res2 = result(NX, run2.st, N.usedKeys(file, 'n2'));
  ok('B 2回目に「行政に伝える」を再提案しない', !res2.fresh.some(x => x.key === 'tell_gov') && N.usedKeys(file, 'n2').has('tell_gov'), titles(res2.top));
  ok('B 2回目も次の手段がある', res2.top.length > 0, titles(res2.top));
  section('B 民泊：管理者に連絡したが改善しない', [`最初の結果: ${titles(r.top)}`, `次の一手1回目: ${titles(res1.top)}`, `次の一手2回目: ${titles(res2.top)}（試したこと: ${titles(res2.tried)}）`]);
});

// ---- C. 近所に宗教施設が建設されるらしい ----
caseRun('C', () => {
  const { st, asked } = run(D.kenchiku.tree, { situation: 'A', a_facility: 'religious', a_stage: 'rumor', a_worries: ['traffic', 'crowd'], a_checked: 'no', a_goal: 'info' });
  const r = result(D.kenchiku, st);
  const all = textOf([...r.todo, ...r.check, ...r.checklist, ...r.dont]);
  ok('C 計画の確認（標識・概要書など）へ案内', /標識|概要書|計画/.test(textOf(r.top)), titles(r.top));
  ok('C 土地利用（用途地域など）の確認がある', /用途地域/.test(all));
  ok('C 違法と早合点しない', !BAD.test(all));
  ok('C 信仰を理由にした排除を戒める', /信仰|宗教/.test(textOf(r.dont)) || /信仰|宗教/.test(textOf(r.check)), titles(r.dont));
  ok('C チェックリストに確かめ方がある', r.checklist.length > 0 && r.checklist.every(i => i.how || i.ask), r.checklist.filter(i => !(i.how || i.ask)).map(i => i.id).join(','));
  section('C 宗教施設の建設計画（うわさ）', [`質問: ${asked.join(' → ')}`, `次にすること: ${titles(r.top)}`, `注意: ${titles(r.dont)}`]);
});

// ---- D. 建設について役所に聞いたが「問題ない」と言われた ----
caseRun('D', () => {
  const { st } = run(D.kenchiku.tree, { situation: 'D', d_where: 'kenchiku_dept', d_method: 'phone', d_response: 'legal_ok', d_recorded: 'no', d_problems: ['traffic'], d_facility: 'religious' });
  const r = result(D.kenchiku, st);
  ok('D 最初の結果で「何に基づく回答か」を確かめる案内', /根拠|何の|どの法令|基準/.test(textOf(r.top)), titles(r.top));
  const file = mainFile('kenchiku', st);
  const rr = N.newRound(NX.tree, file, 'n1');
  const x = run(NX.tree, { basis_known: 'no', concern_specific: 'no', in_writing: 'no', facts_ready: 'no', ongoing: 'yes' }, { entry: 'next', facts: rr.state.facts });
  ok('D 診断の答え（役所に電話・問題ないと言われた）を引き継ぐ', x.asked[0] === 'basis_known', `質問: ${x.asked.join('→')} / 引き継ぎ: ${x.autos.join(',')}`);
  const res = result(NX, x.st, N.usedKeys(file, 'n1'));
  ok('D 回答の根拠を確かめる案内が上位', res.top.some(c => c.key === 'ask_basis'), titles(res.top));
  ok('D 見立てが出る', res.cause.length > 0, titles(res.cause));
  // 戻るで、引き継いだ質問まで戻って選び直せる
  const b1 = E.back(rr.state), b2 = E.back(b1), b3 = E.back(b2);
  ok('D 「戻る」で引き継いだ答えも1つずつ選び直せる', rr.state.node === 'basis_known' && b1.node === 'result' && b2.node === 'target' && b3.node === 'next_did' && b3.facts.did === 'phone', `${rr.state.node}→${b1.node}→${b2.node}→${b3.node}`);
  const c2 = E.answer(NX.tree, b2, 'school');
  ok('D 引き継いだ相手を選び直すと、その答えで進む', c2.facts.target === 'school' && c2.node === 'basis_known', `${c2.node}`);
  section('D 役所に「問題ない」と言われた', [`最初の結果: ${titles(r.top)}`, `次の一手: 見立て ${titles(res.cause)} / ${titles(res.top)}`]);
});

// ---- E. 学校教育の改善を求める請願が不採択 ----
caseRun('E', () => {
  const { st, asked } = run(D.gakko.tree, { situation: 'H', h_topic: 'japanese' });
  ok('E 「請願が通らなかった」はテーマだけ聞いて次の一手へ', asked.length === 2 && E.test(D.gakko.tree.startNextIf, st.facts));
  const file = mainFile('gakko', st);
  const rr = N.newRound(NX.tree, file, 'n1');
  const x = run(NX.tree, { pet_result: 'rejected', minutes_checked: 'no', reason_known: 'no', new_material: 'no', request_scope: 'no', ongoing: 'yes' }, { entry: 'next', facts: rr.state.facts });
  ok('E 「したこと＝請願」を聞き直さない', x.asked[0] === 'pet_result', x.asked.join('→'));
  const res = result(NX, x.st);
  const all = textOf([...res.todo, ...res.cause, ...res.check]);
  ok('E 審査の経過（議事録）を確かめる案内が上位', res.top.some(c => c.key === 'check_minutes'), titles(res.top));
  ok('E 不採択に審査請求を勧めない', !res.todo.some(c => c.key === 'appeal_disclosure'));
  ok('E 不採択≠違法・審査請求の対象外を説明', /不服申立て|審査請求/.test(all) && /違法/.test(all) === /違法ではない|違法とは限らない|違法性|違法かどうか|違法の疑い/.test(all));
  ok('E 再提出を最初に勧めない', res.top[0]?.key !== 'resubmit_check', titles(res.top));
  ok('E 個人情報を求めない注意がある', res.dont.some(d => d.id === 'dont_personal'), titles(res.dont));
  section('E 請願が不採択', [`見立て: ${titles(res.cause)}`, `次にすること: ${titles(res.top)}`, `そのほか: ${titles(res.fresh.slice(3))}`]);
});

// ---- F. 情報公開請求で不開示決定 ----
caseRun('F', () => {
  const x = run(NX.tree, { situation: 'info', dis_state: 'nondisclosed', reason_understood: 'no', kyouji: 'yes', within_period: 'yes' });
  const res = result(NX, x.st);
  ok('F 不開示の理由を確かめる案内', res.todo.some(c => c.id === 'do_nondisclosure_reason'), titles(res.top));
  ok('F 審査請求の案内（教示・期間を確認）', res.todo.some(c => c.key === 'appeal_disclosure'));
  ok('F 問い合わせ用の案内（根拠を聞く電話など）と混ぜない', !res.top.some(c => ['ask_basis', 'ask_reason'].includes(c.key)), titles(res.top));
  ok('F 期限を断定しない（教示で確認）', /教示/.test(textOf([...res.todo, ...res.check])));
  const y = run(NX.tree, { situation: 'info', dis_state: 'nondisclosed', reason_understood: 'yes', kyouji: 'no' });
  const res2 = result(NX, y.st);
  ok('F 教示がないときは教示を確かめる案内', res2.todo.some(c => c.key === 'ask_kyouji'), titles(res2.top));
  // 不存在の決定には「どの規定に当たるか」ではなく「文書がない理由」を聞く
  const w = run(NX.tree, { situation: 'info', dis_state: 'not_exist', absent_reason: 'no', kyouji: 'yes', within_period: 'yes' });
  ok('F 不存在では「文書がない理由」を聞く', w.asked.includes('absent_reason') && !w.asked.includes('reason_understood'), w.asked.join('→'));
  const res4 = result(NX, w.st);
  ok('F 不存在では「ない理由」を確かめる案内（不開示の規定の案内は出さない）', res4.todo.some(c => c.key === 'absent_reason') && !res4.todo.some(c => c.key === 'nondisclosure_reason'), titles(res4.top));
  const z = run(NX.tree, { situation: 'info', dis_state: 'phone_refused', which_body: 'unknown', doc_specific: 'no' });
  const res3 = result(NX, z.st);
  ok('F 電話で断られた＝正式な決定ではないと区別', res3.todo.some(c => c.key === 'formal_request' || c.key === 'disclosure') && !res3.todo.some(c => c.key === 'appeal_disclosure'), titles(res3.top));
  section('F 情報公開：不開示決定', [`理由不明・教示あり: ${titles(res.top)}`, `教示なし: ${titles(res2.top)}`, `電話で断られた: ${titles(res3.top)}`]);
});

// ---- G. 「わからない」を何度も選ぶ ----
caseRun('G', () => {
  const pick = (tree, node) => {
    const vs = E.optionsOf(tree, node).map(o => o.value);
    const v = ['unknown', 'unsure', 'undecided'].find(x => vs.includes(x)) || vs[0];
    return node.type === 'multi' ? [v] : v;
  };
  for (const d of DOMAINS) {
    const tree = D[d].tree;
    for (const first of E.optionsOf(tree, tree.nodes[tree.start]).map(o => o.value)) {
      let st = E.answer(tree, E.begin(tree), first), n = 1;
      while (st.node !== E.RESULT && st.node !== E.EMERGENCY && n < 30) { st = E.answer(tree, st, pick(tree, tree.nodes[st.node])); n++; }
      const r = st.node === E.RESULT ? result(D[d], st) : null;
      const startsNext = E.test(tree.startNextIf, st.facts);
      ok(`G ${d}/${first} わからないでも結果に届き、次にすることが出る`, startsNext || (r && r.top.length > 0 && r.top.every(c => c.where)), r ? titles(r.top.slice(0, 1)) : st.node);
    }
  }
  // 次の一手でも「わからない」だけで進める
  const x = run(NX.tree, { next_did: 'none', want: 'unsure' }, { entry: 'next' });
  const res = result(NX, x.st);
  ok('G 次の一手：何をしたいか分からなくても行き止まらない', res.top.length > 0, titles(res.top));
  ok('G 次の一手（分野なし）：分野を選び直す案内が出る', res.todo.some(c => c.id === 'do_category') && !res.todo.some(c => c.id === 'do_back_main'), titles(res.top));
  // 分野の相談（例：民泊）の続きでは、分野を選び直させず、その相談の最初の案内へ戻す
  for (const d of DOMAINS.filter(x => x !== 'gyosei')) {
    const y = run(NX.tree, { next_did: 'none', want: 'unsure' }, { entry: 'next', facts: { from: d } });
    const r2 = result(NX, y.st);
    ok(`G 次の一手（${d}の相談）：分野選びに戻さず、最初の案内へ戻す`, !r2.todo.some(c => c.id === 'do_category') && r2.top[0]?.id === 'do_back_main', titles(r2.top));
  }
});

// ---- H. 途中で閉じて再開（保存と復元） ----
{
  const mem = new Map();
  globalThis.window = { localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; } } };
  const S = await import('../js/store.js');
  try {
    const tree = D.minpaku.tree;
    let st = E.begin(tree);
    st = E.answer(tree, st, 'B'); st = E.answer(tree, st, ['noise']);
    const f = S.createFile('minpaku', st);
    f.records = [{ id: 'r1', date: PAST, toType: 'manager', method: 'phone', content: '騒音を伝えた', state: 'doing' }];
    f.rounds = [N.newRound(NX.tree, { ...f, state: { ...st, node: E.RESULT } }, 'n1')];
    f.chosen = ['tell_gov'];
    S.putFile(f);
    const before = JSON.stringify(S.getFile(f.id));
    // 「閉じて開き直す」：画面の一時保存を使わず、端末の保存場所から読み直す
    const again = JSON.parse(mem.get(S.PREFIX + 'files')).files.find(x => x.id === f.id);
    ok('H 途中の答え（今いる質問）が残る', again.state.node === st.node && again.state.history.length === 2);
    ok('H 対応の記録・次の一手の回・選んだ行動が残る', again.records.length === 1 && again.rounds.length === 1 && again.chosen[0] === 'tell_gov');
    const bak = S.backupText();
    S.clearAll();
    ok('H 削除でこのサイトの保存だけが消える', !mem.has(S.PREFIX + 'files'));
    const plan = S.planRestore(bak);
    S.applyRestore(plan);
    const norev = x => { const { rev, ...o } = JSON.parse(x); return JSON.stringify(o); };
    ok('H バックアップから戻すと元どおり', plan.add.length === 1 && norev(JSON.stringify(S.getFile(f.id))) === norev(before));
    mem.set('other-site:keep', '1'); S.clearAll();
    ok('H ほかのサイトの保存は消さない', mem.get('other-site:keep') === '1');
  } catch (e) { fail++; log.push(`NG  H … 例外: ${e.message}`); }
}

// ---- I. 使える次の手段がない ----
caseRun('I', () => {
  const allKeys = [...new Set(NX.cards.filter(c => c.key).map(c => c.key))];
  // 次の一手の全経路で、すべての行動を試したことにする
  let paths = 0, noNone = [];
  const walk = st => {
    if (st.node === E.RESULT) {
      paths++;
      const r = result(NX, st, new Set(allKeys));
      if (r.fresh.length) noNone.push(titles(r.fresh));
      else if (!r.none.length) noNone.push(st.history.map(h => h.node).join('→'));
      return;
    }
    if (st.node === E.EMERGENCY) return;
    const node = NX.tree.nodes[st.node];
    const vs = E.optionsOf(NX.tree, node).map(o => o.value);
    for (const v of node.type === 'multi' ? vs.map(x => [x]) : vs) walk(E.answer(NX.tree, st, v));
  };
  walk(E.begin(NX.tree, 'next'));
  walk(E.begin(NX.tree));
  const none = NX.cards.filter(c => c.section === 'none');
  ok('I すべて試したら、全経路で「根拠のある手段が残っていない」と伝える', !noNone.length, `${paths}経路 ${noNone.slice(0, 3).join(' | ')}`);
  ok('I その案内に架空の手続き・同じ問い合わせの繰り返しを入れない', none.every(c => !/もう一度(電話|問い合わせ)|再度(電話|問い合わせ)/.test(textOf(c)) && !(c.links || []).some(l => l.type === 'url')), titles(none));
  section('I 次の手段がない', [`全${paths}経路で確認。表示: ${titles(none)}`]);
});

// ---- J. 自治体の条例データが未確認 ----
caseRun('J', () => {
  const focus = rd('data/regions/focus.json');
  const verified = (focus.areas || []).filter(a => a.status === 'verified');
  ok('J 確認済みの地域は、出典つきのルールだけ', verified.every(a => a.checked && a.rules.every(x => x.summary) ), `${verified.length}地域`);
  const unknownCode = '01100';
  ok('J 未確認の地域には、ほかの地域のルールを出さない', !verified.some(a => a.code === unknownCode));
  // 画面側（app.js）の分岐：民泊以外の分野は地域のルールを出さず「要確認」と表示する
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  ok('J 画面：民泊以外の分野は「要確認」と表示', /cur\.file\.domain !== 'minpaku'[\s\S]{0,300}要確認/.test(app));
  ok('J 画面：未確認の民泊の地域も「要確認」と表示', /if \(!area\) info \+=[\s\S]{0,120}要確認/.test(app));
});

// ---- K. 次の一手の答えを記録にする／分野ごとの呼び方 ----
caseRun('K', () => {
  const L = { toType: D.minpaku.ladder.recordTypes, method: D.minpaku.ladder.methods, result: Object.fromEntries(E.optionsOf(NX.tree, NX.tree.nodes.result, {}).map(o => [o.value, o.short])) };
  const v = N.recordFromRound(NX.tree, { did: 'phone', target: 'gov', result: 'no_problem' }, L);
  ok('K 電話・役所・問題ない → 担当課・電話・問題ないと回答', v?.toType === 'gov' && v.method === 'phone' && v.resultType === 'no_problem', JSON.stringify(v));
  const p = N.recordFromRound(NX.tree, { did: 'owner', target: 'party', result: 'refused' }, L);
  ok('K 管理組合に伝えた・断られた → 管理組合など・対応できない', p?.toType === 'owner_side' && p.resultType === 'cannot', JSON.stringify(p));
  ok('K 何もしていなければ記録にしない', N.recordFromRound(NX.tree, { did: 'none' }, L) === null);
  const st = run(D.minpaku.tree, { situation: 'B', b_problems: ['noise'], b_ongoing: 'yes', b_building: 'house', b_know: ['contact'], b_done: ['manager'], b_outcome: 'same' }).st;
  const rec = { id: 'a', date: PAST, toType: 'gov', method: 'phone', resultType: 'no_problem', state: 'answered', auto: true };
  ok('K 自動で入れた記録は、次の回の答えに使わない', N.prefill(NX.tree, mainFile('minpaku', st, { records: [rec], rounds: [{ id: 'r1' }] })).did === undefined);
  const lab = (id, from) => E.optionsOf(NX.tree, NX.tree.nodes[id], { from }).map(o => o.label).join('／');
  ok('K 民泊の流れでは「建築主」を出さない', !/建築主/.test(lab('next_did', 'minpaku') + lab('target', 'minpaku')) && /建築主/.test(lab('target', 'kenchiku')));
});

const head = `ケースA〜K：OK ${pass} / NG ${fail}`;
writeFileSync(path.join(ROOT, 'tools/scenarios-report.txt'), [head, '', ...log].join('\n') + '\n');
console.log(head + '（詳細: tools/scenarios-report.txt）');
for (const l of log.filter(l => l.startsWith('NG'))) console.log(l);
process.exitCode = fail ? 1 : 0;
