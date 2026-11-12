// 開業前（民泊・旅館業の状況A）の利用ケースのテスト。使い方: node tools/preopen-cases.mjs
// 各ケースで「答え → 結果（今すぐできること3件・ほかの行動・チェックリスト・書類・相談先・解決しなかったら）→ 次の一手」まで進むかを確かめる。
// 実際のブラウザの保存領域は使わない（メモリ上の相談データだけで動かす）。詳細は tools/preopen-report.txt
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../js/engine.js';
import * as N from '../js/rounds.js';
import { renderDoc } from '../js/docs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const load = d => ({ tree: rd(`data/${d}/tree.json`), cards: rd(`data/${d}/cards.json`).cards, checklists: rd(`data/${d}/checklists.json`).items, cases: rd(`data/${d}/cases.json`).cases, docs: rd(`data/${d}/docs.json`).docs });
const M = load('minpaku'), G = load('gyosei');
const plan = M.tree.planLayout;

let ng = 0; const out = [];
const ok = (c, msg) => { if (!c) ng++; out.push(`${c ? 'OK' : 'NG'} ${msg}`); };
const title = c => (Array.isArray(c.title) ? c.title.map(x => x.t || x).join('') : c.title);

function run(name, answers, expect) {
  out.push(`\n=== ${name} ===`);
  let s = E.begin(M.tree);
  for (const a of answers) {
    const node = M.tree.nodes[s.node];
    // 画面に出る選択肢だけで答えられるか
    const opts = E.optionsOf(M.tree, node, s.facts).map(o => o.value);
    for (const v of [].concat(a)) if (!opts.includes(v)) ok(false, `${s.node} に「${v}」の選択肢が出ない`);
    s = E.answer(M.tree, s, a);
  }
  ok(s.node === E.RESULT, `結果まで進む（${s.history.length}問）`);
  const f = s.facts;
  ok(E.test(plan.when, f), '開業前の並べ方（今すぐ3件→ほか→チェック→書類→解決しなかったら）になる');
  const r = E.compose(M, f);
  const top = r.todo.slice(0, plan.top), rest = r.todo.slice(plan.top);
  out.push('今すぐできること: ' + top.map(c => `${c.key}（${title(c)}）`).join(' / '));
  for (const k of expect.top || []) ok(top.some(c => c.key === k), `今すぐできること3件に ${k}`);
  for (const k of expect.notTop || []) ok(!top.some(c => c.key === k), `今すぐできること3件に ${k} がない`);
  // すべての行動に：区分（法令・任意・自主）・分類・具体的な行き先・文例・答えがないとき
  for (const c of r.todo) {
    if (!plan.basis[c.basis]) ok(false, `${c.id} に区分（basis）がない`);
    if (!plan.groups.some(g => g.id === c.group)) ok(false, `${c.id} に分類（group）がない`);
  }
  const groups = plan.groups.filter(g => rest.some(c => c.group === g.id)).map(g => `${g.title}${rest.filter(c => c.group === g.id).length}`);
  out.push('ほかにもできること: ' + groups.join('・'));
  ok(rest.length >= 3, `ほかにもできることが3件以上（${rest.length}件）`);
  // 相談先：役所あての行動には地域の窓口が出る設定、または具体的な行き先
  ok(r.todo.every(c => c.where), 'すべての行動に「どこへ」がある');
  // チェックリスト：状況に合うものだけ
  const cl = r.checklist.map(i => i.id);
  out.push('チェックリスト: ' + cl.join(', '));
  for (const k of expect.checklist || []) ok(cl.includes(k), `チェックリストに ${k}`);
  for (const k of expect.noChecklist || []) ok(!cl.includes(k), `チェックリストに ${k} が出ない`);
  // 書類：行動から作れる書類、と開業前の書類
  const linked = [...new Set(r.todo.flatMap(c => (c.links || []).filter(l => l.type === 'doc').map(l => l.doc)))];
  const docs = [...new Set([...linked, ...M.docs.filter(d => d.when && E.test(d.when, f)).map(d => d.id)])];
  out.push('書類: ' + docs.join(', '));
  for (const d of docs) ok(M.docs.some(x => x.id === d) || G.docs.some(x => x.id === d), `書類 ${d} がある`);
  for (const k of expect.docs || []) ok(docs.slice(0, 4).includes(k) || linked.includes(k), `書類に ${k}`);
  // 解決しなかったら：場面ごとの案内（いちばん合うものが先頭）
  const scenes = r.ifnot.filter(c => c.scene);
  out.push('解決しなかったら: ' + scenes.map(c => c.id).join(', '));
  if (expect.scene) ok(scenes[0]?.id === expect.scene, `解決しなかったらの先頭が ${expect.scene}`);
  // 注意：住民の反対だけで止められないこと、窓の安全
  ok(r.check.some(c => c.id === 'chk_a_limits'), '「住民の反対だけで止められない」の説明が出る');
  ok(r.dont.some(c => c.id === 'dont_a_window'), '窓の制限は安全確認が先、の注意が出る');

  // ---- 次の一手：今すぐの3件を「やることに追加」した前提で、1回目の記録（結果）から次を探す ----
  const file = { id: 't', domain: 'minpaku', state: s, chosen: top.map(c => c.key || c.id), records: expect.record ? [{ id: 'r1', date: '2026-11-01', state: 'answered', ...expect.record }] : [], rounds: [] };
  const round = N.newRound(G.tree, file, 'n1', '2026-11-13');
  let st = round.state;
  for (const a of expect.next || []) { if (st.node === E.RESULT) break; st = E.answer(G.tree, st, a); }
  // 残りの質問は最初の選択肢で答える
  for (let i = 0; i < 12 && st.node !== E.RESULT; i++) { const n = G.tree.nodes[st.node]; const o = E.optionsOf(G.tree, n, st.facts); st = E.answer(G.tree, st, n.type === 'multi' ? [o[0].value] : o[0].value); }
  ok(st.node === E.RESULT, '次の一手の結果まで進む');
  const used = N.usedKeys({ ...file, rounds: [round] }, 'n1');
  const g = E.compose(G, st.facts);
  const { fresh, tried } = N.splitActions(g.todo, used);
  out.push('次の一手: ' + fresh.slice(0, 4).map(c => c.key).join(', ') + (tried.length ? ` ／ 繰り返さない: ${tried.map(c => c.key).join(', ')}` : ''));
  ok(fresh.length > 0 || g.none.length > 0, '次の一手で新しい行動が出る（なければ「残っていない」の案内）');
  ok(!fresh.some(c => file.chosen.includes(c.key)), '最初の結果で選んだ行動を、次の一手で繰り返さない');
  for (const k of expect.nextHas || []) ok(fresh.some(c => c.key === k), `次の一手に ${k}`);
  return { s, r };
}

run('1. 計画を聞いたばかりの住民', ['A', 'heard', 'no', 'unknown', 'house', ['noise', 'gomi'], ['none'], 'info'],
  { top: ['pre_check_status', 'pre_rule_check'], checklist: ['cl_a_status', 'cl_ordinance'], noChecklist: ['cl_a_attend', 'cl_gov'], scene: 'ifn_a_no_meeting', docs: ['gov_check_letter'],
    record: { toType: 'gov', method: 'phone', resultType: 'no_reply' }, nextHas: [] });
run('2. 住民説明会の開催を知った住民', ['A', 'meeting_planned', 'jutaku', 'other_apartment', ['noise', 'security'], ['neighbors'], 'request'],
  { top: ['pre_questions', 'pre_meeting_prep'], checklist: ['cl_a_questions', 'cl_a_attend', 'cl_a_recording'], docs: ['meeting_questions'],
    record: { toType: 'meeting', method: 'letter', resultType: 'no_reply' } });
run('3. 説明会で納得できなかった住民', ['A', 'meeting_done', ['unanswered', 'verbal', 'measures'], 'jutaku', 'house', ['noise', 'gomi', 'traffic'], ['manager'], 'request'],
  { top: ['pre_written_answer', 'pre_agreement', 'pre_measures'], checklist: ['cl_a_written', 'cl_a_agreement'], noChecklist: ['cl_a_attend'], docs: ['meeting_minutes'],
    record: { toType: 'manager', method: 'letter', resultType: 'no_reply' } });
run('4. 建築・消防上の問題を疑っている住民', ['A', 'heard', 'yes', 'ryokan', 'other_apartment', ['safety', 'kids'], ['gov'], 'stop'],
  { top: ['other_route'], notTop: ['pre_check_status'], checklist: ['cl_a_safety'], docs: ['gov_check_letter'],
    record: { toType: 'gov', method: 'phone', resultType: 'no_problem' }, nextHas: [] });
run('5. 署名を集めたい住民', ['A', 'meeting_done', ['plan'], 'unknown', 'house', ['noise'], ['jichikai', 'neighbors'], 'stop'],
  { top: ['pre_signature'], docs: ['signature_sheet'], record: { toType: 'shomei', method: 'letter', resultType: 'no_reply' } });
run('6. 行政に断られた住民（問題ないと言われた）', ['A', 'requested', 'jutaku', 'house', ['noise'], ['gov', 'manager'], 'gov_ok', 'stop'],
  { top: ['ask_basis', 'other_route', 'giin'], notTop: ['pre_check_status'], checklist: ['cl_a_basis'], scene: 'ifn_a_gov_ok', nextHas: [] });
run('6b. 行政に断られた住民（関与できないと言われた）', ['A', 'requested', 'unknown', 'house', ['noise'], ['gov'], 'gov_cannot', 'request'],
  { top: ['find_office', 'giin'], scene: 'ifn_a_gov_ok' });
run('7. 開業阻止が難しく、改善条件を交渉したい住民', ['A', 'requested', 'jutaku', 'same_rental', ['noise', 'gomi'], ['manager', 'gov'], 'opening', 'request'],
  { top: ['pre_measures', 'pre_agreement', 'pre_after_open'], checklist: ['cl_a_agreement'], scene: 'ifn_a_opened', docs: ['operator_request', 'agreement_draft'], nextHas: [] });
run('8. 説明会を開いてくれない住民', ['A', 'requested', 'tokku', 'house', ['noise'], ['manager'], 'no_meeting', 'request'],
  { top: ['pre_rule_check', 'pre_procedure', 'pre_remeeting'], scene: 'ifn_a_no_meeting' });
run('9. 質問に回答がない住民', ['A', 'requested', 'jutaku', 'house', ['noise'], ['manager'], 'no_answer', 'request'],
  { top: ['pre_resend', 'tell_gov'], scene: 'ifn_a_no_answer' });

// ---- 書類：診断の答え（心配ごと）から対策の欄が入り、入力していないことは出ない ----
const opReq = M.docs.find(d => d.id === 'operator_request');
const measures = ['noise', 'gomi'].map(v => opReq.fields.find(x => x.id === 'measures').prefill.map[v]).join('\n');
const txt = renderDoc(opReq, { place: 'A町1丁目', measures });
ok(/騒音/.test(txt) && /ごみ/.test(txt) && !/\{/.test(txt), '改善要求書：心配ごとから対策が入る');
const sig = renderDoc(M.docs.find(d => d.id === 'signature_sheet'), { place: 'A町', purpose: '提出のためだけ', keeper: '代表が保管' });
ok(/利用目的：提出のためだけ/.test(sig) && /保管と処分：代表が保管/.test(sig) && /お名前（自署）/.test(sig), '署名簿：利用目的・保管・自署の欄が出る');

// ---- 古い保存データ（以前の質問の流れ）でも結果が出る ----
const old = { node: E.RESULT, facts: { situation: 'A', building: 'house', notice: 'yes', problems: ['noise'], checked_gov: 'no', goal: 'request' }, history: ['situation', 'a_building', 'a_notice', 'a_worries', 'a_checked', 'a_goal'].map(node => ({ node, facts: {} })) };
let sumOk = true; try { E.summarize(M.tree, old); } catch { sumOk = false; }
ok(sumOk, '以前の流れで保存した答え（a_checked など）を表示できる');
ok(E.compose(M, old.facts).todo.length >= 3, '以前の流れで保存した答えでも、行動が3件以上出る');
const mid = E.answer(M.tree, { node: 'a_checked', facts: { situation: 'A', building: 'house', notice: 'yes', problems: ['noise'] }, history: [] }, 'yes');
ok(mid.node === 'a_goal', '以前の流れの途中（a_checked）から再開できる');

writeFileSync(path.join(ROOT, 'tools/preopen-report.txt'), out.join('\n') + '\n');
const bad = out.filter(l => l.startsWith('NG'));
console.log(bad.join('\n') || '');
console.log(`${out.filter(l => l.startsWith('OK')).length} OK / ${bad.length} NG（詳細: tools/preopen-report.txt）`);
process.exit(ng ? 1 : 0);
