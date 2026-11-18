// 礼拝施設の確認チェックリスト（data/reihai/checklist.json）の検査。
// 形・参照・禁止表現・「分からない」の有無・答えの組み合わせごとの出力（行き止まり・空・undefined）を確かめる。
// 使い方：node tools/check-reihai.mjs   （結果の詳細は tools/check-reihai-report.txt）
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import * as C from '../js/reihai-core.js';

const D = JSON.parse(readFileSync('data/reihai/checklist.json', 'utf8'));
const SRC = new Set(JSON.parse(readFileSync('data/sources.json', 'utf8')).sources.map(s => s.id));
const errs = [], notes = [];
const err = m => errs.push(m);

// 1. 状態は6つ、この順
const ST = ['未確認', '確認中', '問題なしと確認', '改善待ち', '改善確認済み', '対象外'];
if (D.statuses.map(s => s.label).join() !== ST.join()) err('状態の名前・順番が仕様と違う');

// 2. 質問：選ぶ質問には「分からない」などの逃げ道があること、条件の参照先があること
const qIds = new Set(D.questions.map(q => q.id));
for (const q of D.questions) {
  if (q.type !== 'text' && !q.options.some(o => /分からない|決めていない|まだどこにも|覚えていない/.test(o.label))) err(`質問 ${q.id} に「分からない」に当たる選択肢がない`);
  if (q.when && !qIds.has(q.when.q)) err(`質問 ${q.id} の条件の参照先がない`);
}
if (!D.questions.find(q => q.id === 'worry').options.find(o => o.v === 'proc')?.ex) err('「手続きを確かめたいだけ」が、ほかの答えと同時に選べる');
const respOpts = D.questions.find(q => q.id === 'resp').options.map(o => o.v).filter(v => v !== 'unk');
for (const v of respOpts) if (!D.responses.some(r => r.id === v)) err(`回答「${v}」に次の一手がない`);
if (D.responses.length < 11) err('回答別の分岐が11より少ない');

// 3. 項目：共通仕様の欄・参照
const groups = new Set(D.groups.map(g => g.id)), depts = new Set(Object.keys(D.depts)), items = new Set(D.items.map(i => i.id));
const WHO = ['all', 'pub', 'owner', 'foi', 'local', 'self'];
const optOk = (qid, v) => D.questions.find(q => q.id === qid)?.options?.some(o => o.v === v);
function checkWhen(w, id) {
  if (!w) return;
  if (w.not) return checkWhen(w.not, id);
  if (w.any || w.all) return (w.any || w.all).forEach(x => checkWhen(x, id));
  if (w.pick) { const it = D.items.find(i => i.id === w.pick); if (!it?.pick) err(`${id} の条件：項目 ${w.pick} に記録欄がない`); (w.in || []).forEach(v => it?.pick?.options.some(o => o.v === v) || err(`${id} の条件：${w.pick} に値 ${v} がない`)); return; }
  if (!qIds.has(w.q)) return err(`${id} の条件：質問 ${w.q} がない`);
  (w.in || w.has || []).forEach(v => optOk(w.q, v) || err(`${id} の条件：質問 ${w.q} に選択肢 ${v} がない`));
}
for (const q of D.questions) (q.options || []).forEach(o => o.when && checkWhen(o.when, `質問 ${q.id} の選択肢 ${o.v}`));
for (const it of D.items) {
  for (const k of ['t', 'why', 'next', 'basis']) if (!it[k] || (Array.isArray(it[k]) && !it[k].length)) err(`${it.id} に「${k}」がない`);
  if (!groups.has(it.g)) err(`${it.id} の分類 ${it.g} がない`);
  (it.dept || []).forEach(d => depts.has(d) || err(`${it.id} の相談先 ${d} がない`));
  if (it.ask && !(it.dept || []).length) err(`${it.id} は質問文があるのに相談先がない`);
  (it.docs || []).forEach(d => WHO.includes(d.who) || err(`${it.id} の資料「${d.n}」の取得できる人の区分 ${d.who} が不明`));
  (it.basis || []).forEach(b => { if (!D.levels[b.k]) err(`${it.id} の根拠の区分 ${b.k} が不明`); if (b.src && !SRC.has(b.src)) err(`${it.id} の出典 ${b.src} が sources.json にない`); if (b.k !== 'vol' && b.k !== 'local' && !b.src) err(`${it.id} の根拠（${b.k}）に出典がない`); });
  checkWhen(it.when, it.id);
  (it.vary || []).forEach((v, i) => { if (!v.when) err(`${it.id} の言いかえ${i + 1}に条件がない`); checkWhen(v.when, `${it.id} の言いかえ${i + 1}`); Object.keys(v).forEach(k => ['when', 't', 'ask', 'req', 'askBy'].includes(k) || err(`${it.id} の言いかえで変えられない欄 ${k}`)); });
  Object.entries(it.askBy || {}).forEach(([d, t]) => { if (!(it.dept || []).includes(d)) err(`${it.id} の部署ごとの質問文 ${d} が相談先にない`); if (t !== false && typeof t !== 'string') err(`${it.id} の部署ごとの質問文 ${d} は文か false`); });
  for (const a of [it.ask, ...Object.values(it.askBy || {}), ...(it.vary || []).map(v => v.ask)].filter(x => typeof x === 'string' && x))
    if (!a.includes('（施設へのお願い）') && !/教えて|確認|お願い|検討|ご検討/.test(a)) err(`${it.id} の質問文が、役所に確認を求める形になっていない：${a.slice(0, 20)}`);
  if (it.ask && !it.ask.includes('（施設へのお願い）') && !/教えて|確認|お願い|検討|ご検討/.test(it.ask)) err(`${it.id} の質問文が、役所に確認を求める形になっていない`);
  for (const t of [...(it.next || [])]) for (const m of t.matchAll(/(?<![A-Za-z])([A-I]\d)(?!\d)/g)) if (!items.has(m[1])) err(`${it.id} の案内にある項目 ${m[1]} がない`);
}
for (const r of D.routes) if (r.src && !SRC.has(r.src)) err(`進め方 ${r.id} の出典 ${r.src} がない`);
for (const r of D.responses) for (const t of r.then) for (const m of t.matchAll(/(?<![A-Za-z])([A-I]\d)(?!\d)/g)) if (!items.has(m[1])) err(`回答 ${r.id} の案内にある項目 ${m[1]} がない`);
for (const r of D.cross.rows) { if (!items.has(r.item)) err(`比較表 ${r.id} の項目 ${r.item} がない`); if (!depts.has(r.dept)) err(`比較表 ${r.id} の確認先がない`); }
const crossIds = D.cross.rows.map(r => r.id).join();
if (crossIds !== 'touki,kenchiku,kaihatsu,zei,shobo') err('比較表に登記・建築・開発・課税・消防の5つがそろっていない');
if (D.cross.pitfalls.length < 9) err('見落としやすい点が9つより少ない');

// 4. 禁止表現：断定・属性。考え方・扱わないこと・誤解の「誤り」側・先頭の小見出しは説明のための例外
const BANNED = [/違法です/, /違反しています/, /違法建築です/, /犯罪です/, /危険です/, /外国人/, /イスラム|ムスリム|キリスト教|カトリック|プロテスタント|仏教|神道|ヒンドゥー|ユダヤ|新興宗教|カルト/];
const ATTR = [/国籍/, /民族/, /モスク/];
const texts = [];
const walk = (v, path) => { if (typeof v === 'string') texts.push([path, v]); else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`)); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`)); };
walk(D, 'D');
const allowAttr = p => /^D\.(principles|outOfScope|kicker)|^D\.myths\[\d+\]\.wrong/.test(p);
for (const [p, t] of texts) {
  for (const re of BANNED) if (re.test(t) && !/^D\.myths\[\d+\]\.wrong/.test(p)) err(`禁止表現 ${re} : ${p}`);
  for (const re of ATTR) if (re.test(t) && !allowAttr(p)) err(`属性の語 ${re} : ${p}`);
  const mythWrong = /^D\.myths\[\d+\]\.wrong/.test(p);   // 誤解の「誤り」側は、否定するために書いている
  if (/100㎡/.test(t) && !/古い|改正前|2019年/.test(t) && !mythWrong) err(`100㎡を現行の基準のように書いている : ${p}`);
  if (/必ず集会場/.test(t) && !/誤り/.test(t) && !mythWrong) err(`「必ず集会場」を否定せずに書いている : ${p}`);
  if (/期限/.test(t) && /回答/.test(t) && !/ありません|ではなく|ではありません|希望/.test(t) && !/審査請求|開示/.test(t)) notes.push(`回答の期限の書き方を確認 : ${p}`);
}
// 誤解しやすい点：仕様の7つの混同を扱っていること
const MUST = ['登記が見つからない', '固定資産税', '消防に届出済み', '登記の種類', '確認申請が要らない', '説明会や同意', '実際の被害'];
MUST.forEach(m => D.myths.some(x => x.wrong.includes(m)) || err(`誤解しやすい点に「${m}」がない`));

// 5. 答えの組み合わせ：質問の数・関係する項目・出力が空や undefined にならないこと
const pick = (a, n) => a[Math.floor(n * a.length)];
const opts = id => D.questions.find(q => q.id === id).options.map(o => o.v);
let runs = 0, minQ = 99, maxQ = 0, minRel = 999;
function run(s) {
  runs++;
  const qs = C.questionsFor(D, s);
  minQ = Math.min(minQ, qs.length); maxQ = Math.max(maxQ, qs.length);
  const { rel } = C.relevant(D, s); minRel = Math.min(minRel, rel.length);
  const pri = C.priority(D, s);
  if (!pri.length) err(`優先項目が空：${JSON.stringify(s.ans)}`);
  if (pri.some(p => !rel.includes(p.it))) err('優先項目に関係しない項目が入った');
  const outs = [C.priorityText(D, s), C.deptText(D, s), C.sheetText(D, s), C.sheetText(D, s, 'kenchiku', '2026-12-01'), C.crossText(D, s), C.logText(D, s), C.nextText(D, s)];
  outs.forEach((t, i) => { if (/undefined|null|NaN|\[object/.test(t)) err(`出力${i}に undefined など：${JSON.stringify(s.ans)}`); });
  if (!outs[2].includes(D.askClose)) err('相談票に基本のお願いの文がない');
  if (s.ans.contact === 'gov' && C.byDept(D, s).some(g => g.dept === 'op')) err('運営者に連絡しない希望なのに、運営者へのお願いが入った');
  // 相談票は1枚に1つの部署あて：質問がある部署があれば、あて先は空にしない。入る質問はその部署あての文だけ
  const sd = C.sheetDept(D, s), groupsNoOp = C.byDept(D, s).filter(g => g.dept !== 'op');
  if (groupsNoOp.length && (!sd || !outs[2].includes(`あて先：${D.depts[sd]}`))) err(`相談票のあて先が空：${JSON.stringify(s.ans)}`);
  for (const g of groupsNoOp) {
    const t = C.sheetText(D, s, g.dept);
    if (!t.includes(`あて先：${D.depts[g.dept]}`)) err(`相談票（${g.dept}）のあて先が違う`);
    for (const it of D.items) for (const [d, x] of Object.entries(it.askBy || {})) if (d === g.dept && x === false && it.ask && t.includes(C.fill(it.ask, s).slice(0, 40))) err(`相談票（${d}）に、その部署には聞かない ${it.id} の質問が入った`);
  }
  // 予定・工事中なら、「使われている」前提の文を出さない
  const { rel: rl } = C.relevant(D, s), st0 = C.active(D, s).ans.stage;
  if (['plan', 'build'].includes(st0)) for (const it of rl) for (const t of [it.t, ...(it.dept || []).map(d => C.askFor(it, d))])
    if (/使われているようです|現在は〇〇|いつから・何に・どのくらい」使われて|今の使い方は合って/.test(t || '')) err(`段階「${st0}」なのに ${it.id} が「使われている」前提の文`);
  if (['plan', 'build'].includes(st0) && C.active(D, s).ans.bldg === 'new' && rl.some(it => it.id === 'D4')) err('新しく建てる計画・工事中なのに、検査済証（D4）が出た');
  // 市街化区域と分かったら、都市計画法42条・43条（C4）は出さない
  if (s.picks?.C1 === 'shigaika' && rl.some(it => it.id === 'C4')) err('市街化区域なのに C4 が出た');
  // 回答の選択肢：役所に相談していないのに窓口の回答、請願・陳情を出していないのに「否決」を判定に使わない
  const ra = C.active(D, s).ans.resp || [], ak = s.ans.asked || [];
  if (!ak.includes('petition') && ra.includes('rejected')) err('請願・陳情を出していないのに「否決」が判定に入った');
  if (!ak.includes('gov') && ra.some(v => !['rejected', 'noreply', 'unk'].includes(v))) err('役所に相談していないのに、窓口の回答が判定に入った');
}
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const sub = id => { const o = opts(id).filter(v => !D.questions.find(q => q.id === id).options.find(x => x.v === v).ex); const r = o.filter(() => rnd() < 0.3); return r.length ? r : [opts(id).find(v => D.questions.find(q => q.id === id).options.find(x => x.v === v).ex) || o[0]]; };
for (let i = 0; i < 20000; i++) {
  const s = C.emptyState();
  s.ans = { stage: pick(opts('stage'), rnd()), bldg: pick(opts('bldg'), rnd()), worry: sub('worry'), trouble: sub('trouble'), near: sub('near'), uses: sub('uses'), asked: sub('asked'), resp: sub('resp'), contact: pick(opts('contact'), rnd()) };
  if (rnd() < 0.3) s.picks.C1 = pick(D.items.find(x => x.id === 'C1').pick.options.map(o => o.v), rnd());
  if (rnd() < 0.3) s.info = { addr: '〇〇市〇〇町1-2-3', name: '（施設名）' };
  if (rnd() < 0.2) { s.st = Object.fromEntries(D.items.map(it => [it.id, pick(D.statuses.map(x => x.v), rnd())])); s.log = [{ id: 'a', type: 'ev', real: 'real', date: '2026-11-01', harm: '眠れない' }, { id: 'b', type: 'co', date: '2026-11-02', dept: '建築指導課', due: '2026-11-10' }, { id: 'c', type: 'fx', date: '2026-11-20', result: 'same' }]; }
  run(s);
}
run(C.emptyState());   // 何も答えずに一覧を見た場合

// 6. 全項目が、どこかの答えの組み合わせで「関係する項目」になること
const reach = new Set();
for (let i = 0; i < 3000; i++) {
  const s = C.emptyState();
  s.ans = { stage: pick(opts('stage'), rnd()), bldg: pick(opts('bldg'), rnd()), worry: sub('worry'), trouble: sub('trouble'), near: sub('near'), uses: sub('uses'), asked: sub('asked'), resp: sub('resp'), contact: 'unk' };
  s.picks.C1 = pick(['chosei', 'hisen', 'shigaika'], rnd());
  C.relevant(D, s).rel.forEach(it => reach.add(it.id));
}
D.items.forEach(it => reach.has(it.id) || err(`項目 ${it.id} はどの答えでも関係する項目に出ない`));

// 7. 確認と相談のガイド（data/reihai/guide.json と 印刷用PDF）
const GD = JSON.parse(readFileSync('data/reihai/guide.json', 'utf8'));
const pdfSize = (() => { try { return statSync(GD.pdf).size; } catch { return -1; } })();
if (pdfSize !== GD.pdfBytes) err(`ガイド：印刷用PDF ${GD.pdf} がない、または取り込んだときと大きさが違う（取り込み直す：python -I tools/import-guide.py）`);
const covered = GD.chapters.flatMap(c => Array.from({ length: c.to - c.from + 1 }, (_, i) => c.from + i));
if (covered.join() !== Array.from({ length: GD.pageCount }, (_, i) => i + 1).join()) err('ガイド：章がPDFの全ページをちょうど1回ずつ覆っていない');
const gTexts = [];
for (const [n, p] of Object.entries(GD.pages)) {
  if (!p.t) err(`ガイド：${n}ページに題名がない`);
  if (!p.b.length) err(`ガイド：${n}ページが空`);
  gTexts.push([n, p.t]);
  for (const b of p.b) (b.k === 'tbl' ? b.rows.flat() : [b.t || '']).forEach(t => gTexts.push([n, t]));
}
const RELIGION = /モスク|イスラム|ムスリム|イード|ラマダン|ハラール|犠牲祭|キリスト教|カトリック|プロテスタント|仏教|神道|ヒンドゥー|ユダヤ/;
const qIdsG = new Set();
for (const [n, t] of gTexts) {
  if (RELIGION.test(t)) err(`ガイド：${n}ページに特定の宗教の名前「${t.match(RELIGION)[0]}」`);
  for (const m of t.matchAll(/(\d{1,3}(?:〜\d{1,3})?(?:・\d{1,3}(?:〜\d{1,3})?)*)ページ/g))
    for (const x of m[1].split('・')) for (const v of x.split('〜')) if (+v < 1 || +v > GD.pageCount) err(`ガイド：${n}ページの案内「${m[0]}」がPDFの範囲外`);
}
for (const p of Object.values(GD.pages)) for (const b of p.b) if (b.k === 'q') { if (qIdsG.has(b.id)) err(`ガイド：質問番号 ${b.id} が重なっている`); qIdsG.add(b.id); }
notes.push(`ガイド：${GD.pageCount}ページ・${GD.chapters.length}章・質問 ${qIdsG.size}`);

const report = [`検査日 ${new Date().toLocaleDateString('sv-SE')}`, `項目 ${D.items.length}・質問 ${D.questions.length}・回答別 ${D.responses.length}・進め方 ${D.routes.length}`,
  `答えの組み合わせ ${runs} 通り：質問の数 ${minQ}〜${maxQ}、関係する項目の最少 ${minRel}`, `エラー ${errs.length}`, ...errs, `注意 ${notes.length}`, ...notes].join('\n');
writeFileSync('tools/check-reihai-report.txt', report + '\n');
console.log(report.split('\n').slice(0, 4).join('\n'));
if (errs.length) console.log(errs.slice(0, 30).join('\n'));
if (notes.length) console.log(notes.slice(0, 10).join('\n'));
process.exit(errs.length ? 1 : 0);
