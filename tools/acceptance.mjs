// 受け入れテスト（2026-11-12 改修分）。使い方: node tools/acceptance.mjs
// 画面を通さずに、答えと提案の一致・保存データを守る仕組み（壊れたデータ・旧形式・複数タブ・削除・復元）を確かめる。
// 保存のテストは、このプログラムの中だけの仮の保存場所を使う（ブラウザの保存データには触れない）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../js/engine.js';
import * as N from '../js/rounds.js';
import { fillText } from '../js/docs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const load = d => ({ tree: rd(`data/${d}/tree.json`), cards: rd(`data/${d}/cards.json`).cards, checklists: [], cases: [] });
const D = { minpaku: load('minpaku'), gakko: load('gakko'), gyosei: load('gyosei') };
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'OK ' : 'NG '} ${name}${!cond && detail ? ' … ' + detail : ''}`); };
const run = (tree, ans, opt = {}) => {
  let st = E.begin(tree, opt.entry, opt.facts || {});
  for (let i = 0; st.node !== E.RESULT && i < 30; i++) {
    if (!(st.node in ans)) throw new Error('想定外の質問 ' + st.node);
    st = E.answer(tree, st, ans[st.node]);
  }
  return st;
};
const plainT = (c, f) => fillText(c.title, f).replace(/\[\[|\]\]/g, '');
const todo = (data, f) => E.compose(data, f).todo;

// ---- 1. 大田区・営業中の民泊・騒音とごみ・標識（届出）・管理者に連絡済み・改善なし ----
{
  const st = run(D.minpaku.tree, { situation: 'B', b_problems: ['noise', 'gomi'], b_ongoing: 'yes', b_building: 'house', b_know: ['sign'], b_sign: 'jutaku', b_done: ['manager'], b_outcome: 'same' });
  const f = st.facts, cs = E.compose(D.minpaku, f);
  const all = [...cs.todo, ...cs.check];
  ok('1 選んでいない「迷惑駐車」が見出しに出ない', !all.some(c => /迷惑駐車/.test(plainT(c, f))), all.map(c => plainT(c, f)).join(' / '));
  const pol = cs.todo.find(c => c.id === 'do_police');
  ok('1 警察の案内は「騒ぎ」だけを書く', pol && plainT(pol, f) === 'その場で騒ぎが続くときは、警察に相談する', pol && plainT(pol, f));
  ok('1 管理者への連絡を繰り返させない', !cs.todo.some(c => c.id === 'do_contact_manager'));
  ok('1 届出の民泊とわかったときだけ「苦情対応の義務」', cs.check.some(c => c.id === 'chk_complaint_duty'));
  ok('1 標識で種類がわかった人に「種類を確かめる」を出さない', !cs.todo.some(c => c.id === 'do_check_type'));
  const ota = rd('data/regions/focus.json').areas.find(a => a.code === '131113');
  ok('1 大田区の窓口（名称・電話・公式URL・確認日）がある', ota?.status === 'verified' && ota.contacts.some(x => x.tel && x.url && x.handles.includes('jutaku')) && !!ota.checked);
  ok('1 大田区の特区民泊の制度も載せる', ota.rules.some(r => r.system === 'tokku'));
}
// ---- 2. 同じ条件で、標識の種類がわからない ----
{
  const st = run(D.minpaku.tree, { situation: 'B', b_problems: ['noise', 'gomi'], b_ongoing: 'yes', b_building: 'house', b_know: ['sign'], b_sign: 'unknown', b_done: ['manager'], b_outcome: 'same' });
  const f = st.facts, cs = E.compose(D.minpaku, f);
  const ct = cs.todo.find(c => c.id === 'do_check_type');
  ok('2 届出民泊と決めつけない（苦情対応の義務を出さない）', !cs.check.some(c => c.id === 'chk_complaint_duty'));
  ok('2 種類を確かめる案内が出る', !!ct);
  const where = fillText(ct.where, f), check = fillText(ct.check, f);
  ok('2 標識を見た人に「標識を探す」から始めない', !/建物の外から見える玄関などの/.test(where) && /控える/.test(where), where);
  ok('2 標識の記載を窓口に伝えて確かめる案内', /窓口に伝えて/.test(check), check);
}
// ---- 3. 民泊・まだ何もしていない：記録 → 窓口 → 文例の順 ----
{
  const st = run(D.minpaku.tree, { situation: 'B', b_problems: ['noise'], b_ongoing: 'yes', b_building: 'house', b_know: ['contact'], b_done: ['none'] });
  const t = todo(D.minpaku, st.facts);
  const iRec = t.findIndex(c => c.id === 'do_record'), iMgr = t.findIndex(c => c.id === 'do_contact_manager');
  ok('3 記録の方法が、相談より先に出る', iRec === 0 && iMgr > iRec, t.slice(0, 3).map(c => c.id).join(','));
  ok('3 記録の例に年に依存する曜日がない', !/（[日月火水木金土]）/.test(JSON.stringify(t[0].script)));
}
// ---- 4. 学校の請願が不採択：テーマで提案が変わる ----
{
  const go = topic => {
    const st = run(D.gakko.tree, { situation: 'H', h_topic: topic });
    const file = { id: 'f', domain: 'gakko', state: st, done: true, records: [], rounds: [] };
    const r = N.newRound(D.gyosei.tree, file, 'n1');
    const x = run(D.gyosei.tree, { pet_result: 'rejected', minutes_checked: 'no', reason_known: 'no', new_material: 'no', request_scope: 'no', ongoing: 'yes' }, { entry: 'next', facts: r.state.facts });
    return { f: x.facts, t: todo(D.gyosei, x.facts) };
  };
  const j = go('japanese'), l = go('lunch'), u = go('unknown');
  ok('4 テーマ（日本語指導）を次の一手に引き継ぐ', j.f.pet_topic === 'japanese');
  ok('4 日本語指導を選んだら、日本語指導の統計を提案', j.t.some(c => c.id === 'do_stats_gakko'));
  ok('4 給食を選んだら、日本語指導の統計を出さない', !l.t.some(c => c.id === 'do_stats_gakko'));
  const ls = l.t.find(c => c.id === 'do_stats');
  ok('4 給食を選んだら、給食の資料で確かめる案内', !!ls && /給食/.test(plainT(ls, l.f)), ls && plainT(ls, l.f));
  ok('4 テーマ不明なら統計を出さず、会議録・理由の確認を優先', !u.t.some(c => c.key === 'public_stats') && u.t.some(c => c.key === 'check_minutes'));
}

// ---- 保存：仮の保存場所 ----
const mem = new Map();
let failKeys = new Set();
const fake = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { if (failKeys.has(k)) throw new Error('QuotaExceeded'); mem.set(k, String(v)); },
  removeItem: k => mem.delete(k),
  key: i => [...mem.keys()][i] ?? null,
  get length() { return mem.size; }
};
globalThis.window = { localStorage: fake };
const S = await import('../js/store.js');
const KEY = S.PREFIX + 'files';
const st0 = E.begin(D.minpaku.tree);
const reset = () => { S.clearAll(); mem.clear(); failKeys = new Set(); };

// 15. 壊れたデータ：空で上書きしない
reset();
mem.set(KEY, '{壊れたデータ');
const fA = S.createFile('minpaku', st0);
ok('15 壊れた保存データは別の名前に写してから使う', mem.get(S.PREFIX + 'files.unreadable') === '{壊れたデータ' && !!S.getFile(fA.id));
reset();
mem.set(KEY, '{壊れたデータ'); failKeys.add(S.PREFIX + 'files.unreadable');
const okB = S.putFile({ id: 'x1', domain: 'minpaku', state: st0, rev: 0 });
ok('15 写せないときは保存を止め、壊れたデータを上書きしない', okB === false && mem.get(KEY) === '{壊れたデータ' && S.problem().blocked === 'unreadable');
// 旧形式（版番号なし）：答え・記録・下書き・チェックを失わずに移す
reset();
const v1 = { files: [{ id: 'old1', domain: 'minpaku', title: '民泊・宿泊施設：すでに営業していて困っている', state: { node: '@result', facts: { situation: 'B' }, history: [] }, done: true, checks: { c1: true }, records: [{ id: 'r', date: '2026-10-01', toType: 'manager', state: 'doing' }], docs: { manager_letter: { values: { place: 'A町' }, edited: true, text: '手で直した文' } }, statusLog: [] }] };
mem.set(KEY, JSON.stringify(v1));
const o1 = S.getFile('old1');
o1.title = o1.title + '（確認）';
const okM = S.putFile(o1);
const saved1 = JSON.parse(mem.get(KEY));
ok('15 旧形式を読み、版番号を足して保存できる', okM && saved1.schema === S.SCHEMA && saved1.files[0].rev === 2);
ok('15 旧形式の答え・記録・下書き・チェックが残る', saved1.files[0].checks.c1 && saved1.files[0].records.length === 1 && saved1.files[0].docs.manager_letter.text === '手で直した文');
ok('15 形を変える前の内容を別の名前に残す', mem.get(S.PREFIX + 'files.before-v2') === JSON.stringify(v1));
// 新しすぎる版：上書きしない
reset();
mem.set(KEY, JSON.stringify({ schema: 99, files: [] }));
ok('15 新しい版のデータは上書きしない', S.putFile({ id: 'x2', domain: 'minpaku', state: st0, rev: 0 }) === false && JSON.parse(mem.get(KEY)).schema === 99);

// 16. 複数タブ：古い内容で上書きしない・削除した相談を復活させない
reset();
const base = S.createFile('minpaku', st0);
const tabA = S.getFile(base.id), tabB = S.getFile(base.id);
tabB.records = [{ id: 'rb', date: '2026-11-01', toType: 'gov', state: 'doing' }];
ok('16 タブBの保存はできる', S.putFile(tabB));
tabA.title = 'タブAの古い画面から';
ok('16 タブAの古い内容では上書きしない', S.putFile(tabA) === false && S.conflict?.type === 'newer' && S.getFile(base.id).records.length === 1);
ok('16 「この画面の内容で上書き」を選べば保存できる', S.putFile(tabA, true, true) && S.getFile(base.id).title === 'タブAの古い画面から');
const tabC = S.getFile(base.id);
S.removeFile(base.id);
ok('16 削除した相談は「削除した相談」に入る', !S.getFile(base.id) && S.listTrash().some(t => t.file.id === base.id));
ok('16 古いタブの保存で削除した相談が復活しない', S.putFile(tabC) === false && S.conflict?.type === 'deleted' && !S.getFile(base.id));
ok('16 削除を取り消せる', S.undelete(base.id) && !!S.getFile(base.id) && !S.listTrash().length);
const tabD = S.getFile(base.id);
S.removeFile(base.id); S.purge(base.id);
ok('16 完全に削除したあと、古いタブの保存で復活しない', S.putFile(tabD) === false && S.conflict?.type === 'deleted' && !S.getFile(base.id));
S.clearConflict(); const tabE = S.getFile(S.createFile('minpaku', st0).id); S.clearAll();
ok('16 すべて削除したあと、古いタブの保存で復活しない', S.putFile(tabE) === false && !S.listFiles().length);
ok('16 新しく作る相談は、すべて削除のあとでも保存できる', !!S.createFile('minpaku', st0) && S.listFiles().length === 1);
S.clearConflict();

// 14. バックアップと復元：追加・置き換え・そのまま を分け、既存の相談を消さない
reset();
const k1 = S.createFile('minpaku', st0), k2 = S.createFile('gakko', E.begin(D.gakko.tree));
const bak = JSON.parse(S.backupText());
const newer = S.getFile(k1.id); newer.title = '端末で直した'; S.putFile(newer);
bak.files.push({ id: 'imp1', domain: 'minpaku', state: st0, rev: 1, updatedAt: '2026-11-01T00:00:00Z' }, { id: 'bad', domain: 'minpaku' });
const k2b = bak.files.find(f => f.id === k2.id); k2b.title = 'ファイルの方が新しい'; k2b.updatedAt = '2099-01-01T00:00:00Z';
const S3 = S.createFile('yosan', st0);
const plan = S.planRestore(JSON.stringify(bak));
ok('14 復元の前に件数を示す（追加1・置き換え1・そのまま1・読まない1）', plan.add.length === 1 && plan.replace.length === 1 && plan.keep.length === 1 && plan.invalid === 1, JSON.stringify({ a: plan.add.length, r: plan.replace.length, k: plan.keep.length, i: plan.invalid }));
S.applyRestore(plan);
ok('14 復元しても端末だけにある相談は消えない', !!S.getFile(S3.id) && S.getFile(k1.id).title === '端末で直した' && S.getFile(k2.id).title === 'ファイルの方が新しい' && !!S.getFile('imp1'));
let threw = '';
try { S.planRestore(JSON.stringify({ app: 'kurashi-navi', version: 99, files: [] })); } catch (e) { threw = e.message; }
ok('14 対応外の版のバックアップは読まない', /新しい版/.test(threw));
threw = '';
try { S.planRestore('これはJSONではない'); } catch (e) { threw = e.message; }
ok('14 壊れたファイルは読まない（端末の相談はそのまま）', !!threw && S.listFiles().length === 4);

// 19. 全件削除はこのサイトのものだけ
mem.set('other-site:keep', '1');
S.clearAll();
ok('19 全件削除はこのサイトの保存だけ（ほかのサイトは残る）', mem.get('other-site:keep') === '1' && ![...mem.keys()].some(k => k.startsWith(S.PREFIX)));

console.log(`\n受け入れテスト：OK ${pass} / NG ${fail}`);
process.exitCode = fail ? 1 : 0;
