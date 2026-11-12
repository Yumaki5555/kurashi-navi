// 画面の組み立て。URL の # 以降で画面を切り替える（# 以降はサーバーに送られない）。
import * as E from './engine.js';
import * as S from './store.js';
import { renderDoc, fillText, filled } from './docs.js';
import { STATUS, STATUS_OUTCOME, DUE_TYPES, ladderState, currentStatus, recordsText, isPlanned } from './records.js';
import * as N from './rounds.js';

const SITE = '困りごと、次どうする？';
const main = document.getElementById('main');
const G = { sources: {}, links: {}, domains: [], areas: null, lists: null, focus: null, actions: [], ladders: {}, trees: {} };
const cache = {};
// 開いている相談：{ file, data（分野）, next（次の一手の共通データ）, round（次の一手の回。最初の診断なら null）, qn（表示中の質問の番号）, edit（答えを直している途中か） }
let cur = null;
let FX = {};    // 表示中の結果で使う「事実」（根拠の表示用）

// ---------- 小さな道具 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rich = s => esc(s).replace(/\[\[([^\]]+)\]\]/g, (_, t) => `<button type="button" class="term" data-act="term" data-term="${t}">${t}</button>`);
const plain = s => String(s ?? '').replace(/\[\[([^\]]+)\]\]/g, '$1');
// 回答ボタンの中にボタンを入れられない（HTMLの決まり）ので、用語の説明ボタンは回答ボタンの外に並べる
const termBtns = s => {
  const ts = [...new Set([...String(s ?? '').matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]))];
  return ts.length ? `<span class="opt-terms">${ts.map(t => `<button type="button" class="term" data-act="term" data-term="${esc(t)}">「${esc(t)}」とは</button>`).join('')}</span>` : '';
};
// 長い選択肢は「短い主文」と「補足（かっこの中）」に分けて見せる
const optLabel = l => {
  const p = plain(l), m = p.match(/^(.{4,}?)（(.+)）$/);
  return m && p.length > 16 ? `<span class="ol">${esc(m[1])}<small>${esc(m[2])}</small></span>` : esc(p);
};
// 長い名前（相談名など）は、パンくずなどで短くする（全文は title で見られる）
const short = (s, n = 18) => { const t = String(s ?? ''); return t.length > n ? `<span title="${esc(t)}">${esc(t.slice(0, n))}…</span>` : esc(t); };
const today = () => new Date().toLocaleDateString('sv-SE');
const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('ja-JP') : '');
const fmtDay = d => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : '');
// 電話のリンク：# は URL の区切りと読まれるので %23 にする（#9110 など）
const telHref = t => 'tel:' + String(t).replace(/[^0-9#+]/g, '').replace(/#/g, '%23');
const DOM = id => G.domains.find(d => d.id === id);
async function getJSON(p) { try { const r = await fetch(p, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; } }
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = 'コピーしました'; setTimeout(() => (btn.textContent = o), 1500); }
}
const KIND = { law: '法令', ordinance: '条例', guideline: '国の指針・ガイドライン', official: '公式発表', minutes: '議会の資料（会議録・審査結果など）', court: '裁判例', news: '報道' };
const OUTCOME = { resolved: '解決', partial: '一部改善', unresolved: '未解決', unknown: '結果不明' };

async function loadCommon() {
  const [domains, sources, links, areas, lists, focus, actions] = await Promise.all([
    getJSON('data/domains.json'), getJSON('data/sources.json'), getJSON('data/links.json'),
    getJSON('data/regions/areas.json'), getJSON('data/regions/minpaku-lists.json'), getJSON('data/regions/focus.json'), getJSON('data/actions.json')
  ]);
  G.domains = domains?.domains || [];
  for (const s of sources?.sources || []) G.sources[s.id] = s;
  G.links = links || {}; G.areas = areas; G.lists = lists; G.focus = focus; G.actions = actions?.actions || [];
}

async function loadDomain(d) {
  if (cache[d]) return cache[d];
  const names = ['tree', 'cards', 'checklists', 'cases', 'docs', 'glossary', 'ladder', 'facts'];
  const v = await Promise.all(names.map(n => getJSON(`data/${d}/${n}.json`)));
  const data = Object.fromEntries(names.map((n, i) => [n, v[i]]));
  if (!data.tree) throw new Error('診断データを読み込めませんでした');
  cache[d] = {
    tree: data.tree, cards: data.cards?.cards || [], checklists: data.checklists?.items || [], checklistMode: data.checklists?.mode || '', cases: data.cases?.cases || [],
    docs: data.docs?.docs || [], glossary: Object.fromEntries((data.glossary?.terms || []).map(t => [t.term, t.text])),
    ladder: data.ladder || { steps: [] }, facts: Object.fromEntries((data.facts?.facts || []).map(f => [f.id, f]))
  };
  return cache[d];
}
// 一覧で記録の相手の名前を出すため、段階のデータ（小さい）だけを読む
async function ladderOf(d) {
  if (cache[d]) return cache[d].ladder;
  if (!(d in G.ladders)) G.ladders[d] = (await getJSON(`data/${d}/ladder.json`)) || { steps: [] };
  return G.ladders[d];
}
async function treeOf(d) {
  if (cache[d]) return cache[d].tree;
  if (!(d in G.trees)) G.trees[d] = await getJSON(`data/${d}/tree.json`);
  return G.trees[d];
}
// 記録がないときの「最後にしたこと」：次の一手で選んだこと。なければ最初の診断の「これまでにしたこと」
function lastDid(f, tree, ntree) {
  const r = (f.rounds || []).filter(x => x.done && x.state?.facts?.did).at(-1);
  if (r && ntree) return E.labelOf(ntree, 'next_did', r.state.facts.did);
  const nodes = tree?.nodes || {}, fa = f.state?.facts || {};
  const id = Object.keys(nodes).find(k => nodes[k].fact === 'done' && fa.done) || Object.keys(nodes).find(k => nodes[k].fact === 'did' && fa.did);
  return id ? [].concat(fa[nodes[id].fact]).filter(x => x !== 'none').map(x => E.labelOf(tree, id, x)).join('、') : '';
}

// ---------- 保存データ ----------
// 題名：分野名＋最初の答え（例「民泊・宿泊施設：すでに営業していて困っている」）。自分で付けた名前は変えない
function autoTitle(file, tree) {
  const n = tree.nodes[tree.start], v = file.state?.facts?.[n.fact];
  const o = E.optionsOf(tree, n).find(x => x.value === v);
  return o ? `${DOM(file.domain)?.name || tree.title}：${plain(o.label)}` : '';
}
const fileName = f => f.title || `${DOM(f.domain)?.name || '相談'}：診断の途中`;
// 古い形の保存データを今の形に直す（題名の分野名を今の名前にそろえる）。答え・記録は変えない
function migrate() {
  S.migrateAll(f => {
    const d = DOM(f.domain);
    if (!d || !f.title || f.titleCustom) return false;
    const t = f.title.replace(/^[^：]*：/, d.name + '：').replace(/（\d{4}\/\d{1,2}\/\d{1,2}）$/, '');
    if (t === f.title) return false;
    f.title = t; return true;
  });
}
// 相談を開いたときに直すもの：題名のない途中の相談に題名を付ける／下書きごとに入れていた共通の欄（場所など）を共通情報へ移す
function migrateOpen(file) {
  let ch = false;
  if (!file.title && file.state?.history?.length) { file.title = autoTitle(file, cur.data.tree); ch = !!file.title; }
  if (!file.info) { file.info = {}; ch = true; }
  // あとから共通の欄になった項目（様子・お願いなど）も、下書きに入れてあった値を引き継ぐ
  for (const [id, sv] of Object.entries(file.docs || {})) {
    const d = allDocs().find(x => x.id === id);
    for (const f of d?.fields || []) if (f.info && !(f.info in file.info) && filled(sv.values?.[f.id])) { file.info[f.info] = sv.values[f.id]; ch = true; }
  }
  if (ch) S.putFile(file, false);
}

function openFile(id) {
  const file = S.getFile(id);
  if (!file) { location.hash = '#/'; return null; }
  return file;
}
// 保存。別のタブで新しくなっていた・削除されていたときは上書きせず、どうするかを選んでもらう（S.conflict）
function save() {
  if (!cur?.file) return false;
  const ok = S.putFile(cur.file);
  saved();
  return ok;
}
// 保存の状態：画面の上の帯（失敗・食い違い）と、相談の画面の小さな表示（自動保存済み）
let savedTimer = 0;
function saved() {
  const bar = document.getElementById('savebar');
  clearTimeout(savedTimer);
  const st = document.getElementById('savestate');
  if (st) st.innerHTML = saveStateText();
  if (!bar) return;
  if (S.conflict) {
    bar.className = 'savebar ng noprint'; bar.hidden = false;
    bar.innerHTML = S.conflict.type === 'deleted'
      ? '<b>この相談は、別のタブ（画面）で削除されています。</b>この画面の変更は保存していません。<div class="row wrap"><button class="btn slim" data-act="cf-revive">削除を取り消して、この画面の内容で保存</button><a class="btn slim" href="#/">トップへ（保存しない）</a></div>'
      : '<b>この相談は、別のタブ（画面）で新しく更新されています。</b>古い内容で上書きしないよう、この画面の変更はまだ保存していません。<div class="row wrap"><button class="btn slim" data-act="cf-reload">最新の内容を読み込む（この画面の変更は捨てる）</button><button class="btn slim" data-act="cf-force">この画面の内容で上書きする</button></div>';
  } else if (!S.lastOk) {
    bar.className = 'savebar ng noprint'; bar.hidden = false;
    bar.innerHTML = S.problem().blocked
      ? '<b>保存を止めています。</b>このブラウザに、読み込めない保存データがあります。上書きして消さないよう、新しい内容は保存していません。<a href="#/data">保存した相談</a>で、読み込めないデータをファイルに残してください。'
      : '<b>このブラウザに保存できませんでした。</b>（保存できる量がいっぱい、プライベートモードなどの理由が考えられます）入力した内容は、この画面を開いている間は残っていますが、閉じると消えます。<button class="btn slim" data-act="backup">バックアップを保存（ファイル）</button>するか、文をコピーして残してください。';
  } else if (!bar.hidden && bar.classList.contains('ng')) {
    bar.className = 'savebar ok noprint'; bar.textContent = '保存できました。';
    savedTimer = setTimeout(() => (bar.hidden = true), 4000);
  }
}
const hm = t => new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
function saveStateText() {
  if (S.conflict) return '<span class="ss ng">⚠ 保存していません（別の画面で更新あり）</span>';
  if (!S.lastOk) return '<span class="ss ng">⚠ 保存できませんでした</span>';
  return `<span class="ss">✓ このブラウザに自動保存${S.lastSavedAt ? `しました（${hm(S.lastSavedAt)}）` : 'されます'}</span>`;
}
const saveState = () => `<p class="savestate noprint" id="savestate" role="status">${saveStateText()}</p>`;
// keep：同じ画面を描き直すとき（状態の変更・記録の保存など）は、読んでいた位置を保つ
let keepScroll = false;
function setView(html, title, keep = false) {
  const y = window.scrollY;
  keep = keep || keepScroll; keepScroll = false;
  main.innerHTML = `<p class="printonly print-head">${esc(SITE)}／${esc(title || '')}／印刷日 ${new Date().toLocaleDateString('ja-JP')}</p>` + html;
  delete main.dataset.pane;
  document.title = (title ? title + '｜' : '') + SITE;
  if (keep) { window.scrollTo(0, y); return; }
  const h = main.querySelector('h1');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}
// 相談ごとに、最後に見た結果の画面（最初の診断か、次の一手の回か）を覚える。下書き・記録から「戻る」先にする
const lastResult = f => { const h = S.getUi().last?.[f.id]; return h && h.startsWith(`#/f/${f.id}`) ? h : `#/f/${f.id}/result`; };
const rememberResult = h => cur?.file && S.setUi(u => { (u.last ||= {})[cur.file.id] = h; });

// ---------- 画面の移り方 ----------
// アプリ内の「戻る」をブラウザの戻ると同じにするため、開いたURLの並びを覚えておく
const trail = [];
function track(h) { if (trail.at(-2) === h) trail.pop(); else if (trail.at(-1) !== h) trail.push(h); }
function go(h) { if (location.hash === h) route(); else location.hash = h; }
// 履歴を増やさずに移る（自動で結果や続きへ送るとき。戻るで同じ画面に閉じ込めないため）
function swap(h) { trail[trail.length - 1] = h; if (location.hash === h) route(); else location.replace(h); }
function goBack(h) { if (trail.at(-2) === h) history.back(); else go(h); }

// 今いる診断：最初の診断（分野のデータ）か、「次の一手」の回（共通データ）か
function ctx() {
  const f = cur.file, r = cur.round;
  return r
    ? { data: cur.next, tree: cur.next.tree, state: r.state, roundId: r.id, base: `#/f/${f.id}/next/${r.id}`, holder: r }
    : { data: cur.data, tree: cur.data.tree, state: f.state, roundId: 'main', base: `#/f/${f.id}`, holder: f };
}
const resultHash = c => (c.roundId === 'main' ? `${c.base}/result` : c.base);
const qHash = (c, n) => `${c.base}/q/${n}`;
// いちばん先の質問の番号（結果まで進んでいれば null）
const lastQ = st => (st.node === E.RESULT ? null : st.history.length + 1);
// 画面に出す質問の番号：引き継いで聞かなかった質問は数えない（URL の番号とは別）
const shownNo = (st, n) => n - st.history.slice(0, n - 1).filter(h => h.auto).length;

// 次の一手の回の名前：何のあとの対応かがわかるように（中身が決まる前は「次の一手」）
const PET_T = { rejected: '請願・陳情が不採択になった後の対応', shelved: '請願・陳情の結論が出なかった後の対応', noted: '陳情が報告だけで終わった後の対応', adopted: '採択された請願が進まないときの対応' };
const RES_T = { no_reply: '回答がないときの対応', cannot: '「対応できない」と言われた後の対応', redirected: '「担当ではない」と言われた後の対応', no_problem: '「問題ない」と言われた後の対応',
  will_do_nochange: '「指導する」などと言われても変わらないときの対応', refused: '断られた後の対応', partial: '一部よくなったが、まだ困っているときの対応', same: '変わらないときの対応', worse: '悪くなったときの対応' };
function roundTitle(r) {
  const f = r?.state?.facts || {};
  if (f.did === 'petition' && PET_T[f.pet_result]) return PET_T[f.pet_result];
  if (f.did === 'disclosure') return '情報公開請求の後の対応';
  if (f.did === 'giin') return '議員に相談した後の対応';
  if (f.did === 'none') return 'まず何をするかの整理';
  return RES_T[f.result] || '次の一手';
}
// 「続きから」の行き先と、押した先がわかる名前：答えている途中の質問 → 次の一手の途中の質問 → 最後に見た結果
function resumeOf(f) {
  if (f.state?.node !== E.RESULT) { const n = lastQ(f.state) || 1; return { href: `#/f/${f.id}/q/${n}`, label: `質問${shownNo(f.state, n)}から再開`, open: true }; }
  const open = (f.rounds || []).find(r => !r.done);
  if (open) { const n = lastQ(open.state) || 1; return { href: `#/f/${f.id}/next/${open.id}/q/${n}`, label: `「${roundTitle(open)}」の質問${shownNo(open.state, n)}から再開`, open: true }; }
  return { href: lastResult(f), label: '結果を見る' };
}

// ---------- 相談の共通情報（場所・困りごとなど。下書き・結果の例文で使い回す） ----------
const INFO = ['place', 'problems', 'since', 'detail', 'ask', 'know', 'history', 'lastResponse'];
function factLabel(tree, state, fact) {
  const id = state.history.map(h => h.node).find(n => tree.nodes[n]?.fact === fact);
  const v = state.facts[fact];
  if (!id || v === undefined) return '';
  const vs = (Array.isArray(v) ? v : [v]).filter(x => !['none', 'unknown', 'forgot'].includes(x));
  return vs.length ? E.labelOf(tree, id, vs) : '';
}
// 入力した共通情報＋まだ入れていない項目は、診断の答えと記録から作った初期値
function infoVals() {
  const { file, data } = cur, st = file.state, t = data.tree, L = recLabels();
  const done = (file.records || []).filter(r => !isPlanned(r)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const last = N.latestDone(file.records), lastRound = (file.rounds || []).filter(x => x.done).at(-1);
  const v = {
    place: '', since: '', detail: '', ask: '',
    problems: factLabel(t, st, 'problems'),
    know: factLabel(t, st, 'know') || factLabel(t, st, 'reasons'),
    history: [factLabel(t, st, 'done'), ...done.map(r => [fmtDay(r.date), L.toType[r.toType], L.method[r.method]].filter(Boolean).join(' '))].filter(Boolean).join('、'),
    // 前回の回答：いちばん新しい記録の回答（なければ回答の種類）→ 次の一手の「結果」→ 最初の診断の答え
    lastResponse: last?.response || L.result[last?.resultType] || (lastRound && cur.next ? factLabel(cur.next.tree, lastRound.state, 'result') : '') || factLabel(t, st, 'gov_response')
  };
  for (const k of INFO) if (k in (file.info || {})) v[k] = file.info[k];
  return v;
}

// ---------- 地域 ----------
const regionName = r => (r ? `${r.prefName || ''}${r.cityName ? ' ' + r.cityName : ''}` : '');
const regionNow = () => (cur?.file ? cur.file.region : S.getSettings().region) || null;
function regionSelects(r) {
  const prefs = G.areas?.prefs || [];
  const pref = prefs.find(p => p.code === r?.pref);
  return `<div class="row" data-region><select data-act="pref" aria-label="都道府県"><option value="">都道府県</option>${prefs.map(p => `<option value="${p.code}"${p.code === r?.pref ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <select data-act="city" aria-label="市区町村"${pref ? '' : ' disabled'}><option value="">市区町村</option>${(pref?.cities || []).map(([c, n]) => `<option value="${c}"${c === r?.code ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`;
}
// 確認済みの地域の情報（民泊の分野だけ持っている）
const focusArea = r => (r && cur?.file?.domain === 'minpaku' ? (G.focus?.areas || []).find(a => a.code === r.code && a.status === 'verified') : null);
// 公開されている施設の一覧：市区町村が自分の一覧を持つ種類は、都道府県の一覧（管轄外）を出さない。東京都（多摩）の一覧は23区では出さない
function regionLists(r) {
  if (!r) return [];
  const own = r.code ? G.lists?.byCode?.[r.code] || [] : [];
  const pref = (G.lists?.byCode?.[r.pref] || []).filter(l => !own.some(o => o.kind === l.kind) && !(/多摩/.test(l.owner) && /^131/.test(r.code || '')));
  return [...own, ...pref];
}
const KINDS = { jutaku: '届出の民泊（住宅宿泊事業）', ryokan: '旅館業', tokku: '特区民泊' };
const listsHtml = ls => `<ul class="lists">${ls.map(l => `<li>${KINDS[l.kind] || ''}：<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title || l.owner + 'の一覧')}</a> <small>資料の時点 ${esc(l.dataDate || '不明')}</small></li>`).join('')}</ul>`;
function regionLine() {
  const r = cur.file.region;
  return `<details class="region-line"><summary>地域：${r ? esc(regionName(r)) : 'まだ選んでいません'} <small>（${r ? '変える' : '選ぶと窓口が出ます'}）</small></summary>${regionSelects(r)}</details>`;
}
// 「どこへ」に添える地域の窓口：役所あての案内なら担当課と電話、施設の確認の案内なら公開されている一覧。
// region：'list' 施設の一覧／'gov' 担当課／'concern' 困りごと（騒音・ごみなど）を受け持つ別の担当／'none' 出さない（議員・情報公開の窓口など）
// 戻り値の contacts：担当課を出したか（出したときは、一般的な説明を1行にたたむ）
const FACILITY = ['jutaku', 'ryokan', 'tokku'];
// 確認できた窓口：名前・電話・公式ページ・確認日
const contactsHtml = (cs, a) => `<ul class="contacts">${cs.map(x => `<li><b>${esc(x.dept)}</b>${x.tel ? `<br><a class="btn slim" href="${telHref(x.tel)}">電話 ${esc(x.tel)}</a>` : ''}${x.url ? ` <a class="btn slim" href="${esc(x.url)}" target="_blank" rel="noopener">公式ページ <small class="ext">↗ 別タブ</small></a>` : ''}${x.note ? `<br><small>${esc(x.note)}</small>` : ''}</li>`).join('')}</ul>${a?.checked ? `<small>${esc(a.name || '')}の公式サイトで確認（確認日 ${esc(a.checked)}）。受付時間や担当が変わることがあります。</small>` : ''}`;
// 担当の直通が確認できないとき：代表電話で担当につないでもらう言い方（分野ごとの担当の呼び方）
const DEPT_WORD = { minpaku: '民泊（住宅宿泊事業）や旅館業', kenchiku: '建築指導', gakko: '学校教育（教育委員会）', yosan: '（事業の名前）', gyosei: '（相談したいこと）' };
function viaOperator(r) {
  const w = DEPT_WORD[cur.file.domain] || '（相談したいこと）';
  const say = `「${w}の担当の方につないでください」`;
  return `<p class="help small">この地域の担当窓口は、まだこのサイトで確認できていません（推測の部署名・電話番号は出しません）。${esc(regionName(r))}の代表電話（公式サイトに載っています）にかけて、${esc(say)}と伝えるとつないでもらえます。<button class="btn slim" data-act="copy" data-text="${esc(say)}">この言い方をコピー</button></p>`;
}
function whereExtra(c, where, T) {
  const r = cur.file.region;
  if (c.region === 'list') { const ls = regionLists(r); return { html: ls.length ? listsHtml(ls) : '' }; }
  if (c.region === 'none') return { html: '' };
  if (!r) return { html: c.region === 'gov' || /自治体|保健所|担当課|担当窓口|役所|市区町村/.test(plain(where)) ? '<small class="block">画面上の「地域」を選ぶと、確認できた地域では担当窓口の名前と電話が出ます。</small>' : '' };
  const a = focusArea(r);
  // 別の窓口：困りごとを受け持つ課だけ。宿泊施設の窓口（前に相談した窓口）と、記録した相手は出さない。なければ一般的な説明だけ
  if (c.region === 'concern') {
    const ps = [].concat(T?.facts?.problems || []), nm = s => String(s || '').replace(/\s/g, '');
    const asked = (cur.file.records || []).map(x => nm(x.toName)).filter(Boolean);
    const cs = (a?.contacts || []).filter(x => x.handles?.some(h => ps.includes(h)) && !x.handles.some(h => FACILITY.includes(h)) && !asked.some(n => nm(x.dept).includes(n) || n.includes(nm(x.dept))));
    return cs.length ? { html: contactsHtml(cs.slice(0, 3), a), contacts: true } : { html: '' };
  }
  const gov = c.region === 'gov' || (c.region === undefined && /自治体|保健所|担当課|担当窓口|役所|市区町村/.test(plain(where)));
  if (!gov) return { html: '' };
  if (a) {
    // 営業の種類が分かっていれば（標識の記載・回答から）、その種類の担当を先に出す
    const bt = T?.facts?.biz_type, hs = c.handles || (FACILITY.includes(bt) ? [bt] : FACILITY);
    const cs = a.contacts.filter(x => !x.handles?.length || x.handles.some(h => hs.includes(h))).slice(0, 3);
    if (cs.length) return { html: contactsHtml(cs, a), contacts: true };
  }
  return { html: viaOperator(r) + ((c.links || []).some(l => l.type === 'todokeru-contacts') ? '' : linksBlock([{ type: 'todokeru-contacts' }])) };
}
function regionInfo(listed = false) {
  const r = cur.file.region;
  if (!r) return '';
  let info = '';
  if (cur.file.domain !== 'minpaku') {
    // 民泊以外の分野は、地域ごとの確認済み情報をまだ持っていない。推測では出さず、窓口探しだけを案内する
    info += `<p class="note">この分野の、この地域の条例や担当窓口は、まだ確認できていません（要確認）。推測ではお出ししません。</p>`;
    info += linksBlock([{ type: 'todokeru-contacts' }]);
  } else {
    const area = focusArea(r), lists = regionLists(r);
    if (area) info += `<p class="help">この地域にある制度です。困っている施設がどの制度で営業しているかは、標識や下の施設の一覧で確かめます。</p><p><small>確認日 ${esc(area.checked)}</small></p>${area.rules.map(x => `<p><b>${esc(x.title)}</b>：${esc(x.summary)}${x.effective ? `（施行 ${esc(x.effective)}）` : ''}</p>`).join('')}`;
    if (lists.length && !listed) info += `<p><b>自治体が公開している施設の一覧</b></p>${listsHtml(lists)}<p><small>一覧に載っていなくても、更新の時期のずれや別の営業の種類のことがあります。「無許可」と決めつけず、窓口に確認してください。</small></p>`;
    if (!area) info += `<p class="note">この地域の民泊のルール（条例）と担当窓口は、まだ確認できていません（要確認）。推測ではお出ししません。</p>`;
    info += linksBlock([{ type: 'todokeru-contacts' }, { type: 'minpaku-map' }]);
  }
  return more(`${esc(regionName(r))}の情報`, info);
}

// ---------- 画面：トップ ----------
async function viewHome() {
  const files = S.listFiles();
  const ds = G.domains.filter(d => d.status === 'active');
  const closed = f => ['resolved', 'paused'].includes(currentStatus(f));
  const act = files.filter(f => !closed(f)), done = files.filter(closed);
  const cats = `<div class="stack cats">${ds.map(d => `<a class="btn big left cat" href="#/start/${d.id}"><b>${esc(d.name)}</b><small>${esc(d.desc || '')}</small>${d.note ? `<small class="cat-note">${esc(d.note)}</small>` : ''}</a>`).join('')}</div>`;
  setView(`
    <p class="tagline">困ったときも、行き詰まったときも。次にできることがわかる行動ガイド</p>
    <p class="emg-top"><a href="#/emergency">今まさに危険なことが起きているとき（110・119など）</a></p>
    ${act.length ? `<h1>続きから</h1><p class="help">途中の質問や、前に見た結果から再開できます。</p>${await fileList(act.slice(0, 3))}${act.length > 3 ? `<p><a href="#/data">進行中の相談をすべて見る（${act.length}件）</a></p>` : ''}
      <h2>新しく状況を整理する</h2>` : `<h1>何に困っていますか？</h1>
      <p class="lead">質問に答えると、今の状況に合った次の行動がわかります。すでに相談や請願をした方も、そこから先の方法を探せます。</p>`}
    ${cats}
    ${done.length ? `<details class="more"><summary>解決した・休んでいる相談（${done.length}件）</summary>${await fileList(done)}</details>` : ''}
    <h2>自分で行動する</h2>
    <p class="help">問い合わせ・情報公開請求・請願など、使いたい手段が決まっている方へ。</p>
    <div class="stack"><a class="btn" href="#/act">手段の一覧と、使う前の注意</a></div>
    <p class="note">入力した内容は、このブラウザの中だけに保存されます。サーバーへは送りません。共有の端末では、使い終わったら<a href="#/data">保存した相談</a>から削除してください。</p>`);
}

// 相談の一覧（トップ・分野のページ・保存した相談で同じ表示）：状態・最後にしたこと・記録の件数と、押した先がわかる再開ボタン
async function fileList(files, { manage = false, href } = {}) {
  const labs = {}, common = (await ladderOf(N.NEXT_DOMAIN)).commonRecordTypes || {};
  const trees = {}, ntree = await treeOf(N.NEXT_DOMAIN);
  for (const d of new Set(files.map(f => f.domain))) { labs[d] = await ladderOf(d); trees[d] = await treeOf(d); }
  return `<ul class="files">${files.map(f => {
    const L = labs[f.domain] || {}, rs = f.rounds || [];
    const st = currentStatus(f), sl = (f.statusLog || []).at(-1), last = N.latestDone(f.records), rc = (f.records || []).length;
    const rz = resumeOf(f), openR = rs.find(r => !r.done), lastR = rs.filter(r => r.done).at(-1);
    const badge = f.state?.node !== E.RESULT ? '診断の途中' : openR ? '次の一手の途中' : st === 'waiting' ? '回答待ち' : st ? STATUS.find(s => s.value === st)?.label : lastR ? roundTitle(lastR) : '結果あり';
    const did = last ? [fmtDay(last.date), L.recordTypes?.[last.toType] || common[last.toType], L.methods?.[last.method]].filter(Boolean).join(' ') : f.done && lastDid(f, trees[f.domain], ntree);
    const wait = st === 'waiting' && sl?.wait?.due ? `回答予定 ${fmtDay(sl.wait.due)}` : '';
    const meta = [`${fmtDate(f.updatedAt)} 更新`, wait, did && '最後にしたこと：' + did, rc && `記録${rc}件`].filter(Boolean).join('・');
    const to = href ? href(f) : rz.href;
    return `<li><div class="fi"><b>${short(fileName(f), 34)}</b> <span class="tag">${esc(badge)}</span><span class="meta">${esc(meta)}</span></div>
      <div class="row wrap fa"><a class="btn slim${rz.open || href ? ' primary' : ''}" href="${to}">${esc(href ? '選ぶ' : rz.label)}</a>
      ${manage ? `<button class="btn slim" data-act="rename" data-id="${f.id}">名前を変える</button><button class="btn slim" data-act="delfile" data-id="${f.id}">この相談を削除</button>` : ''}</div></li>`;
  }).join('')}</ul>`;
}

// 分野のページ：最初の質問（具体的な困りごと）をそのまま選べるようにして、1回分の操作を減らす
async function viewStart(domain, q = {}) {
  const d = DOM(domain);
  if (!d || d.status !== 'active') return viewHome();
  const data = await loadDomain(domain);
  const tree = data.tree, node = tree.nodes[tree.start];
  // 「役所の対応」：保存している相談のことなら、その相談の「次の一手」として続ける（同じ件を別の相談に分けない）
  const doneFiles = S.listFiles().filter(f => f.done);
  if (domain === N.NEXT_DOMAIN && !q.new && doneFiles.length) {
    return setView(`<p class="crumb"><a href="#/">トップ</a></p><h1>どの相談のことですか？</h1>
      <p class="lead">保存している相談のことなら、選ぶとその相談の「次の一手」として続けられます。答えと記録は引き継ぎます。</p>
      ${await fileList(doneFiles, { href: f => `#/f/${f.id}/next/new` })}
      <a class="btn big" href="#/start/${domain}?new=1">新しい相談として始める</a>`, d.name);
  }
  const files = S.listFiles().filter(f => f.domain === domain && !['resolved'].includes(currentStatus(f)));
  setView(`
    <p class="crumb"><a href="#/">トップ</a></p>
    <h1>${esc(d.name)}</h1>
    <p class="lead">${esc(d.desc || '')}などについて、次にすることをご案内します。</p>
    ${d.intro ? `<details class="intro"><summary>この分野で扱うこと</summary><p>${esc(d.intro)}</p></details>` : ''}
    ${files.length ? `<h2>前回の続き</h2>${await fileList(files.slice(0, 3))}<h2>新しく始める</h2>` : ''}
    <div class="region-start"><b>お住まいの地域</b>${regionSelects(S.getSettings().region)}<small>選ぶと、結果に地域の窓口が出ます（確認できた地域のみ）。わからなければ空欄のままで進めます。</small></div>
    <div id="dup"></div>
    <p class="qno">質問1</p><h2 class="q2">${rich(node.text)}</h2>${node.help ? `<p class="help">${rich(node.help)}</p>` : ''}<div class="termbox" hidden></div>
    <div class="stack">${E.optionsOf(tree, node, {}).map(o => `<div class="opt"><button class="btn big left" data-act="startans" data-domain="${domain}" data-v="${esc(o.value)}">${optLabel(o.label)}</button>${termBtns(o.label)}</div>`).join('')}</div>
    <ul class="points small"><li>質問は最大${tree.maxQuestions}問。わからない質問は「わからない」で進めます</li><li>結果は法的な判断ではなく、次の行動を整理するためのものです</li></ul>
    <div class="row wrap"><a class="btn slim" href="#/cases/${domain}">似た問題の事例集</a>${d.emergency ? '<a class="emg-link" href="#/emergency">今まさに危険なとき</a>' : ''}</div>`, d.name);
  if (!S.available()) main.insertAdjacentHTML('afterbegin', '<p class="warn">このブラウザでは保存ができません（プライベートモードなど）。画面を閉じると内容は消えます。</p>');
}

// これから進む先で、前の診断や記録から答えが分かっていて聞かずに進める質問（次の一手のみ）
function pendingInherited(c, st) {
  if (c.roundId === 'main') return [];
  const tree = c.tree, init = c.state.history[0]?.facts ?? c.state.facts, seen = new Set([st.node]), q = [st.node];
  while (q.length) for (const t of E.targetsOf(tree, q.shift())) if (tree.nodes[t] && !seen.has(t)) { seen.add(t); q.push(t); }
  // 並びは質問の定義の順（流れの順）にそろえる
  const order = Object.keys(tree.nodes);
  return [...seen].filter(id => { const n = tree.nodes[id]; return id !== st.node && n.sum && E.known(tree, n, init[n.fact]) && !st.history.some(h => h.node === id); })
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

// ---------- 画面：質問 ----------
// URL は質問ごと（…/q/3）。保存しているのは「いちばん先まで進んだ答え」で、前の質問はその途中の状態を表示するだけ（後の答えは消さない）
function viewQuestion() {
  const c = ctx(), tree = c.tree, full = c.state, last = lastQ(full), n = cur.qn;
  if (!n || n > (last || full.history.length)) { swap(last ? qHash(c, last) : resultHash(c)); return; }
  const st = E.stateAt(full, n);
  const node = tree.nodes[st.node];
  // 質問の番号は URL と同じ（引き継いで聞かなかった質問も数える）。最大の問数は入口から数えた値で、途中で変えない
  const asked = st.history.filter(h => !h.auto).length;
  const opts = E.optionsOf(tree, node, st.facts);
  const cv = c.holder.prev?.[st.node] ?? st.facts[node.fact];
  // 答えの印：まだ答えていない質問で、前の診断の答えに合う選択肢（例：最初の診断の「これまでにしたこと」）
  const hint = cv === undefined ? N.hintsFor(tree, st.node, st.facts) : [];
  const on = v => (Array.isArray(cv) ? cv.includes(v) : cv === v) || hint.includes(v);
  let body;
  const mark = v => (on(v) ? '<span class="ck" aria-label="選んでいた答え">✓</span>' : '');
  if (node.type === 'yesno') body = `<div class="yn">${opts.map(o => `<button class="btn big${on(o.value) ? ' chosen' : ''}" data-act="ans" data-v="${o.value}"${on(o.value) ? ' aria-pressed="true"' : ''}>${mark(o.value)}${o.label}</button>`).join('')}</div>`;
  else if (node.type === 'choice') body = `<div class="stack">${opts.map(o => `<div class="opt"><button class="btn big left${on(o.value) ? ' chosen' : ''}" data-act="ans" data-v="${esc(o.value)}"${on(o.value) ? ' aria-pressed="true"' : ''}>${mark(o.value)}${optLabel(o.label)}</button>${termBtns(o.label)}</div>`).join('')}</div>`;
  else body = `<fieldset class="stack"><legend class="sr">${esc(plain(node.text))}</legend>${opts.map(o => `<div class="opt"><label class="btn big left check"><input type="checkbox" value="${o.value}"${on(o.value) ? ' checked' : ''}${o.exclusive ? ' data-ex="1"' : ''}> ${optLabel(o.label)}</label>${termBtns(o.label)}</div>`).join('')}</fieldset>
    ${opts.some(o => o.exclusive) ? `<p class="help small">「${esc(opts.filter(o => o.exclusive).map(o => plain(o.short || o.label)).join('」「'))}」は、ほかと一緒には選べません。</p>` : ''}
    <p class="err" id="err" role="alert"></p><button class="btn big primary" data-act="multi">次へ</button>`;
  // 引き継いだ内容は、最初に聞く質問にだけ出す。利用者が実際に答えたこと（最初の診断・記録）と、
  // そこからこのサイトが整理したこと（聞かずに進める質問の答え）を分けて見せ、整理したことは変更できるようにする
  let inherited = '';
  if (!asked && c.roundId !== 'main') {
    const init = c.state.history[0]?.facts ?? c.state.facts;
    const item = (id, f) => esc(`${tree.nodes[id].sum}：${E.labelOf(tree, id, f[tree.nodes[id].fact])}`);
    const derived = [
      ...st.history.map((h, i) => (h.auto ? `<li>${item(h.node, h.facts)} <a href="${qHash(c, i + 1)}?edit=1">変更</a></li>` : '')).filter(Boolean),
      ...pendingInherited(c, st).map(id => `<li>${item(id, init)} <button class="linklike" data-act="uninherit" data-n="${id}">変更</button></li>`)
    ];
    const f = cur.file, own = [];
    if (f.domain !== N.NEXT_DOMAIN && f.state?.node === E.RESULT) own.push(`<li>最初の診断：${esc(nowText(E.summarize(cur.data.tree, f.state)))} <a href="#/f/${f.id}/result">答えを見る</a></li>`);
    const rec = N.latestDone((f.records || []).filter(r => !r.auto)), L = recLabels();
    if (rec) own.push(`<li>対応の記録：${esc([fmtDay(rec.date), L.toType[rec.toType], L.method[rec.method], L.result[rec.resultType]].filter(Boolean).join(' '))}</li>`);
    if (own.length || derived.length) inherited = `<details class="inh"${derived.length ? ' open' : ''}><summary>引き継いだ内容（${own.length + derived.length}件）</summary>
      ${own.length ? `<p class="inh-h">あなたが答えた・記録したこと</p><ul>${own.join('')}</ul>` : ''}
      ${derived.length ? `<p class="inh-h">この回答から、こう整理しています（違っていれば「変更」）</p><ul>${derived.join('')}</ul>` : ''}</details>`;
  }
  // 番号：引き継いで聞かなかった質問は数えない。最大は「この質問から先に最も多くて何問あるか」から出す
  const no = shownNo(full, n), rest = E.maxRemaining(tree, st.node) - 1, first = c.roundId === 'main' && n === 2 ? E.summarize(tree, full)[0] : null;
  setView(`
    ${c.roundId !== 'main' ? `<p class="crumb"><a href="${resultHash({ ...c, roundId: 'main', base: `#/f/${cur.file.id}` })}">${short(fileName(cur.file))}</a> › ${esc(roundTitle(c.holder))}</p>` : ''}
    <div class="progress" aria-label="進み具合"><span>質問${no}${rest > 0 ? `・このあと最大${rest}問` : '・最後の質問'}</span><div class="bar"><i style="width:${Math.min(100, Math.round((no / (no + rest)) * 100))}%"></i></div>
      ${first ? `<small>質問1は分野のページで「${esc(first.value)}」を選びました</small>` : ''}</div>
    ${inherited}
    ${cur.edit ? '<p class="note">回答を変更すると、ほかの答えはそのままで結果に戻ります。変更で分かれ道が変わるときは、その先の質問だけ聞き直します。対応の記録・下書きは消えません。</p>' : ''}
    ${hint.length ? '<p class="note">前の診断の答えに合うものに印（✓）を付けています。違うときは選び直してください。</p>' : ''}
    <h1 class="q">${rich(node.text)}</h1>
    ${node.help ? `<p class="help">${rich(node.help)}</p>` : ''}
    <div class="termbox" hidden></div>
    ${body}
    <div class="nav"><button class="btn" data-act="back">← 戻る</button>${cur.edit && full.node === E.RESULT ? `<a class="btn" href="${resultHash(c)}">変更せずに結果へ</a>` : `<a class="btn" href="#/">中断する</a>`}</div>
    <p class="help small">答えは自動で保存されます。「戻る」で前の質問に戻っても、先の答えは消えません。中断しても、トップの「続きから」でこの質問に戻れます。</p>
    <div class="row wrap end">${cur.edit ? '' : `<button class="linklike" data-act="restart">${c.roundId === 'main' ? 'この診断を最初からやり直す' : 'この次の一手を最初からやり直す'}</button>`}${DOM(cur.file.domain)?.emergency ? '<a class="emg-link" href="#/emergency">今まさに危険なとき</a>' : ''}</div>
    ${saveState()}`, c.roundId === 'main' ? '診断' : roundTitle(c.holder));
}

// 答えを進める。表示中の質問（cur.qn）の状態から答え直す。
// 「直す」から来たときは、残りの質問に前の答えを当てはめて結果まで進める（分岐が変わって前の答えがない質問では止まる）
function doAnswer(value) {
  const c = ctx(), file = cur.file;
  const base = E.stateAt(c.state, cur.qn || c.state.history.length + 1);
  let state;
  try { state = E.answer(c.tree, base, value); } catch (e) { alert(e.message); return; }
  c.holder.prev = { ...(c.holder.prev || {}), [base.node]: value };
  if (cur.edit) state = E.replay(c.tree, state, c.holder.prev);
  c.holder.state = state;
  c.holder.done = state.node === E.RESULT;
  if (c.roundId === 'main' && !file.titleCustom) file.title = autoTitle(file, c.tree) || file.title;
  // まだ保存していない回は、1問目に答えたこの時点で相談に加える
  if (draft?.round === c.holder) { file.rounds = [...(file.rounds || []), draft.round]; draft = null; }
  save();
  if (state.node !== E.RESULT) { go(qHash(c, state.history.length + 1) + (cur.edit ? '?edit=1' : '')); return; }
  // 最初の診断で、分野が「次の一手」へ続けると決めている答え（startNextIf）なら、そのまま次の一手を始める
  if (c.roundId === 'main' && c.tree.startNextIf && E.test(c.tree.startNextIf, state.facts) && !(file.rounds || []).length) { startRound(); return; }
  go(resultHash(c));
}

// 「次の一手を探す」：新しい回は画面の中だけに作り（draft）、1問目に答えたときに保存する（押しただけでは「途中」を残さない）。
// 聞く質問がなく、すぐ結果になるときだけ、その場で保存する
let draft = null;
function startRound() {
  const file = cur.file;
  const r = N.newRound(cur.next.tree, file, S.newId());
  r.done = r.state.node === E.RESULT;
  if (r.done) { file.rounds = [...(file.rounds || []), r]; draft = null; save(); }
  else draft = { fileId: file.id, round: r };
  const base = `#/f/${file.id}/next/${r.id}`;
  swap(r.done ? base : `${base}/q/${r.state.history.length + 1}`);
}

// ---------- 画面：結果 ----------
function sourcesBlock(ids = [], factIds = []) {
  const fs = factIds.map(id => FX[id]).filter(Boolean);
  // カードに直接書いた資料＋各事実の出典（重複は1つに）
  const allIds = [...new Set([...ids, ...fs.map(f => f.sourceId).filter(Boolean)])];
  const ss = allIds.map(id => G.sources[id]).filter(Boolean);
  const missing = allIds.length + factIds.length - ss.length - fs.length;
  if (!fs.length && !ss.length && !missing) return '';
  return `<details class="src"><summary>根拠と確認日</summary>
    ${fs.map(f => `<p>${esc(f.text)}${f.article ? `（${esc(f.article)}）` : ''}${f.caution ? `<br><small>注意：${esc(f.caution)}</small>` : ''}</p>`).join('')}
    <ul>${ss.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a><br><small>${KIND[s.kind] || ''}・${esc(s.publisher || '')}${s.effective ? '・施行 ' + esc(s.effective) : ''}・確認日 ${esc(s.checked)}</small></li>`).join('')}</ul>
    ${missing ? '<p><small>一部の根拠資料は確認中です（要確認）。</small></p>' : ''}</details>`;
}

function linkHref(l) {
  const L = G.links, r = cur?.file?.region, f = cur?.file;
  switch (l.type) {
    case 'todokeru-contacts': return L.todokeru + '#/contacts' + (r ? `?tab=area&code=${r.code || r.pref}` : '');
    // section：声を届けるのページの中の見出し（文章づくりの画面を飛ばして、読むところへ直接）
    case 'todokeru-guide': return L.todokeru + '#/guide/' + l.guide + (l.section ? '?s=' + encodeURIComponent(l.section) : '');
    case 'minpaku-map': { const q = new URLSearchParams(); if (r?.prefName) q.set('pref', r.prefName); if (r?.cityName) q.set('city', r.cityName); return L.minpakuMap + (q.toString() ? '?' + q : ''); }
    case 'pubcome': return L.pubcome;
    case 'shomei': return L.shomei;
    case 'doc': return f ? `#/f/${f.id}/doc/${l.doc}` : '#/';
    case 'records': return f ? `#/f/${f.id}/records` : '#/';
    case 'next': return f ? `#/f/${f.id}/next/new` : '#/start/gyosei';
    case 'page': return l.url;
    case 'tel': return telHref(l.tel);
    default: return l.url || '#/';
  }
}
const INTERNAL = ['doc', 'records', 'tel', 'next', 'page'];
// skipNext：「次の一手を探す」は結果の画面の決まった場所に1つだけ出すので、案内の中のボタンからは外す
function linksBlock(links = [], { skipNext = false } = {}) {
  const ls = links.filter(l => !(skipNext && l.type === 'next'));
  if (!ls.length) return '';
  return `<div class="links">${ls.map(l => {
    const ext = !INTERNAL.includes(l.type);
    const label = l.label || G.links.labels?.[l.type] || (l.type === 'next' ? '次の一手を探す' : 'ひらく');
    return `<a class="btn${l.type === 'next' || l.primary ? ' primary' : ''}" href="${esc(linkHref(l))}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(label)}${ext ? ' <small class="ext">↗ 別タブ</small>' : ''}</a>`;
  }).join('')}</div>`;
}

// 「やることに追加」：案内を、対応の記録に「予定していること」として加える
function chooseBtn(c, chosen) {
  const k = c.key || c.id;
  return chosen.has(k)
    ? `<p class="note">やることに追加済みです。<a href="#/f/${cur.file.id}/records">対応の記録で見る</a></p>`
    : `<button class="btn" data-act="choose" data-id="${esc(c.id)}">＋ やることに追加</button>`;
}
// 案内の文は、答えに合う部品だけをつなげ、共通情報（場所・困りごと）を差し込む（T = { facts, vars }）
const fill = (v, T) => fillText(v, T?.facts || {}, T?.vars || {});
const partsOf = (xs, T) => (xs || []).filter(x => typeof x === 'string' || E.test(x.when, T?.facts || {})).map(x => fill(typeof x === 'string' ? x : x.t, T));
const titleOf = (c, T) => plain(fill(c.title, T));

// 行動の種類：連絡する（contact）・調べる（research）・記録する（record）・サイト内で整理する（internal）。
// 種類ごとに、出す項目と見出しを変える（記録に「どこへ」、サイト内の案内に「伝え方の例」などを出さない）
function kindOf(c, T) {
  if (c.kind) return c.kind;
  const t = titleOf(c, T), ls = (c.links || []).map(l => l.type);
  if (ls.includes('records') && /記録/.test(t)) return 'record';
  if (/診断を|やり直す/.test(t) && ls.length && ls.every(x => x === 'page' || x === 'next')) return 'internal';
  if (/確か|調べ|探す|読む|見る|確認/.test(t) && !/伝え|求め|相談|申し|問い合わせ|頼|お願い|聞く/.test(t)) return 'research';
  return 'contact';
}
const KL = {
  contact: { where: '連絡先', check: 'その場で確かめること', script: '伝える文の例', ifNo: '回答がない・変わらないとき', copy: '伝える文をコピー' },
  research: { where: '確認先', check: '探す項目', script: '問い合わせるときの文例', ifNo: '判断できないとき', copy: '文例をコピー' },
  record: { where: '記録する場所', check: '残す内容', script: '記入例', ifNo: '続け方', copy: '記入例をコピー' },
  internal: {}
};
const dd = (h, body, cls = '') => (body ? `<dt>${h}</dt><dd${cls ? ` class="${cls}"` : ''}>${body}</dd>` : '');
// extra.recHelp：記録のつけ方を、この行動の中に入れる（「用意するもの：記録」と案内するのに、記録の方法が下に埋もれないように）
function todoCard(c, i, open, chosen, T, extra = {}) {
  const k = kindOf(c, T), K = KL[k];
  const where = fill(c.where, T), script = fill(c.script, T), check = fill(c.check, T), bring = partsOf(c.bring, T);
  const ex = k === 'contact' || k === 'research' ? whereExtra(c, where, T) : { html: '' };
  const canCopy = !!script && (k === 'record' || /「/.test(script));
  const needRec = bring.some(b => /記録/.test(b));
  const body = k === 'internal' ? '' : [
    dd(K.where, where ? (ex.contacts ? `${ex.html}<details class="gen"><summary>${esc(plain(where))}</summary></details>` : rich(where) + ex.html) : ex.html),
    dd(K.check, check && rich(check)),
    dd('用意するもの', bring.length ? `<ul>${bring.map(b => `<li>${rich(b)}</li>`).join('')}</ul>${needRec ? '<small>記録は、今あるだけで大丈夫です。そろうまで相談を待つ必要はありません。</small>' : ''}${needRec && extra.recHelp ? extra.recHelp : ''}` : ''),
    dd(canCopy ? K.script : 'メモの例', script && rich(script), 'script'),
    dd(K.ifNo, c.ifNoAnswer && rich(fill(c.ifNoAnswer, T)))
  ].join('');
  const acts = [
    canCopy ? `<button class="btn" data-act="copy" data-text="${esc(plain(script))}">${K.copy}</button>` : '',
    k === 'record' ? `<a class="btn" href="#/f/${cur.file.id}/records?add=1">記録を追加</a>` : '',
    chosen && k !== 'internal' ? chooseBtn(c, chosen) : ''
  ].join('');
  const links = (c.links || []).filter(l => !(k === 'record' && l.type === 'records'));
  // 区分（法令・条例に基づく／任意の協力のお願い／住民が自主的にできる）：分野の設定（planLayout.basis）があるときだけ出す
  const bl = c.basis && cur.data.tree.planLayout?.basis?.[c.basis];
  const items = partsOf(c.items, T);
  return `<details class="card todo k-${k}"${open ? ' open' : ''}><summary>${i === null ? '' : `<span class="num">${i + 1}</span>`}${rich(fill(c.title, T))}${bl ? ` <span class="tag b-${esc(c.basis)}">${esc(bl)}</span>` : ''}</summary>
    ${c.body ? `<p>${rich(fill(c.body, T))}</p>` : ''}
    ${items.length ? `<ul class="items">${items.map(x => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}
    ${body ? `<dl>${body}</dl>` : ''}${linksBlock(links, { skipNext: true })}${acts ? `<div class="links">${acts}</div>` : ''}${sourcesBlock(c.sources, c.facts)}<div class="termbox" hidden></div></details>`;
}
function infoCard(c, T, open = false) {
  const items = partsOf(c.items, T);
  return `<details class="card"${open ? ' open' : ''}><summary>${rich(fill(c.title, T))}</summary><p>${rich(fill(c.body || '', T))}</p>
    ${items.length ? `<ul>${items.map(x => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}${linksBlock(c.links, { skipNext: true })}${sourcesBlock(c.sources, c.facts)}<div class="termbox" hidden></div></details>`;
}
// 状態つきのチェックリスト（分野の設定 mode=status）：済／これから／不要。
// 以前の保存（チェックあり=true）は「済」として読む。rec：対応の記録にその相手の記録があれば「記録あり」。doneIf：診断の答えから済とわかる
const CL_ST = [['done', '済'], ['todo', 'これから'], ['na', '不要']];
const clCount = sts => `済 ${sts.filter(x => x === 'done').length} / ${sts.filter(x => x !== 'na').length}${sts.includes('na') ? '（不要を除く）' : ''}`;
function clState(i, checked, T, recs) {
  const v = checked[i.id];
  const r = i.rec && recs.filter(x => i.rec.includes(x.toType)).sort((a, b) => (a.date || '').localeCompare(b.date || '')).at(-1);
  const auto = r ? `記録あり（${fmtDay(r.date)}）` : i.doneIf && E.test(i.doneIf, T.facts) ? '診断の答えから' : '';
  const st = v === true || v === 'done' ? 'done' : v === 'na' || v === 'todo' ? v : auto ? 'done' : 'todo';
  return { st, auto };
}
function statusChecklist(items, checked, T, title) {
  const fid = cur.file.id, recs = (cur.file.records || []).filter(x => !isPlanned(x));
  const rows = items.map(i => ({ i, ...clState(i, checked, T, recs) }));
  const cnt = `<small class="cnt">${clCount(rows.map(x => x.st))}</small>`;
  // title があるとき：結果の画面の見出しつきの欄として出す。ないとき：これまでどおり折りたたみ
  const [open, close] = title ? [`<section id="checklist" data-cl="1"><h2>${esc(title)} ${cnt}</h2>`, '</section>'] : [`<details class="more" id="checklist" data-cl="1"><summary>チェックリスト ${cnt}</summary>`, '</details>'];
  return `${open}
    <p class="help">それぞれ「済」「これから」「不要」を選べます。選んだ内容はこの相談に保存されます。「確かめ方」を開くと、確認の方法・聞く先・聞き方の例と、対応の記録に残すボタンが出ます。</p>
    <ul class="checklist st">${rows.map(({ i, st, auto }) => { const sc = fill(i.script, T); return `<li data-st="${st}"><span class="cl-text">${rich(fill(i.text, T))}${auto ? ` <small class="auto">${esc(auto)}</small>` : ''}</span>
      <span class="cl-st" role="group" aria-label="この項目の状態">${CL_ST.map(([v, l]) => `<button type="button" class="btn slim" data-act="check3" data-id="${i.id}" data-v="${v}" aria-pressed="${st === v}">${l}</button>`).join('')}</span>
      <details class="how"><summary>確かめ方・記録</summary>${i.how ? `<p><b>どうやって</b>：${rich(fill(i.how, T))}</p>` : ''}${i.ask ? `<p><b>どこに聞く</b>：${rich(fill(i.ask, T))}</p>` : ''}${sc ? `<p><b>聞き方の例</b>：${rich(sc)} <button class="btn slim" data-act="copy" data-text="${esc(plain(sc))}">コピー</button></p>` : ''}<a class="btn slim" href="#/f/${fid}/records?add=1&cl=${i.id}">対応の記録に残す</a></details></li>`; }).join('')}</ul><div class="termbox" hidden></div>${close}`;
}
function checklistBlock(items, checked, T, opt = {}) {
  if (opt.status) return statusChecklist(items, checked, T, opt.title);
  const n = items.filter(i => checked[i.id]).length;
  return `<details class="more" id="checklist" data-cl="1"><summary>チェックリスト <small class="cnt">${n} / ${items.length}</small></summary>
    <p class="help">項目の「確かめ方」を開くと、確認の方法・聞く先・聞き方の例が出ます。</p>
    <ul class="checklist">${items.map(i => { const sc = fill(i.script, T); return `<li><label><input type="checkbox" data-act="check" data-id="${i.id}"${checked[i.id] ? ' checked' : ''}> ${rich(fill(i.text, T))}</label>
      ${i.how || i.ask || sc ? `<details class="how"><summary>確かめ方</summary>${i.how ? `<p><b>どうやって</b>：${rich(fill(i.how, T))}</p>` : ''}${i.ask ? `<p><b>どこに聞く</b>：${rich(fill(i.ask, T))}</p>` : ''}${sc ? `<p><b>聞き方の例</b>：${rich(sc)} <button class="btn slim" data-act="copy" data-text="${esc(plain(sc))}">コピー</button></p>` : ''}</details>` : ''}</li>`; }).join('')}</ul><div class="termbox" hidden></div></details>`;
}
const more = (title, inner, open = false) => inner ? `<details class="more"${open ? ' open' : ''}><summary>${title}</summary>${inner}</details>` : '';

// 「今の状況」：答えを短くつなげる。困りごと・したこと・相手・結果を優先して5つまで（全部は「答えた内容」で見られる）
const KEY_LABEL = /^(状況|困りごと)$|困っていること|心配なこと|起きていること|したこと|相手|相談した|結果|回答|様子|情報の状況/;
function nowText(sum) {
  const pri = sum.filter(s => KEY_LABEL.test(s.label));
  const pick = new Set(pri.length >= 5 ? pri.slice(0, 5) : [...pri, ...sum.filter(s => !pri.includes(s)).slice(0, 5 - pri.length)]);
  return sum.filter(s => pick.has(s)).map(s => (/^(状況|困りごと)$/.test(s.label) ? s.value : `${s.label}：${s.value}`)).join('／');
}

// 次の一手の答え（最後にしたこと・相手・結果）を、結果を出したときに対応の記録へ1件入れる。
// 同じ内容（相手の種類・方法・回答の種類）の記録があれば入れない。入れた記録は auto（記録の画面で分かるようにする）。
// 答えを直したら、手を入れていない自動の記録だけ合わせて直す。消した記録は入れ直さない
function autoRecord(round) {
  const file = cur.file, recs = file.records || [];
  const v = N.recordFromRound(cur.next.tree, round.state.facts, recLabels());
  const mine = round.autoRec && recs.find(x => x.id === round.autoRec);
  const same = x => x.toType === v.toType && (x.method || '') === v.method && (x.resultType || '') === v.resultType;
  const state = !v?.resultType || v.resultType === 'no_reply' ? 'doing' : 'answered';
  if (!v || (round.autoRec && !mine) || (mine && (!mine.auto || same(mine)))) return false;
  if (mine) { Object.assign(mine, v, { state }); return true; }
  if (recs.some(x => !isPlanned(x) && same(x))) return false;
  const id = S.newId();
  file.records = [...recs, { id, date: today(), toType: v.toType, toName: '', method: v.method, content: '', response: '', resultType: v.resultType, next: '', state, auto: true, round: round.id }];
  round.autoRec = id;
  return true;
}

// 結果の画面：①今の状況 ②まずすること（連絡先・確かめること・文例・操作をひとまとめ） ③ほかの方法（折りたたみ）
// ④今わかっていること ⑤やってみたら（記録・次の一手） ⑥注意点・根拠・関連情報（折りたたみ）の順
function viewResult() {
  const c = ctx(), file = cur.file;
  if (c.state.node !== E.RESULT) { swap(qHash(c, c.state.history.length + 1)); return; }
  const isRound = c.roundId !== 'main';
  rememberResult(resultHash(c));
  if (isRound && autoRecord(c.holder)) save();
  const st = currentStatus(file);
  // 記録の画面で選んだ「今の状態」があれば、最初の診断の「その後どうなったか」より優先する
  const outcome = !isRound && STATUS_OUTCOME[st];
  const facts = outcome ? { ...c.state.facts, outcome } : c.state.facts;
  FX = c.data.facts;
  const r = E.compose(c.data, facts);
  const sum = E.summarize(c.tree, c.state);
  const used = N.usedKeys(file, c.roundId);
  const { fresh, tried } = N.splitActions(r.todo, used);
  const chosen = new Set(c.holder.chosen || []);
  const T = { facts, vars: infoVals() };
  const first = fresh[0], others = fresh.slice(1);
  const lad = ladderState(cur.data.ladder, file.state.facts, file.records);
  const rounds = file.rounds || [], openR = rounds.find(x => !x.done);
  const caseDom = isRound ? N.NEXT_DOMAIN : file.domain;
  // 記録のつけ方：すでに記録があれば取り直させない。なければ、記録の案内をこの行動の中に入れる
  const did = (file.records || []).filter(x => !isPlanned(x));
  const recCard = others.find(x => kindOf(x, T) === 'record');
  const recHelp = did.length ? `<p class="note">対応の記録に${did.length}件あります。相談のときは、それを見ながら話せます。<a href="#/f/${file.id}/records">記録を見る</a></p>`
    : facts.recorded === 'yes' ? '<p class="note">記録をつけていると答えています。相談のときは、それを見ながら話せます。</p>'
    : recCard ? `<details class="how"><summary>記録のつけ方（まだ記録がないとき）</summary>${recCard.check ? `<p><b>残す内容</b>：${rich(fill(recCard.check, T))}</p>` : ''}${recCard.script ? `<p class="script">${rich(fill(recCard.script, T))}</p>` : ''}<a class="btn slim" href="#/f/${file.id}/records?add=1">記録を追加</a></details>` : '';
  const rz = resumeOf(file);
  const nextSec = openR
    ? `<a class="btn big primary" href="${rz.href}">${esc(rz.label)}</a><p class="help">途中の「次の一手」があります。続きから答えると、新しく作らずにそのまま進みます。</p>`
    : `<p class="help">回答がない・断られた・変わらないときは、これまでの答えと記録を引き継いで、次の方法を探せます。</p><a class="btn big" href="#/f/${file.id}/next/new">次の一手を探す</a>`;
  const others2 = rounds.filter(x => x.id !== c.roundId);
  const roundList = others2.length ? `<details class="more"><summary>これまでの次の一手（${others2.length}件）</summary><ul class="files">${others2.map(x => `<li><a href="#/f/${file.id}/next/${x.id}${x.done ? '' : '/q'}">${esc(roundTitle(x))}<span class="meta">${fmtDate(x.createdAt)}${x.done ? '' : '・途中'}</span></a></li>`).join('')}</ul></details>` : '';
  // 分野の設定（planLayout）に合うとき：①今すぐできること ②ほかにもできること（分類ごと） ③準備チェックリスト ④書類を作る ⑤行動したが解決しなかったら
  const plan = !isRound && c.tree.planLayout && E.test(c.tree.planLayout.when, facts) ? c.tree.planLayout : null;
  const scenes = plan ? r.ifnot.filter(x => x.scene) : [];
  const clHtml = r.checklist.length ? checklistBlock(r.checklist, file.checks || {}, T, { status: c.data.checklistMode === 'status', title: plan?.titles.checklist }) : '';
  const other = [
    plan && r.cause.length ? more('今わかっていること・次に確かめること', r.cause.slice(0, 2).map(x => `<div class="box cause"><b>${rich(fill(x.title, T).replace(/^見立て：/, ''))}</b><p>${rich(fill(x.body, T))}</p>${sourcesBlock(x.sources, x.facts)}<div class="termbox" hidden></div></div>`).join('')) : '',
    more(`すでに試したこと・選んだこと（${tried.length}件・同じ提案はしません）`, tried.length ? `<ul>${tried.map(x => `<li>${rich(fill(x.title, T))}</li>`).join('')}</ul>` : ''),
    more('また起きたとき・ほかの困りごとが残るとき', r.recur.map((x, i) => todoCard(x, i, false, chosen, T)).join('')),
    more(`あわせて確かめておくと役立つこと（${r.check.length}件）`, r.check.map(x => infoCard(x, T)).join('')),
    plan ? '' : clHtml,
    r.dont.map(x => infoCard(x, T)).join(''),
    !isRound && lad.next ? more(`この分野の次の段階：${esc(lad.next.title)}`, `<p>${rich(lad.next.body)}</p>${linksBlock(lad.next.links, { skipNext: true })}`) : '',
    r.ifnot.filter(x => !/段階/.test(x.title) && !x.scene).map(x => infoCard(x, T)).join(''),
    isRound ? '' : regionInfo([first, ...others].some(x => x?.region === 'list')),
    // 次の一手では「役所の対応」の事例を出す（事例のページから、この回の次の一手に戻れるよう回のIDも渡す）
    more('似た問題の事例', (r.cases.length ? r.cases.map(x => caseItem(x, caseDom, isRound ? `${file.id}&n=${c.roundId}` : file.id)).join('') : '<p class="note">似た事例は、確認でき次第追加します。</p>') + `<a class="btn" href="#/cases/${caseDom}">事例集をすべて見る</a>`)
  ].join('');
  const noneHtml = r.none.map(x => { const its = partsOf(x.items, T); return `<div class="box warn-box"><b>${rich(fill(x.title, T))}</b><p>${rich(fill(x.body, T))}</p>${its.length ? `<ul>${its.map(t => `<li>${rich(t)}</li>`).join('')}</ul>` : ''}${linksBlock(x.links, { skipNext: true })}</div>`; }).join('');
  setView(`
    <p class="crumb"><a href="#/">トップ</a>${isRound ? ` › <a href="#/f/${file.id}/result">${short(fileName(file))}</a>` : ''}</p>
    <h1>${isRound ? esc(roundTitle(c.holder)) : '診断の結果'}</h1>
    ${isRound ? '' : `<p class="help">${short(fileName(file), 40)}</p>`}
    ${regionLine()}
    <div class="box now"><b>今の状況</b><p>${esc(nowText(sum))}</p>
      <details><summary>答えた内容をすべて見る・変更する</summary><ul>${sum.map(s => `<li>${esc(s.label)}：<b>${esc(s.value)}</b>${s.auto ? ' <small>（引き継ぎ）</small>' : ''} <a class="fix" href="${qHash(c, s.n)}?edit=1">回答を変更</a></li>`).join('')}</ul></details></div>
    ${outcome ? `<p class="note">「対応の記録」で相談全体の状態を「${esc(STATUS.find(s => s.value === st).label)}」にしているので、それに合わせた案内を出しています。<a href="#/f/${file.id}/records">状態を変える</a></p>` : ''}
    ${plan ? planHtml(plan, { fresh, chosen, T, recHelp, noneHtml, clHtml, scenes, nextSec, roundList, file }) : `<section><h2>まずすること</h2>
      ${first ? todoCard(first, null, true, chosen, T, { recHelp }) : noneHtml}
    </section>
    ${others.length ? `<details class="more cand"><summary>ほかの方法（${others.length}件）</summary>${others.map((x, i) => todoCard(x, i + 1, false, chosen, T)).join('')}</details>` : ''}
    ${r.cause.length ? `<details class="more"><summary>今わかっていること・次に確かめること</summary>${r.cause.slice(0, 2).map(x => `<div class="box cause"><b>${rich(fill(x.title, T).replace(/^見立て：/, ''))}</b><p>${rich(fill(x.body, T))}</p>${sourcesBlock(x.sources, x.facts)}<div class="termbox" hidden></div></div>`).join('')}</details>` : ''}
    <section><h2>やってみたら</h2>
      <p class="help">行動したら、その日と結果を記録しておくと、次に何をするかを考えやすくなります。</p>
      <div class="row wrap start"><a class="btn primary" href="#/f/${file.id}/records?add=1">結果を記録する</a><a class="btn" href="#/f/${file.id}/records">対応の記録を見る</a>${allDocs().length ? `<a class="btn" href="#/f/${file.id}/doc">文書の下書きを作る</a>` : ''}</div>
      <h3>うまくいかなかったとき</h3>
      ${nextSec}${roundList}
    </section>`}
    ${other ? `<details class="more other"><summary>注意点・根拠・関連情報</summary>${other}</details>` : ''}
    <div class="row wrap noprint"><button class="btn" data-act="restart">${isRound ? 'この次の一手を最初からやり直す' : 'この診断を最初からやり直す'}</button><button class="btn" data-act="print">この結果を印刷・PDF</button></div>
    ${saveState()}
    <p class="note">この結果は、対応の仕方を整理するためのもので、法的な判断ではありません。</p>`, isRound ? roundTitle(c.holder) : '診断の結果');
}

// 結果の画面の「段階に合わせた並び」（分野の設定 planLayout があり、その条件に合うとき）
function planHtml(plan, { fresh, chosen, T, recHelp, noneHtml, clHtml, scenes, nextSec, roundList, file }) {
  const n = plan.top || 3, tops = fresh.slice(0, n), rest = fresh.slice(n), ti = plan.titles;
  const gs = plan.groups.map(g => ({ ...g, cs: rest.filter(x => (x.group || 'other') === g.id) })).filter(g => g.cs.length);
  let k = n;
  const moreHtml = gs.map(g => `<h3 class="grp">${esc(g.title)}（${g.cs.length}件）</h3>${g.cs.map(x => todoCard(x, k++, false, chosen, T)).join('')}`).join('');
  // 書類：行動から案内している文書を先に、そのあと、この状況のための文書（when のある文書）
  const ds = allDocs(), linked = [...new Set(fresh.flatMap(x => (x.links || []).filter(l => l.type === 'doc').map(l => l.doc)))];
  const docs = [...linked.map(id => ds.find(d => d.id === id)), ...ds.filter(d => d.when && !linked.includes(d.id))].filter(Boolean);
  const item = d => `<a class="btn big left" href="#/f/${file.id}/doc/${d.id}"><b>${esc(d.title)}</b><br><small>${esc(d.desc || '')}</small></a>`;
  return `<section><h2>${esc(ti.top)}</h2>
      ${plan.basisHelp ? `<p class="help">住民の希望だけで開業を止めることはできません。決まりに合っているかの確認と、協力のお願いを組み合わせて進めます。</p><details class="how flat"><summary>行動につけた区分の意味</summary><p>${rich(plan.basisHelp)}</p></details>` : ''}
      ${tops.length ? tops.map((x, i) => todoCard(x, i, i === 0, chosen, T, i === 0 ? { recHelp } : {})).join('') : noneHtml}
    </section>
    ${rest.length ? `<details class="more cand"><summary>${esc(ti.more)}（${rest.length}件）</summary>${moreHtml}</details>` : ''}
    ${clHtml}
    ${docs.length ? `<section><h2>${esc(ti.docs)}</h2><p class="help">入力した事実だけで文章を組み立てます。出す前に必ず読み直してください。</p>
      <div class="stack">${docs.slice(0, 3).map(item).join('')}</div>
      ${docs.length > 3 ? `<details class="more"><summary>ほかの書類（${docs.length - 3}種類）</summary><div class="stack">${docs.slice(3).map(item).join('')}</div></details>` : ''}
      <a class="btn" href="#/f/${file.id}/doc">文書の一覧を見る</a></section>` : ''}
    <section><h2>${esc(ti.after)}</h2>
      <p class="help">行動したら、その日と結果を記録しておくと、次に何をするかを考えやすくなります。</p>
      <div class="row wrap start"><a class="btn primary" href="#/f/${file.id}/records?add=1">結果を記録する</a><a class="btn" href="#/f/${file.id}/records">対応の記録を見る</a></div>
      ${scenes.length ? `<h3>よくある場面と、次の手</h3>${scenes.map((x, i) => infoCard(x, T, i === 0 && !!T.facts.pre_response)).join('')}` : ''}
      <h3>次の一手を探す</h3>
      ${nextSec}${roundList}
    </section>`;
}

// 事例の分野は、表示している一覧の分野を必ず渡す（開いている相談の分野を使うと、別の分野の事例に入れない）
// back：結果の画面から開いたときの相談のID（事例のページの最後に「結果に戻る」を出す）
const caseTag = c => `<span class="tag o-${c.outcome}">${esc(c.outcomeLabel || OUTCOME[c.outcome])}</span>`;
function caseItem(c, domain, back) {
  return `<a class="case" href="#/case/${domain}/${c.id}${back ? '?r=' + back : ''}">${caseTag(c)}
    <b>${esc(c.title)}</b><span class="meta">${esc(c.place?.pref || '')}${esc(c.place?.city || '')}・${esc(c.period || '')}</span><span>${esc(c.lesson || '')}</span></a>`;
}

// ---------- 画面：自分で行動する ----------
function viewAct() {
  setView(`<p class="crumb"><a href="#/">トップ</a></p><h1>自分で行動する</h1>
    <p class="lead">使いたい手段が決まっている方へ。どの手段にも、向いている場面と限界があります。何をしたいのかを決めてから選びましょう。</p>
    <div class="box"><b>迷ったら</b><p>困りごとの分野から診断すると、目的に合った手段を順番にご案内します。すでに行動してうまくいかなかったときは「次の一手」で、理由の見立てと次の手段を探せます。</p>
      <div class="row wrap"><a class="btn" href="#/">分野から診断する</a><a class="btn" href="#/start/gyosei">次の一手を探す</a></div></div>
    ${G.actions.map(a => `<details class="card"><summary>${esc(a.name)}</summary><p>${esc(a.what)}</p>
      <dl><dt>向いている場面</dt><dd>${esc(a.when)}</dd><dt>限界・注意</dt><dd>${esc(a.limits)}</dd><dt>用意するもの</dt><dd>${esc(a.prepare)}</dd></dl>
      ${linksBlock(a.links)}</details>`).join('')}
    <p class="note">手続きのくわしい手順は、姉妹サイト「声を届ける」で案内しています（↗の付いたボタンは別のサイトが開きます）。</p>`, '自分で行動する');
}

// ---------- 画面：事例 ----------
function viewCaseDomains() {
  const ds = G.domains.filter(d => d.status === 'active');
  setView(`<p class="crumb"><a href="#/">トップ</a></p><h1>似た問題の事例集</h1>
    <p class="lead">分野を選んでください。うまくいった事例だけでなく、一部だけ改善した・変わらなかった・結果が分からない事例も載せています。</p>
    <div class="stack">${ds.map(d => `<a class="btn big" href="#/cases/${d.id}">${esc(d.name)}</a>`).join('')}</div>`, '事例集');
}

async function viewCases(domain, q = {}) {
  const data = await loadDomain(domain);
  const d = DOM(domain);
  const out = q.o || '', kind = q.k || '';
  const list = data.cases.filter(c => (!out || c.outcome === out) && (!kind || c.sources.some(s => (G.sources[s.sourceId]?.kind || s.kind) === kind)));
  setView(`<p class="crumb"><a href="#/">トップ</a> › <a href="#/start/${domain}">${esc(d?.name || data.tree.title)}</a></p>
    <h1>似た問題の事例集</h1>
    <p class="note">一次資料（自治体・議会・裁判所など）で確認できた事例だけを載せています。報道された要望と、役所が実際に行ったことは分けて書いています。</p>
    <div class="row"><select data-act="cfilter" data-k="o" aria-label="結果で絞り込む"><option value="">結果：すべて</option>${Object.entries(OUTCOME).map(([k, v]) => `<option value="${k}"${k === out ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <select data-act="cfilter" data-k="k" aria-label="資料の種類で絞り込む"><option value="">資料：すべて</option>${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    ${list.length ? list.map(c => caseItem(c, domain)).join('') : '<p class="note">この分野で、一次資料で確かめられた事例はまだありません。確認でき次第追加します。</p>'}`, '事例集');
}

async function viewCase(domain, id, q = {}) {
  const data = await loadDomain(domain);
  const c = data.cases.find(x => x.id === id);
  if (!c) return viewCases(domain);
  // 値がない行（不明）は出さない。「何が起きた → どう動いた → どうなった」の3つに分けて見せる
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : '');
  const step = (n, h, body) => (body ? `<section class="cstep"><h2><span class="num">${n}</span>${h}</h2><dl>${body}</dl></section>` : '');
  const laws = (c.laws || []).length ? `<span class="laws">${c.laws.map(l => `<span class="law">${esc(l)}</span>`).join('')}</span>` : '';
  const where = [(c.place?.pref || '') + (c.place?.city || ''), c.period].filter(Boolean).map(esc).join('・');
  const back = q.r && S.getFile(q.r);
  // 次の一手の画面から来たとき（n＝回のID）は、その回に戻る
  const backRound = back && q.n && (back.rounds || []).some(x => x.id === q.n);
  const backBtn = backRound ? `<a class="btn big" href="#/f/${q.r}/next/${q.n}">次の一手に戻る</a>` : `<a class="btn big" href="#/f/${q.r}/result">結果に戻る</a>`;
  // 結果の欄は、見出しの札（結果の種類）と同じ内容なら出さない
  setView(`<p class="crumb"><a href="#/cases/${domain}">事例集</a></p>
    <h1>${esc(c.title)}</h1><p class="case-head">${caseTag(c)}<span class="meta">${where}</span></p>
    ${c.lesson ? `<div class="box point"><b>この事例から分かること</b><p>${esc(c.lesson)}</p></div>` : ''}
    <div class="case-detail">
    ${step(1, '何が起きていたか', row('最初の状況', esc(c.situation || '')) + row('問題点', esc(c.issue || '')))}
    ${step(2, 'だれが、どう動いたか', row('住民や行政・議会の対応', esc(c.response || '')) + row('使われた法律・条例・制度', laws))}
    ${step(3, 'どうなったか', row('結果', esc(c.result || '')) + row('その後の動き', esc(c.after || '')) || `<dd>${esc(c.outcomeLabel || OUTCOME[c.outcome])}</dd>`)}
    </div>
    <h2>根拠資料</h2><ul>${c.sources.map(s => { const x = G.sources[s.sourceId] || {}; return `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || s.sourceId)}</a><br><small>${[KIND[x.kind || s.kind], x.publisher, x.published && '公表 ' + x.published, (x.checked || c.checked) && '確認日 ' + (x.checked || c.checked)].filter(Boolean).map(esc).join('・')}</small></li>`; }).join('')}</ul>
    ${back ? backBtn : `<a class="btn big primary" href="#/start/${domain}">この分野で診断する</a>`}`, c.title);
}

// ---------- 画面：文書 ----------
// 分野の文書＋「役所とのやりとり」の共通文書（分野に同じ役目の文書があるものは出さない）
function allDocs() {
  // when：その相談の答えに合うときだけ出す文書（例：開業前の対策の文書は、近所に民泊ができるらしいときだけ）
  const own = cur.data.docs.filter(d => !d.when || E.test(d.when, cur.file.state?.facts || {}));
  if (cur.file.domain === N.NEXT_DOMAIN) return own;
  const hasDisc = own.some(d => /disclosure/.test(d.id));
  const common = (cur.next?.docs || []).filter(d => !own.some(o => o.id === d.id) && !(hasDisc && d.id === 'disclosure_memo'));
  return [...own, ...common.map(d => ({ ...d, common: true }))];
}
// 欄の初期値：最初の診断の答え → 次の一手の答え（新しい回から）→ 地域。どこから入れたか（from）も返す
function docPrefill(d) {
  const { file, data } = cur, v = {}, from = {};
  const srcs = [[data.tree, file.state], ...(file.rounds || []).slice().reverse().map(r => [cur.next.tree, r.state])];
  for (const f of d.fields) {
    const k = f.prefill?.fact;
    if (k) for (const [tree, st] of srcs) {
      if (st?.facts?.[k] === undefined) continue;
      // 実際に答えた（または引き継いだ）質問の選択肢から名前を取る（同じ事実を聞く質問が複数あるため）
      const nodeId = st.history.map(h => h.node).find(id => tree.nodes[id]?.fact === k);
      if (!nodeId) continue;
      const val = [].concat(st.facts[k]).filter(x => !['none', 'unknown', 'forgot'].includes(x));
      // map：選んだ答えごとに決めた文を入れる（例：心配ごと→求める対策）
      const text = f.prefill.map ? val.map(x => f.prefill.map[x]).filter(Boolean).join('\n') : val.length ? E.labelOf(tree, nodeId, val.length === 1 ? val[0] : val) : '';
      if (text) { v[f.id] = text; from[f.id] = '診断の答えから'; }
      break;
    }
    if (f.prefill?.region && file.region) { v[f.id] = file.region[f.prefill.region] || ''; from[f.id] = '地域の設定から'; }
  }
  return { v, from };
}
// 欄の値：共通情報の欄（info）は相談の共通情報から、ほかは下書きごとに保存した値から。from：引き継いだ欄（まだ自分で入れていないもの）
function docValues(d) {
  const sv = cur.file.docs?.[d.id], I = infoVals(), P = docPrefill(d);
  const v = { ...P.v, ...(sv?.values || {}) }, from = {};
  for (const f of d.fields) {
    if (f.info) { v[f.id] = I[f.info] || ''; if (!(f.info in (cur.file.info || {})) && filled(v[f.id])) from[f.id] = '診断の答え・記録から'; }
    else if (P.from[f.id] && !(f.id in (sv?.values || {}))) from[f.id] = P.from[f.id];
  }
  return { v, from };
}
// 今の段階に合う下書き：結果の「まずすること」「ほかの方法」から案内している下書き（次の一手があれば、いちばん新しい回の結果）
function recommendedDocs() {
  const rs = (cur.file.rounds || []).filter(x => x.done);
  const lastR = rs.at(-1);
  const [data, state, rid] = lastR ? [cur.next, lastR.state, lastR.id] : [cur.data, cur.file.state, 'main'];
  if (state?.node !== E.RESULT) return [];
  const { fresh } = N.splitActions(E.compose(data, state.facts).todo, N.usedKeys(cur.file, rid));
  return [...new Set(fresh.slice(0, 3).flatMap(c => (c.links || []).filter(l => l.type === 'doc').map(l => l.doc)))];
}

function viewDocs() {
  const { file } = cur;
  const ds = allDocs(), rec = recommendedDocs();
  const item = d => `<a class="btn big left" href="#/f/${file.id}/doc/${d.id}"><b>${esc(d.title)}</b><br><small>${esc(d.desc)}</small></a>`;
  const top = rec.map(id => ds.find(d => d.id === id)).filter(Boolean), others = ds.filter(d => !rec.includes(d.id));
  setView(`<p class="crumb"><a href="${lastResult(file)}">結果に戻る</a></p>
    <h1>文書の下書きを作る</h1><p class="help">${short(fileName(file), 40)}</p>
    <p class="note">入力した事実だけで文章を組み立てます。入力していないことは書きません。出す前に必ず読み直して直してください。</p>
    ${top.length ? `<h2>今の行動に合う文書</h2><div class="stack">${top.map(item).join('')}</div>
      <details class="more"><summary>ほかの文書を作る（${others.length}種類）</summary><div class="stack">${others.map(item).join('')}</div></details>`
      : `<div class="stack">${others.map(item).join('')}</div>`}
    <h2>届け方は「声を届ける」で</h2><p class="help">文章はこのサイトで作れます。電話のかけ方、メール・手紙の送り方、情報公開請求・請願・陳情・パブコメの手続きは、姉妹サイト「声を届ける」で案内しています（別タブで開きます。この画面はそのまま残ります）。</p>
    ${linksBlock([{ type: 'todokeru-guide', guide: 'phone', section: 'manual', label: '電話のかけ方' }, { type: 'todokeru-guide', guide: 'email', section: 'manual', label: 'メール・手紙の送り方' }, { type: 'todokeru-contacts', label: '窓口を探す' }])}`, '文書の下書き');
}

function viewDoc(docId) {
  const { file } = cur;
  const d = allDocs().find(x => x.id === docId);
  if (!d) return viewDocs();
  const saved = file.docs?.[docId];
  const { v: values, from } = docValues(d);
  const text = saved?.edited ? saved.text : renderDoc(d, values);
  const field = f => {
    const v = esc(values[f.id] || '');
    const input = f.type === 'textarea' ? `<textarea id="f-${f.id}" data-act="field" data-f="${f.id}" rows="3" placeholder="${esc(f.placeholder || '')}">${v}</textarea>`
      : `<input id="f-${f.id}" type="${f.type === 'date' ? 'date' : 'text'}" data-act="field" data-f="${f.id}" value="${v}" placeholder="${esc(f.placeholder || '')}">`;
    return `<div class="field"><label for="f-${f.id}">${esc(f.label)}${f.info ? ' <small class="inl">（共通）</small>' : ''}${f.optional ? ' <small class="inl">（なくても可）</small>' : ''}${from[f.id] ? ` <span class="tag">引き継ぎ：${esc(from[f.id])}</span>` : ''}</label>${f.help ? `<small>${esc(f.help)}</small>` : ''}${input}</div>`;
  };
  const hasInfo = d.fields.some(f => f.info), anyFrom = Object.keys(from).length;
  const checks = saved?.checks || {};
  setView(`<p class="crumb"><a href="${lastResult(file)}">結果に戻る</a> › <a href="#/f/${file.id}/doc">文書の一覧</a></p>
    <h1>${esc(d.title)}</h1><p class="help">${esc(d.desc)}</p>
    ${saveState()}
    <div class="seg noprint" role="group" aria-label="表示の切り替え"><button class="btn slim" data-act="pane" data-p="in" aria-pressed="true">1. 入力する</button><button class="btn slim" data-act="pane" data-p="out" aria-pressed="false">2. 下書きを確認</button></div>
    <section id="pane-in" class="card plainc pane noprint"><h2>1. 事実を入れる</h2>
      <p class="note">わかることだけ入れてください。空欄の項目は、その行（見出しも）ごと文章に入りません。あいさつなど決まった文は残ります。${hasInfo ? '（共通）の欄は、この相談のほかの下書きと結果の文例にも入ります。' : ''}${anyFrom ? '「引き継ぎ」の欄は、これまでの答えや地域の設定から入れています。違っていたら直してください。' : ''}</p>
      ${d.fields.map(field).join('')}
      <button class="btn mobile-only" data-act="pane" data-p="out">下書きを確認する →</button></section>
    <section id="pane-out" class="card plainc pane"><h2 class="noprint">2. できた下書き（ここで直せます）</h2>
      <p class="warn noprint" id="editwarn" role="status"${saved?.edited ? '' : ' hidden'}>手で直した下書きです。上の欄を変えても、この下書きは変わりません（手で直した内容はそのまま残ります）。<button class="btn slim" data-act="regen">欄の内容で作り直す</button></p>
      <label for="doctext" class="sr">下書きの文章</label><textarea id="doctext" class="noprint" data-act="doctext" rows="14">${esc(text)}</textarea>
      <div id="docprint" class="printonly pre">${esc(text)}</div>
      <p class="help small noprint">直接直した内容も自動で保存され、画面を移っても、ブラウザを閉じても残ります。</p>
      <div class="noprint"><h3>出す前の確認</h3><ul class="checklist">${(d.checks || []).map((c, i) => `<li><label><input type="checkbox" data-act="doccheck" data-i="${i}"${checks[i] ? ' checked' : ''}> ${esc(c)}</label></li>`).join('')}</ul>
      <p class="help small">確認が終わっていなくても、下書きは保存されています。確認してから、コピー・保存して使ってください。</p>
      <div class="row wrap"><button class="btn primary" data-act="copydoc">この文書をコピー</button><button class="btn" data-act="savedoc">テキストで保存</button><button class="btn" data-act="print">この文書を印刷・PDF</button></div></div>
      <button class="btn mobile-only noprint" data-act="pane" data-p="in">← 入力に戻る</button></section>
    ${deliverBlock(d)}
    <section class="card plainc noprint"><h2>送ったら・伝えたら</h2><p class="help">送った日と相手を記録しておくと、回答がないときに次の方法を考えやすくなります。</p>
      <a class="btn" href="#/f/${file.id}/records?add=1&doc=${encodeURIComponent(d.id)}">送ったことを記録する</a></section>`, d.title);
  main.dataset.pane = 'in';
}
// 3. 伝える・届ける：電話・メールなど届け方ごとに分けたボタン（deliver）か、ボタンだけ（links）
function deliverBlock(d) {
  const groups = d.deliver || (d.links ? [{ links: d.links }] : []);
  if (!groups.length) return '';
  const toTodokeru = groups.some(g => g.links.some(l => l.type.startsWith('todokeru')));
  return `<section class="card plainc noprint"><h2>3. ${d.deliver ? '伝える' : '届ける'}</h2>
    ${groups.map(g => g.title ? `<div class="box deliver"><h3>${esc(g.title)}</h3>${g.note ? `<p class="help">${esc(g.note)}</p>` : ''}${linksBlock(g.links)}</div>` : linksBlock(g.links)).join('')}
    ${toTodokeru ? '<p class="note">「別タブ」のボタンは、姉妹サイト「声を届ける」を新しいタブで開きます。この画面と下書きはそのまま残るので、終わったらこのタブに戻ってください。文章はこのページで完成しているので、作り直す必要はありません。</p>' : ''}</section>`;
}

// ---------- 画面：記録 ----------
function recLabels() {
  const L = cur.data.ladder, C = cur.next?.ladder?.commonRecordTypes || {};
  return { toType: { ...(L.recordTypes || {}), ...Object.fromEntries(Object.entries(C).filter(([k]) => !(L.recordTypes || {})[k])) }, method: L.methods || {}, state: L.states || {}, result: resultTypes() };
}
// 相手の回答の種類：次の一手の「どんな結果でしたか」と同じ選択肢（記録すると、次の一手でその質問を聞かない）
function resultTypes() {
  const t = cur.next?.tree, n = t?.nodes?.result;
  return n ? Object.fromEntries(E.optionsOf(t, n, {}).map(o => [o.value, plain(o.short || o.label)])) : {};
}
// 相手の種類：「相手」と「手段」に分けて並べ、「その他」は最後に置く
const MEANS = ['disclosure', 'petition', 'pubcome', 'shomei', 'shinsa', 'chotei', 'kansa'];
function typeSelect(map, val) {
  const o = k => `<option value="${k}"${k === val ? ' selected' : ''}>${esc(map[k])}</option>`;
  const ks = Object.keys(map), who = ks.filter(k => !MEANS.includes(k) && k !== 'other'), how = ks.filter(k => MEANS.includes(k));
  return `<select id="r-toType" name="toType"><option value="">選んでください（わからなければ空欄）</option><optgroup label="相手">${who.map(o).join('')}</optgroup>${how.length ? `<optgroup label="手段">${how.map(o).join('')}</optgroup>` : ''}${map.other ? o('other') : ''}</select>`;
}
// 対応の記録：①これからすること（予定） ②最近の記録 ③相談全体の今の状態 ④記録を追加（押したときだけ入力欄） ⑤過去の記録・書き出し
// editId：編集する記録。q.add：追加の入力欄を開く／q.done：予定を「実施した」にする／q.doc：送った文書の名前を入れておく
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '');
function recSummary(r, L) {
  return [(r.toType === 'other' && !r.toName ? '' : (L.toType[r.toType] || '')) + (r.toName ? `（${r.toName}）` : ''), L.method[r.method], L.result[r.resultType]].filter(Boolean).join('・');
}
function viewRecords(editId, q = {}, keep = false) {
  const { file, data } = cur;
  const L = recLabels();
  const st = currentStatus(file), sl = (file.statusLog || []).at(-1);
  const lad = ladderState(data.ladder, file.state.facts, file.records);
  const all = file.records || [];
  const planned = all.filter(r => isPlanned(r)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const did = all.filter(r => !isPlanned(r)).sort(byDateDesc);
  const recent = did.slice(0, 3), past = did.slice(3);
  // 書きかけ（このブラウザに自動で残している、まだ保存していない入力）
  const dr = S.getUi().drafts?.[file.id];
  const target = editId || (!q.add && dr?.id) || '';
  const ed = target ? all.find(r => r.id === target) : null;
  const useDraft = dr && (dr.id || '') === (ed?.id || '') && !q.doc && !q.cl;
  const doc = q.doc && allDocs().find(x => x.id === q.doc);
  // q.cl：チェックリストの項目から記録する（項目の文と、相手の種類を入れておく）
  const cl = q.cl && (cur.data.checklists || []).find(x => x.id === q.cl);
  const base = ed ? { ...ed } : { date: today(), toType: cl?.rec?.[0] || '', method: '', state: '', content: doc ? `「${doc.title}」を送った・伝えた` : cl ? `チェックリスト「${plain(fill(cl.text, { facts: file.state?.facts || {} }))}」について：` : '' };
  if (q.done && ed) Object.assign(base, { date: today(), state: ed.state === 'todo' ? 'doing' : ed.state });
  const v = useDraft ? { ...base, ...dr.values } : base;
  const formOpen = !!(ed || q.add || useDraft);
  const sel = (name, map, val, empty = '選んでください') => `<select id="r-${name}" name="${name}"><option value="">${empty}</option>${Object.entries(map).map(([k, x]) => `<option value="${k}"${k === val ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  const planNow = ed && isPlanned(ed) && !q.done;
  const formTitle = q.done ? '実施したことを記録する' : ed ? (planNow ? '予定を変更する' : '記録を編集') : '記録を追加';
  const form = `<section class="card plainc" id="recsec"><h2>${formTitle}</h2>
    ${useDraft ? '<p class="note" role="status">書きかけの内容を戻しました（まだ保存していません）。</p>' : ''}
    <form id="recform" data-id="${esc(ed?.id || '')}" data-mode="${q.done ? 'done' : ''}">
      <div class="field"><label for="r-date">${planNow ? '予定の日' : 'いつ'}</label><input id="r-date" type="date" name="date" value="${esc(v.date || '')}"></div>
      <div class="field"><label for="r-content">${planNow ? '予定していること' : '何をした'}</label><textarea id="r-content" name="content" rows="2" placeholder="例：管理会社に電話した">${esc(v.content || '')}</textarea></div>
      ${planNow ? '' : `<div class="field"><label for="r-response">どうなった <small class="inl">（相手の回答・様子。まだなければ空欄）</small></label><textarea id="r-response" name="response" rows="2" placeholder="例：「確認して連絡する」と言われた">${esc(v.response || '')}</textarea></div>`}
      <details class="more"${ed && !planNow ? ' open' : ''}><summary>くわしく（相手・方法・回答の種類など。なくても保存できます）</summary>
        <div class="field"><label for="r-toType">相手・手段</label>${typeSelect(L.toType, v.toType)}</div>
        <div class="field"><label for="r-toName">相手の部署・名前 <small class="inl">（なくても可）</small></label><input id="r-toName" name="toName" value="${esc(v.toName || '')}" placeholder="〇〇区 生活衛生課"></div>
        <div class="field"><label for="r-method">方法</label>${sel('method', L.method, v.method)}</div>
        ${planNow ? '' : `<div class="field"><label for="r-resultType">相手の回答の種類 <small class="inl">（なくても可）</small></label>${sel('resultType', L.result, v.resultType, 'まだない・選ばない')}</div>`}
        <div class="field"><label for="r-state">この相手とのやりとり</label>${sel('state', L.state, v.state, planNow ? 'これからする（予定）' : '自動（回答があれば「回答があった」）')}</div>
        <div class="field"><label for="r-next">次にすること <small class="inl">（なくても可）</small></label><textarea id="r-next" name="next" rows="2">${esc(v.next || '')}</textarea></div>
      </details>
      <p class="err" id="err" role="alert"></p>
      <div class="row wrap"><button class="btn primary" type="submit">${ed ? '保存する' : '記録を保存'}</button><button class="btn" type="button" data-act="recCancel">やめる${useDraft ? '（書きかけを捨てる）' : ''}</button></div>
      <p class="help small">入力中の内容は自動で書きかけとして残るので、画面を移っても消えません。</p>
    </form></section>`;
  const planItem = r => `<li class="plan"><b>${esc(r.content || 'やること')}</b><span class="meta">${esc([recSummary(r, L), r.date && r.date > today() ? `${fmtDay(r.date)}の予定` : ''].filter(Boolean).join('・'))}</span>
    <div class="row wrap"><a class="btn slim primary" href="#/f/${file.id}/records/${r.id}?done=1">実施した</a><a class="btn slim" href="#/f/${file.id}/records/${r.id}">変更</a><button class="btn slim" data-act="cancelplan" data-id="${r.id}">取り消す</button></div></li>`;
  const recItem = r => `<article class="card plainc rec"><b>${esc(r.date || '日付なし')}</b>　${r.auto ? '<span class="tag">次の一手の答えから自動で追加</span>' : ''}${esc([recSummary(r, L), L.state[r.state]].filter(Boolean).join('・'))}
    ${r.content ? `<p><small>したこと・伝えた内容</small><br>${esc(r.content)}</p>` : ''}${r.response ? `<p><small>どうなった（回答）</small><br>${esc(r.response)}</p>` : ''}${r.next ? `<p><small>次にすること</small><br>${esc(r.next)}</p>` : ''}
    <div class="row noprint"><a class="btn slim" href="#/f/${file.id}/records/${r.id}">記録を編集</a><button class="btn slim" data-act="delrec" data-id="${r.id}">削除</button></div></article>`;
  // 相談全体の状態ごとの案内（「次の一手を探す」はこの画面に1つだけ）
  const openR = (file.rounds || []).find(x => !x.done), rz = resumeOf(file);
  const nextBtn = openR ? `<a class="btn primary" href="${rz.href}">${esc(rz.label)}</a>` : `<a class="btn primary" href="#/f/${file.id}/next/new">次の一手を探す（記録を引き継ぎます）</a>`;
  let panel = '';
  if (st === 'resolved') panel = `<div class="box ok"><b>相談全体を「解決した」にしています。</b><p>記録はこのブラウザに残ります。また起きたときは、この相談から再開できます。</p>
    ${planned.length ? `<p>まだしていない予定が${planned.length}件あります。上の「これからすること」で1件ずつ取り消すか、まとめて取り消せます。残しておいても、実施済みにはなりません。</p><button class="btn" data-act="cancelall">残った予定をすべて取り消す</button>` : ''}
    <div class="row wrap"><a class="btn primary" href="#/">記録を残して終了（トップへ）</a><button class="btn" data-act="reopen">また起きたので再開する</button></div></div>`;
  else if (st === 'paused') panel = `<div class="box"><b>今は休んでいます。</b><p>答え・記録・下書きはこのまま残ります。再開するときは、トップの「続きから」かこのボタンから。</p><button class="btn" data-act="reopen">再開する</button></div>`;
  else if (st === 'waiting') {
    const w = sl?.wait || {}, over = w.due && w.due < today();
    panel = `<div class="box"><b>回答を待っています</b><ul class="points">${w.sent ? `<li>連絡した日：${esc(w.sent)}</li>` : ''}${w.to ? `<li>相手：${esc(w.to)}</li>` : ''}${w.due ? `<li>回答の予定日：${esc(w.due)}（${esc(DUE_TYPES[w.dueType] || '種類は未選択')}）</li>` : '<li>回答の予定日：未定</li>'}</ul>
      ${over ? `<p class="warn">予定日を過ぎています。回答の状況を問い合わせるか、別の方法を考えましょう。</p>${nextBtn}` : '<p class="help">回答が来たら「記録を追加」で残してください。予定日を過ぎても回答がなければ、次の一手を探せます。</p>'}</div>`;
  } else if (['partial', 'same', 'worse'].includes(st)) panel = `<div class="box"><b>「${esc(STATUS.find(s => s.value === st).label)}」にしています。</b><p>これまでの答えと記録を引き継いで、次の方法を探せます。</p>${nextBtn}</div>`;
  else panel = `${lad.next ? `<div class="box"><b>次の段階の例：${esc(lad.next.title)}</b><p>${rich(lad.next.body)}</p>${linksBlock(lad.next.links, { skipNext: true })}</div>` : ''}<p class="help">うまくいかなかったとき（回答がない・断られたなど）は：</p>${nextBtn.replace('btn primary', 'btn')}`;
  const warnRep = lad.repeated.length && !['resolved', 'paused'].includes(st) ? `<p class="warn">${lad.repeated.map(t => esc((L.toType[t.toType] || '') + (t.toName ? `（${t.toName}）` : ''))).join('・')}には2回以上相談しています。同じ相談を繰り返すより、回答の内容を記録して、別の方法を考えましょう。</p>` : '';
  const lastLink = lastResult(file);
  const waitForm = `<div id="waitform" class="box" hidden><b>回答待ちの内容</b>
    <div class="field"><label for="w-sent">連絡した日</label><input id="w-sent" type="date" value="${esc(sl?.wait?.sent || did[0]?.date || today())}"></div>
    <div class="field"><label for="w-to">相手</label><input id="w-to" value="${esc(sl?.wait?.to || (did[0] ? recSummary(did[0], L) : ''))}"></div>
    <div class="field"><label for="w-due">回答の予定日 <small class="inl">（わからなければ空欄）</small></label><input id="w-due" type="date" value="${esc(sl?.wait?.due || '')}"></div>
    <div class="field"><label for="w-type">予定日の種類</label><select id="w-type"><option value="">選んでください</option>${Object.entries(DUE_TYPES).map(([k, x]) => `<option value="${k}"${sl?.wait?.dueType === k ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select><small>法律などで決まった期限・相手が示した予定・自分で決めた目安は、意味が違うので分けて残します。</small></div>
    <button class="btn primary" data-act="savewait">回答待ちとして保存</button></div>`;
  setView(`<p class="crumb"><a href="${lastLink}">結果に戻る</a></p>
    <h1>対応の記録</h1>
    <p class="help">${short(fileName(file), 40)}</p>
    ${saveState()}
    <section><h2>これからすること${planned.length ? `（予定 ${planned.length}件）` : ''}</h2>
      ${planned.length ? `<ul class="plans">${planned.map(planItem).join('')}</ul>` : '<p class="note">予定はありません。結果の画面の「やることに追加」で、ここに入ります。</p>'}</section>
    <section><h2>最近の記録</h2>${recent.map(recItem).join('') || '<p class="note">まだ記録はありません。</p>'}</section>
    <section class="card plainc"><h2>相談全体の今の状態</h2><p class="help">1回のやりとりではなく、困りごと全体がどうなっているかを選びます。</p>
      <div class="row wrap">${STATUS.map(s => `<label class="pill"><input type="radio" name="status" value="${s.value}"${st === s.value ? ' checked' : ''} data-act="status"> ${s.label}</label>`).join('')}</div>
      ${waitForm}
      ${(file.statusLog || []).length ? `<details><summary>状態の変化（${file.statusLog.length}件）</summary><ul>${file.statusLog.map(s => `<li>${esc(s.date)}：${STATUS.find(x => x.value === s.status)?.label || ''}</li>`).join('')}</ul></details>` : ''}
      ${panel}${warnRep}</section>
    ${formOpen ? form : `<button class="btn big primary" data-act="recAdd">＋ 記録を追加</button>`}
    ${past.length ? `<details class="more"><summary>過去の記録（${past.length}件）</summary>${past.map(recItem).join('')}</details>` : ''}
    <section class="noprint"><h2>保存・書き出し</h2><div class="row wrap"><button class="btn" data-act="savetxt">この相談の記録をテキストで保存</button><button class="btn" data-act="print">この記録を印刷・PDF</button></div>
      <p class="note">記録はこのブラウザに自動で保存されています。テキストやPDFは読むためのファイルで、ここから相談を戻すことはできません。別の端末やブラウザへ引き継ぐときは、<a href="#/data">保存した相談</a>の「バックアップを保存」を使います。</p></section>`, '対応の記録', keep);
  if (formOpen && (q.add || q.done || editId)) { const f = document.getElementById(q.done ? 'r-response' : 'r-content'); f?.focus({ preventScroll: true }); f?.scrollIntoView({ block: 'center' }); }
}

// ---------- 画面：その他 ----------
function viewEmergency() {
  setView(`<h1>まず安全を確保してください</h1>
    <div class="box danger"><p>けんか・暴力・不審者の侵入など：<a class="tel" href="tel:110">110</a></p><p>火事・けが・急病：<a class="tel" href="tel:119">119</a></p>
    <p>緊急ではない警察への相談：<a class="tel" href="${telHref('#9110')}">#9110</a></p>
    <p>子どもが「死にたい」と言う・いじめで追い詰められているなど（夜間・休日も、子ども本人も保護者も）：24時間子供SOSダイヤル <a class="tel" href="${telHref('0120-078310')}">0120-078310</a></p></div>
    <ul class="points"><li>相手に直接詰め寄らず、離れた安全な場所から連絡してください</li><li>落ち着いたら、いつ・何が起きたかをメモしておくと、後の相談に役立ちます</li></ul>
    <button class="btn big" data-act="histback">前の画面に戻る</button>`, '緊急のとき');
}

// 保存した相談：自動保存・読むための保存・復元用の保存（バックアップ）の違いと、相談ごとの管理・削除した相談・全件削除
let pendingRestore = null;
async function viewData(confirming = false, msg = '') {
  const files = S.listFiles(), trash = S.listTrash(), pb = S.problem();
  const closed = f => ['resolved', 'paused'].includes(currentStatus(f));
  const act = files.filter(f => !closed(f)), done = files.filter(closed);
  const P = pendingRestore;
  const restoreBox = P ? `<div class="box warn-box" id="restorebox"><b>バックアップの中身（${P.add.length + P.replace.length + P.keep.length}件${P.exportedAt ? `・${fmtDate(P.exportedAt)} 作成` : ''}）</b>
      <ul class="points"><li>新しく加える相談：${P.add.length}件</li><li>このブラウザの内容を、ファイルの新しい内容で置き換える相談：${P.replace.length}件</li><li>そのままにする相談（このブラウザの方が新しいか同じ）：${P.keep.length}件</li>${P.invalid ? `<li>形が正しくなく、読み込まない相談：${P.invalid}件</li>` : ''}</ul>
      <p>このブラウザにある、ほかの相談は消しません。</p>
      <div class="row wrap">${P.add.length + P.replace.length ? `<button class="btn primary" data-act="restoreGo">この内容で戻す</button>` : ''}<button class="btn" data-act="restoreNo">やめる</button></div></div>` : '';
  setView(`<p class="crumb"><a href="#/">トップ</a></p><h1>保存した相談</h1>
    ${msg ? `<p class="note" role="status">${esc(msg)}</p>` : ''}
    ${pb.rescued ? `<div class="box warn-box"><b>読み込めなかった保存データがあります（${pb.rescued}文字）。</b><p>壊れているなどの理由で読み込めなかったデータを、消さずに別に残しています。ファイルに保存しておくと、あとで調べられます。</p>
      <div class="row wrap"><button class="btn" data-act="rescueDl">そのデータをファイルに保存</button><button class="btn" data-act="rescueDel">そのデータを削除する</button></div></div>` : ''}
    <details class="more" open><summary>3つの「保存」の違い</summary>
      <dl><dt>自動保存（このブラウザの中）</dt><dd>答え・記録・下書きは、操作のたびにこのブラウザの中に保存されます。サーバーには送りません。同じ端末の同じブラウザで続けられます。</dd>
      <dt>読むための保存（テキスト・印刷／PDF）</dt><dd>記録や文書を読んだり、人に見せたりするためのファイルです。このファイルから相談を戻すことはできません。</dd>
      <dt>復元用の保存（バックアップ・.json）</dt><dd>すべての相談の答え・記録・下書き・チェック・状態が入ります。別の端末やブラウザへ引き継ぐときや、消えてしまったときに、下の「バックアップから戻す」で戻せます。</dd></dl>
      <p class="help small">ブラウザの履歴やサイトのデータを消すと、自動保存した内容も消えます。iPhone・iPad の Safari では、しばらく（7日ほど）このサイトを開かないと消されることがあります。大切な記録はバックアップを保存してください。</p></details>
    <h2>進行中の相談（${act.length}件）</h2>
    ${act.length ? await fileList(act, { manage: true }) : '<p class="note">ありません。</p>'}
    ${done.length ? `<h2>解決した・休んでいる相談（${done.length}件）</h2>${await fileList(done, { manage: true })}` : ''}
    <h2>バックアップ</h2>
    <div class="stack"><button class="btn" data-act="backup"${files.length ? '' : ' disabled'}>バックアップを保存（相談${files.length}件・.json）</button>
    <label class="btn">バックアップから戻す（ファイルを選ぶ）<input type="file" accept=".json,application/json" data-act="restore" class="sr"></label></div>
    ${restoreBox}
    ${trash.length ? `<h2>削除した相談（${trash.length}件）</h2><p class="help">削除してから30日間は、元に戻せます。</p><ul class="files">${trash.map(t => `<li><div class="fi"><b>${short(fileName(t.file), 34)}</b><span class="meta">${fmtDate(t.deletedAt)} に削除</span></div><div class="row wrap fa"><button class="btn slim primary" data-act="undel" data-id="${t.file.id}">元に戻す</button><button class="btn slim" data-act="purge" data-id="${t.file.id}">完全に削除</button></div></li>`).join('')}</ul>` : ''}
    <details class="more danger-zone"${confirming ? ' open' : ''}><summary>このサイトのデータをすべて削除する</summary>
      <p>このブラウザにある、このサイトのデータをすべて消します：相談${files.length}件（答え・記録・下書き・チェック・状態）、削除した相談${trash.length}件、地域の設定。<b>元に戻せません。</b>ほかのサイトのデータには触れません。</p>
      ${confirming ? `<p class="warn">本当にすべて削除しますか？ 必要なら、先にバックアップを保存してください。</p><div class="row wrap"><button class="btn danger" data-act="wipe2">すべて削除する（相談${files.length}件）</button><a class="btn" href="#/data">やめる</a></div>`
        : `<div class="row wrap"><button class="btn" data-act="backup"${files.length ? '' : ' disabled'}>先にバックアップを保存</button><button class="btn" data-act="wipe">すべて削除へ進む</button></div>`}</details>
    <p class="note" id="msg" role="status"></p>`, '保存した相談');
}

function viewAbout() {
  const ss = Object.values(G.sources);
  setView(`<p class="crumb"><a href="#/">トップ</a></p><h1>このサイトについて</h1>
    <p>「${SITE}」は、暮らしの中の困りごとを整理し、合法的で具体的な最初の行動を始めるための案内サイトです（試作版）。一度行動して、断られた・回答がない・情報が出ない・請願が通らなかったときにも、理由を見立てて、次に取れる手段を探せます。</p>
    <h2>大切なお願い</h2><ul class="points"><li>診断結果は法的な判断ではありません。個別の判断は、法テラスや弁護士会、自治体の無料法律相談などの専門家に相談してください。</li>
    <li>制度の上で「できること」と、うまくいく「見込み」は別です。このサイトは結果を約束しません。根拠のある手段が見つからないときは、そのようにお伝えします。</li>
    <li>法律や条例は変わります。各案内の「根拠と確認日」を見て、最新の情報を窓口で確かめてください。自治体ごとの条例は、確認できたものだけを載せ、ほかの自治体のルールを当てはめません。</li>
    <li>相手の敷地に入る、個人の情報をネットに出す、信仰や国籍などの属性を理由にした排除や嫌がらせ、詰め寄るなどの行為はしないでください。</li></ul>
    <h2>プライバシー</h2><p>入力内容はこの端末の中だけに保存し、外部へは送りません。ほかのサイトへ移るときも、入力した内容はURLに入れません。アクセス解析も使っていません。</p>
    <h2>根拠資料（${ss.length}件）</h2><ul>${ss.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <small>${KIND[s.kind] || ''}・確認日 ${esc(s.checked)}</small></li>`).join('')}</ul>`, 'このサイトについて');
}

// ---------- 道順 ----------
// #/f/{相談}/q/{n}：最初の診断の n 問目 ／ #/f/{相談}/next/{回}/q/{n}：次の一手の n 問目 ／ ?edit=1：結果から「直す」で来た
async function route() {
  track(location.hash || '#/');
  const [, a, b, c, d, e, f] = (location.hash.slice(1).split('?')[0] || '/').split('/');
  const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  // 画面を移ると、保存していなかった変更は捨てて最新の内容を読み直すので、食い違いの知らせも消す
  if (S.conflict && (a !== 'f' || cur?.file?.id !== b)) { S.clearConflict(); const bar = document.getElementById('savebar'); if (bar) bar.hidden = true; }
  try {
    if (a !== 'f') cur = null;
    if (!a) return await viewHome();
    if (a === 'start') return await viewStart(b, q);
    if (a === 'act') return viewAct();
    if (a === 'cases' && !b) return viewCaseDomains();
    if (a === 'cases') return await viewCases(b, q);
    if (a === 'case') return await viewCase(b, c, q);
    if (a === 'emergency') return viewEmergency();
    if (a === 'data') return await viewData(false);
    if (a === 'about') return viewAbout();
    if (a === 'f') {
      const file = openFile(b); if (!file) return;
      cur = { file, data: await loadDomain(file.domain), next: await loadDomain(N.NEXT_DOMAIN), round: null, qn: 0, edit: q.edit === '1' };
      migrateOpen(file);
      if (c === 'q') { cur.qn = +d || 0; return viewQuestion(); }
      if (c === 'result') return viewResult();
      if (c === 'doc') return d ? viewDoc(d) : viewDocs();
      if (c === 'records') return viewRecords(d, q);
      if (c === 'next') {
        const rounds = file.rounds || [];
        if (!d || d === 'new') {
          // 途中の回があれば、新しく作らずに続きへ
          const open = rounds.find(r => !r.done);
          if (open) { swap(resumeOf(file).href); return; }
          return startRound();
        }
        cur.round = rounds.find(r => r.id === d) || (draft?.fileId === file.id && draft.round.id === d ? draft.round : null);
        if (!cur.round) { swap(`#/f/${file.id}/result`); return; }
        if (e === 'q') { cur.qn = +f || 0; return viewQuestion(); }
        return viewResult();
      }
      return swap(resumeOf(file).href);
    }
    await viewHome();
  } catch (err) {
    setView(`<h1>表示できませんでした</h1><p>${esc(err.message)}</p><a class="btn" href="#/">トップへ</a>`);
  }
}

// ---------- 操作 ----------
const safeName = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
const ymd = () => new Date().toLocaleDateString('sv-SE');
// 予定の取り消し：記録から消し、その行動を「選んだこと」からも外す（取り消した行動は、また提案してよい）
function dropPlans(ids) {
  const f = cur.file, rs = (f.records || []).filter(r => ids.includes(r.id));
  for (const r of rs) {
    const h = r.round && r.round !== 'main' ? (f.rounds || []).find(x => x.id === r.round) : f;
    if (h && r.actionKey) h.chosen = (h.chosen || []).filter(k => k !== r.actionKey);
  }
  f.records = (f.records || []).filter(r => !ids.includes(r.id));
}
// 行動カードから予定に入れるとき、相手の名前：確認できた地域の窓口があれば、その名前
function contactNameFor(card, facts) {
  const a = focusArea(cur.file.region);
  if (!a || kindOf(card, { facts }) !== 'contact') return '';
  const where = plain(fillText(card.where, facts));
  if (!(card.region === 'gov' || (card.region === undefined && /自治体|保健所|担当課|担当窓口|役所|市区町村/.test(where)))) return '';
  const bt = facts.biz_type, hs = card.handles || (FACILITY.includes(bt) ? [bt] : FACILITY);
  const x = a.contacts.find(y => !y.handles?.length || y.handles.some(h => hs.includes(h)));
  if (!x) return '';
  const dept = x.dept.replace(/（[^）]*）$/, '');
  return dept.startsWith(a.name || ' ') ? dept : `${a.name || ''} ${dept}`.trim();
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'button')) return;
  const act = t.dataset.act;
  if (act === 'check3') {
    // 状態つきチェックリスト：済／これから／不要。押した状態を保存し、その項目と件数だけ書き換える
    const li = t.closest('li'), v = t.dataset.v;
    cur.file.checks = { ...cur.file.checks, [t.dataset.id]: v }; save();
    li.dataset.st = v;
    li.querySelectorAll('[data-act=check3]').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
    const box = t.closest('[data-cl]');
    box.querySelector('.cnt').textContent = clCount([...box.querySelectorAll('li[data-st]')].map(x => x.dataset.st));
    return;
  }
  if (act === 'startans') {
    const dom = t.dataset.domain, v = t.dataset.v;
    const [data, next] = await Promise.all([loadDomain(dom), loadDomain(N.NEXT_DOMAIN)]);
    const n0 = data.tree.nodes[data.tree.start];
    // 同じ分野・同じ状況の相談がすでにあれば、続きから／新しく始める を選んでもらう（同じ相談を重複して作らない）
    const same = S.listFiles().filter(f => f.domain === dom && f.state?.facts?.[n0.fact] === v && currentStatus(f) !== 'resolved');
    if (same.length && !t.dataset.force) {
      const box = document.getElementById('dup');
      const label = E.optionsOf(data.tree, n0).find(o => o.value === v)?.label || '';
      box.innerHTML = `<div class="box warn-box" role="alert"><b>「${esc(plain(label))}」の相談が保存されています。</b><p>続きからなら、下の相談の再開ボタンを押してください。</p>${await fileList(same.slice(0, 3))}
        <button class="btn" data-act="startans" data-domain="${dom}" data-v="${esc(v)}" data-force="1">別の相談として新しく始める</button></div>`;
      box.scrollIntoView({ block: 'center' });
      return;
    }
    // 保存データは1問目に答えたこの時点で作る。分野のページの履歴は1問目の画面に置き換える（戻るで1問目に戻れるように）
    const f = S.createFile(dom, E.begin(data.tree), { region: S.getSettings().region || null });
    saved();
    const h1 = `#/f/${f.id}/q/1`;
    history.replaceState(null, '', h1); trail[trail.length - 1] = h1;
    cur = { file: f, data, next, round: null, qn: 1, edit: false };
    doAnswer(v);
  }
  else if (act === 'ans') doAnswer(t.dataset.v);
  else if (act === 'multi') {
    const v = [...main.querySelectorAll('fieldset input:checked')].map(x => x.value);
    if (!v.length) { document.getElementById('err').textContent = 'どれか1つ以上選んでください'; return; }
    doAnswer(v);
  }
  else if (act === 'back') {
    // 1つ前に表示した質問へ（引き継いで聞かなかった質問は飛ばす）。最初の質問なら分野のページ（次の一手なら、来た結果の画面）へ
    const c = ctx(), h = c.state.history;
    let k = cur.qn - 1;
    while (k >= 1 && h[k - 1]?.auto) k--;
    goBack(k >= 1 ? qHash(c, k) + (cur.edit ? '?edit=1' : '') : c.roundId === 'main' ? `#/start/${cur.file.domain}` : lastResult(cur.file));
  }
  else if (act === 'uninherit') {
    // 引き継いだ答えを外して、その質問も聞くようにする（元の答えには印を付けておく）
    const c = ctx(), ids = t.dataset.n.split(','), init = c.state.history[0]?.facts ?? c.state.facts, drop = f => { const o = { ...f }; ids.forEach(id => delete o[c.tree.nodes[id].fact]); return o; };
    c.holder.prev = { ...(c.holder.prev || {}), ...Object.fromEntries(ids.map(id => [id, init[c.tree.nodes[id].fact]])) };
    c.holder.state = { ...c.state, facts: drop(c.state.facts), history: c.state.history.map(h => ({ ...h, facts: drop(h.facts) })) };
    save(); route();
  }
  else if (act === 'restart') {
    const c = ctx();
    if (!confirm(c.roundId === 'main'
      ? 'この診断の答えを消して、最初の質問からやり直します。対応の記録・下書き・チェック・次の一手は消えません。よろしいですか？'
      : 'この「次の一手」の答えを消して、最初の質問からやり直します。対応の記録・下書きは消えません。よろしいですか？')) return;
    if (c.roundId === 'main') c.holder.state = E.begin(c.tree);
    else c.holder.state = N.newRound(c.tree, { ...cur.file, rounds: (cur.file.rounds || []).filter(r => r.id !== c.roundId) }, c.roundId).state;
    c.holder.done = c.holder.state.node === E.RESULT; c.holder.prev = {};
    if (c.roundId === 'main') cur.file.done = false;
    if (!save()) return;
    go(c.holder.done ? resultHash(c) : qHash(c, c.holder.state.history.length + 1));
  }
  else if (act === 'choose') {
    const c = ctx();
    const card = c.data.cards.find(x => x.id === t.dataset.id);
    if (!card) return;
    const key = card.key || card.id;
    const recs = cur.file.records || [];
    // 同じ行動の予定がすでにあれば、重ねて入れない（連打・画面の往復でも1件だけ）
    if (!recs.some(r => r.actionKey === key && r.round === c.roundId && isPlanned(r))) {
      const L = recLabels(), facts = c.state.facts;
      cur.file.records = [...recs, { id: S.newId(), date: today(), toType: N.recTypeFor({ ...card, title: plain(fillText(card.title, facts)) }, L.toType), toName: contactNameFor(card, facts), method: '', content: plain(fillText(card.title, facts)), response: '', next: '', state: 'todo', actionKey: key, round: c.roundId }];
    }
    c.holder.chosen = [...new Set([...(c.holder.chosen || []), key])];
    if (!save()) return;
    t.outerHTML = `<p class="note" role="status">やることに追加しました。実施したら、対応の記録の「実施した」から、日付と結果を書き足せます。<a href="#/f/${cur.file.id}/records">対応の記録で見る</a></p>`;
  }
  else if (act === 'term') {
    const box = t.closest('details, .box, main')?.querySelector('.termbox') || main.querySelector('.termbox');
    const gl = cur?.round ? { ...cur.data.glossary, ...cur.next.glossary } : { ...(cur?.next?.glossary || {}), ...(cur?.data?.glossary || {}) };
    let txt = gl[t.dataset.term];
    if (!txt && !cur) { const dom = location.hash.split('/')[2]?.split('?')[0]; txt = cache[dom]?.glossary?.[t.dataset.term] || cache[N.NEXT_DOMAIN]?.glossary?.[t.dataset.term]; }
    if (box) {
      // 説明は、押した言葉のある段落のすぐ下に出す（スマホで離れた場所に出ると気づけないため）
      const at = t.closest('p, li, dd, h2, h3, .opt-terms');
      const same = !box.hidden && box.dataset.term === t.dataset.term && box._at === at;
      if (at && !same) { if (at.matches('li, dd')) at.append(box); else at.after(box); }
      box._at = at; box.hidden = same; box.dataset.term = t.dataset.term;
      box.innerHTML = `<b>${esc(t.dataset.term)}</b>：${esc(txt || '説明を準備中です。')}`;
      if (!same) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  else if (act === 'copy') copy(t.dataset.text, t);
  else if (act === 'copydoc') copy(document.getElementById('doctext').value, t);
  else if (act === 'savedoc') { const d = allDocs().find(x => x.id === location.hash.split('/')[4]); download(`下書き_${safeName(d?.title || '文書')}_${ymd()}.txt`, document.getElementById('doctext').value); }
  else if (act === 'regen') {
    if (!confirm('手で直した部分は消えて、上の欄の内容で下書きを作り直します。よろしいですか？')) return;
    const id = location.hash.split('/')[4]; cur.file.docs[id].edited = false; save(); viewDoc(id);
  }
  else if (act === 'pane') {
    main.dataset.pane = t.dataset.p;
    main.querySelectorAll('.seg [data-act=pane]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === t.dataset.p)));
    document.getElementById(t.dataset.p === 'in' ? 'pane-in' : 'pane-out')?.scrollIntoView({ block: 'start' });
  }
  else if (act === 'print') window.print();
  else if (act === 'savetxt') download(`対応の記録_${safeName(DOM(cur.file.domain)?.name || '相談')}_${ymd()}.txt`, recordsText(cur.file, recLabels()));
  else if (act === 'delrec') { if (!confirm('この記録を削除します。元に戻せません。よろしいですか？')) return; cur.file.records = cur.file.records.filter(r => r.id !== t.dataset.id); save(); viewRecords(undefined, {}, true); }
  else if (act === 'cancelplan') { if (!confirm('この予定を取り消します（やることの一覧から消えます）。よろしいですか？')) return; dropPlans([t.dataset.id]); save(); viewRecords(undefined, {}, true); }
  else if (act === 'cancelall') {
    const ids = (cur.file.records || []).filter(r => isPlanned(r)).map(r => r.id);
    if (!confirm(`まだしていない予定${ids.length}件を取り消します。よろしいですか？`)) return;
    dropPlans(ids); save(); viewRecords(undefined, {}, true);
  }
  else if (act === 'reopen') { cur.file.statusLog = [...(cur.file.statusLog || []), { date: today(), status: 'ongoing' }]; save(); viewRecords(undefined, {}, true); }
  else if (act === 'recAdd') go(`#/f/${cur.file.id}/records?add=1`);
  else if (act === 'recCancel') { S.setUi(u => { if (u.drafts) delete u.drafts[cur.file.id]; }); go(`#/f/${cur.file.id}/records`); }
  else if (act === 'savewait') {
    const g = id => document.getElementById(id)?.value || '';
    const wait = { sent: g('w-sent'), to: g('w-to').trim(), due: g('w-due'), dueType: g('w-type') };
    cur.file.statusLog = [...(cur.file.statusLog || []), { date: today(), status: 'waiting', wait }];
    if (save()) viewRecords(undefined, {}, true);
  }
  else if (act === 'histback') history.length > 1 ? history.back() : (location.hash = '#/');
  else if (act === 'rename') {
    const f = S.getFile(t.dataset.id); if (!f) return;
    const v = prompt('相談の名前（ファイル名には使いません）', fileName(f));
    if (v === null || !v.trim()) return;
    f.title = v.trim().slice(0, 80); f.titleCustom = true; S.putFile(f); saved(); route();
  }
  else if (act === 'delfile') {
    const f = S.getFile(t.dataset.id); if (!f) return;
    if (!confirm(`「${fileName(f)}」を削除します。削除した相談は、30日間は「保存した相談」の「削除した相談」から元に戻せます。よろしいですか？`)) return;
    S.removeFile(f.id); saved(); viewData(false, `「${fileName(f)}」を削除しました。下の「削除した相談」から元に戻せます。`);
  }
  else if (act === 'undel') { S.undelete(t.dataset.id); saved(); viewData(false, '相談を元に戻しました。'); }
  else if (act === 'purge') { if (!confirm('この相談を完全に削除します。元に戻せません。よろしいですか？')) return; S.purge(t.dataset.id); saved(); viewData(false, '完全に削除しました。'); }
  else if (act === 'backup') { const n = S.listFiles().length; download(`困りごと次どうする_バックアップ_相談${n}件_${ymd()}.json`, S.backupText(), 'application/json'); }
  else if (act === 'wipe') viewData(true);
  else if (act === 'wipe2') { const n = S.listFiles().length; S.clearAll(); pendingRestore = null; await viewData(false, `このサイトのデータをすべて削除しました（相談${n}件）。`); }
  else if (act === 'restoreGo') { const P = pendingRestore; pendingRestore = null; const ok = S.applyRestore(P); migrate(); saved(); await viewData(false, ok ? `バックアップから戻しました（加えた相談${P.add.length}件・置き換えた相談${P.replace.length}件）。` : '戻せませんでした（このブラウザに保存できません）。端末の相談はそのままです。'); }
  else if (act === 'restoreNo') { pendingRestore = null; viewData(false); }
  else if (act === 'rescueDl') download(`困りごと次どうする_読み込めなかったデータ_${ymd()}.txt`, S.rescuedText());
  else if (act === 'rescueDel') { if (!confirm('読み込めなかったデータを削除します。元に戻せません。よろしいですか？')) return; S.dropRescued(); viewData(false, '読み込めなかったデータを削除しました。'); }
  else if (act === 'cf-reload') { S.clearConflict(); document.getElementById('savebar').hidden = true; keepScroll = true; route(); }
  else if (act === 'cf-force' || act === 'cf-revive') { S.putFile(cur.file, true, true); saved(); keepScroll = true; route(); }
});

document.addEventListener('change', async e => {
  const t = e.target, act = t.dataset.act;
  if (t.matches('fieldset input[type=checkbox]') && t.checked) {
    const boxes = [...t.closest('fieldset').querySelectorAll('input')];
    if (t.dataset.ex) boxes.forEach(b => b !== t && (b.checked = false)); else boxes.forEach(b => b.dataset.ex && (b.checked = false));
    const er = document.getElementById('err'); if (er) er.textContent = '';
  }
  if (act === 'check') {
    cur.file.checks = { ...cur.file.checks, [t.dataset.id]: t.checked }; save();
    const box = t.closest('[data-cl]'); const all = box.querySelectorAll('input[data-act=check]');
    box.querySelector('.cnt').textContent = `${[...all].filter(x => x.checked).length} / ${all.length}`;
  }
  else if (act === 'doccheck') {
    const id = location.hash.split('/')[4], sv = (cur.file.docs ||= {})[id] || (cur.file.docs[id] = { values: {}, edited: false, text: '' });
    sv.checks = { ...(sv.checks || {}), [t.dataset.i]: t.checked }; save();
  }
  else if (act === 'pref' || act === 'city') {
    // 分野のページ：このブラウザの地域の設定（新しい相談の初期値）を変える。相談の中：その相談の地域だけを変える（窓口・地域の説明も描き直す）
    const prefs = G.areas?.prefs || [], old = regionNow();
    let r;
    if (act === 'pref') { const p = prefs.find(x => x.code === t.value); r = p ? { pref: p.code, prefName: p.name, code: '', cityName: '' } : null; }
    else { const p = prefs.find(x => x.code === old?.pref); const c = p?.cities.find(([k]) => k === t.value); r = { ...old, code: c ? c[0] : '', cityName: c ? c[1] : '' }; }
    if (cur?.file) { cur.file.region = r; save(); keepScroll = true; route().then(() => main.querySelector('.region-line')?.setAttribute('open', '')); }
    else { S.setSettings({ region: r }); t.closest('[data-region]').outerHTML = regionSelects(r); }
  }
  else if (act === 'status') {
    // 回答待ち：相手・日付・予定日を入れてから保存する。ほかはすぐ保存
    if (t.value === 'waiting') { const w = document.getElementById('waitform'); w.hidden = false; w.scrollIntoView({ block: 'center' }); return; }
    cur.file.statusLog = [...(cur.file.statusLog || []), { date: today(), status: t.value }];
    if (save()) viewRecords(undefined, {}, true);
  }
  else if (act === 'cfilter') { const q = new URLSearchParams(location.hash.split('?')[1] || ''); t.value ? q.set(t.dataset.k, t.value) : q.delete(t.dataset.k); location.hash = location.hash.split('?')[0] + (q.toString() ? '?' + q : ''); }
  else if (act === 'restore' && t.files[0]) {
    try { pendingRestore = S.planRestore(await t.files[0].text()); await viewData(false); document.getElementById('restorebox')?.scrollIntoView({ block: 'center' }); }
    catch (er) { pendingRestore = null; await viewData(false, er.message); }
  }
});

document.addEventListener('input', e => {
  const t = e.target, act = t.dataset.act;
  // 記録の入力欄：書きかけとして自動で残す（画面を移っても消えない。保存かやめるで消える）
  const form = t.closest('#recform');
  if (form && cur?.file) {
    const values = Object.fromEntries(new FormData(form));
    S.setUi(u => { (u.drafts ||= {})[cur.file.id] = { id: form.dataset.id || '', values }; });
    return;
  }
  if (act !== 'field' && act !== 'doctext') return;
  const id = location.hash.split('/')[4];
  const d = allDocs().find(x => x.id === id);
  if (!d) return;
  const sv = (cur.file.docs ||= {})[id] || (cur.file.docs[id] = { values: {}, edited: false, text: '' });
  if (act === 'field') {
    // 共通情報の欄は相談の共通情報へ（ほかの下書きと結果の例文にも入る）、ほかは下書きごとに保存
    const fd = d.fields.find(x => x.id === t.dataset.f);
    if (fd?.info) (cur.file.info ||= {})[fd.info] = t.value; else sv.values[t.dataset.f] = t.value;
    if (!sv.edited) document.getElementById('doctext').value = renderDoc(d, docValues(d).v);
  } else {
    // 最初に手で直したときに、その場で「以後は欄の変更が反映されない」ことを知らせる
    if (!sv.edited) { const w = document.getElementById('editwarn'); if (w) w.hidden = false; }
    sv.edited = true; sv.text = t.value;
  }
  const pr = document.getElementById('docprint'); if (pr) pr.textContent = document.getElementById('doctext').value;
  save();
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'recform') return;
  e.preventDefault();
  const form = e.target;
  if (form.dataset.busy) return;
  const fd = Object.fromEntries(new FormData(form));
  const err = m => { document.getElementById('err').textContent = m; };
  if (!fd.date) return err('「いつ」（日付）を入れてください。');
  if (!String(fd.content || '').trim() && !String(fd.response || '').trim() && !fd.toType) return err('「何をした」を入れてください。');
  const id = form.dataset.id, mode = form.dataset.mode;
  const recs = cur.file.records || [], old = id && recs.find(x => x.id === id);
  const L = recLabels();
  if (!fd.state) fd.state = old && isPlanned(old) && mode !== 'done' ? 'todo' : (String(fd.response || '').trim() || fd.resultType ? 'answered' : 'doing');
  if (fd.date > today() && fd.state !== 'todo') return err('日付が今日より先です。まだしていないことなら、「くわしく」の「この相手とのやりとり」を「これからする（予定）」にしてください。');
  if (!fd.toType) fd.toType = N.recTypeFor({ title: fd.content || '' }, L.toType);
  form.dataset.busy = '1';
  // 自動で追加した記録も、直して保存したら自分の記録として扱う（auto を外す）
  if (old) { Object.assign(old, fd); delete old.auto; } else recs.push({ id: S.newId(), ...fd });
  cur.file.records = recs;
  if (!save()) { delete form.dataset.busy; return; }
  S.setUi(u => { if (u.drafts) delete u.drafts[cur.file.id]; });
  go(`#/f/${cur.file.id}/records`);
});

// 別のタブで保存データが変わったとき：開いている相談が新しくなっていれば、入力中でなければ最新を表示し直す（古い内容で上書きしないため）
window.addEventListener('storage', e => {
  if (e.key !== S.FILES_KEY) return;
  if (!cur?.file) { if (!location.hash.startsWith('#/f/') && !document.activeElement?.matches?.('input,textarea,select')) { keepScroll = true; route(); } return; }
  const fresh = S.getFile(cur.file.id);
  const bar = document.getElementById('savebar');
  if (!fresh) {
    bar.className = 'savebar ng noprint'; bar.hidden = false;
    bar.innerHTML = '<b>この相談は、別のタブ（画面）で削除されました。</b>この画面で操作しても保存されません。<a class="btn slim" href="#/">トップへ</a>';
    return;
  }
  if ((fresh.rev || 1) === (cur.file.rev || 1)) return;
  const typing = document.activeElement && main.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (typing) {
    bar.className = 'savebar ok noprint'; bar.hidden = false;
    bar.innerHTML = '別のタブ（画面）で、この相談が更新されました。<button class="btn slim" data-act="cf-reload">最新の内容を表示する</button>';
    return;
  }
  keepScroll = true; route();
});

window.addEventListener('hashchange', route);
loadCommon().then(() => { migrate(); route(); });
