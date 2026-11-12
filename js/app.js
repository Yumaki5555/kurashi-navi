// 画面の組み立て。URL の # 以降で画面を切り替える（# 以降はサーバーに送られない）。
import * as E from './engine.js';
import * as S from './store.js';
import { renderDoc, fillText, filled } from './docs.js';
import { STATUS, STATUS_OUTCOME, ladderState, currentStatus, recordsText, isPlanned } from './records.js';
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
    tree: data.tree, cards: data.cards?.cards || [], checklists: data.checklists?.items || [], cases: data.cases?.cases || [],
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
function save() { if (cur?.file) { S.putFile(cur.file); saved(); } }
// 保存できなかったときは、画面の上に知らせ続ける（画面を切り替えても消えない場所に出す）
let savedTimer = 0;
function saved() {
  const bar = document.getElementById('savebar');
  if (!bar) return;
  clearTimeout(savedTimer);
  if (!S.lastOk) {
    bar.className = 'savebar ng noprint'; bar.hidden = false;
    bar.innerHTML = '<b>この端末に保存できませんでした。</b>（保存できる量がいっぱい、プライベートモードなどの理由が考えられます）入力した内容は、この画面を開いている間は残っていますが、閉じると消えます。<button class="btn slim" data-act="backup">バックアップを保存（ファイル）</button>するか、文をコピーして残してください。';
  } else if (!bar.hidden && bar.classList.contains('ng')) {
    bar.className = 'savebar ok noprint'; bar.textContent = '保存できました。';
    savedTimer = setTimeout(() => (bar.hidden = true), 4000);
  }
}
function setView(html, title) {
  main.innerHTML = html;
  document.title = (title ? title + '｜' : '') + SITE;
  const h = main.querySelector('h1');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}

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
const contactsHtml = cs => `<ul class="contacts">${cs.map(x => `<li>${esc(x.dept)}${x.tel ? ` <a href="${telHref(x.tel)}">${esc(x.tel)}</a>` : ''}${x.url ? ` <a href="${esc(x.url)}" target="_blank" rel="noopener">ページ↗</a>` : ''}</li>`).join('')}</ul>`;
function whereExtra(c, where, T) {
  const r = cur.file.region;
  if (c.region === 'list') { const ls = regionLists(r); return { html: ls.length ? listsHtml(ls) : '' }; }
  if (c.region === 'none' || !r) return { html: '' };
  const a = focusArea(r);
  // 別の窓口：困りごとを受け持つ課だけ。宿泊施設の窓口（前に相談した窓口）と、記録した相手は出さない。なければ一般的な説明だけ
  if (c.region === 'concern') {
    const ps = [].concat(T?.facts?.problems || []), nm = s => String(s || '').replace(/\s/g, '');
    const asked = (cur.file.records || []).map(x => nm(x.toName)).filter(Boolean);
    const cs = (a?.contacts || []).filter(x => x.handles?.some(h => ps.includes(h)) && !x.handles.some(h => FACILITY.includes(h)) && !asked.some(n => nm(x.dept).includes(n) || n.includes(nm(x.dept))));
    return cs.length ? { html: contactsHtml(cs.slice(0, 3)), contacts: true } : { html: '' };
  }
  const gov = c.region === 'gov' || (c.region === undefined && /自治体|保健所|担当課|担当窓口|役所|市区町村/.test(plain(where)));
  if (!gov) return { html: '' };
  if (a) {
    const hs = c.handles || FACILITY;
    const cs = a.contacts.filter(x => !x.handles?.length || x.handles.some(h => hs.includes(h))).slice(0, 3);
    if (cs.length) return { html: contactsHtml(cs), contacts: true };
  }
  return { html: (c.links || []).some(l => l.type === 'todokeru-contacts') ? '' : linksBlock([{ type: 'todokeru-contacts' }]) };
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
    if (area) info += `<p><small>確認日 ${esc(area.checked)}</small></p>${area.rules.map(x => `<p><b>${esc(x.title)}</b>：${esc(x.summary)}${x.effective ? `（施行 ${esc(x.effective)}）` : ''}</p>`).join('')}`;
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
  setView(`
    <p class="tagline">困ったときも、行き詰まったときも。次にできることがわかる行動ガイド</p>
    <h1>何に困っていますか？</h1>
    <p class="lead">質問に答えると、今の状況に合った次の行動がわかります。すでに相談や請願をした方も、そこから先の方法を探せます。</p>
    <div class="stack cats">${ds.map(d => `<a class="btn big left cat" href="#/start/${d.id}"><b>${esc(d.name)}</b><small>${esc(d.desc || '')}</small>${d.note ? `<small class="cat-note">${esc(d.note)}</small>` : ''}</a>`).join('')}</div>
    ${files.length ? `<h2>続きから</h2>${await fileList(files.slice(0, 3))}${files.length > 3 ? `<p><a href="#/data">すべて見る（${files.length}件）</a></p>` : ''}` : ''}
    <h2>自分で行動する</h2>
    <p class="help">問い合わせ・情報公開請求・請願など、使いたい手段が決まっている方へ。</p>
    <div class="stack"><a class="btn" href="#/act">手段の一覧と、使う前の注意</a><a class="btn danger slim" href="#/emergency">今まさに危険なことが起きている</a></div>
    <p class="note">入力した内容は、この端末の中だけに保存されます。サーバーへは送りません。共有の端末では、使い終わったら<a href="#/data">データを削除</a>してください。</p>`);
}

// 相談の一覧（トップ・分野のページ・保存データの管理で同じ表示）：状態・最後にしたこと・記録の件数
async function fileList(files, { manage = false, href } = {}) {
  const labs = {}, common = (await ladderOf(N.NEXT_DOMAIN)).commonRecordTypes || {};
  const trees = {}, ntree = await treeOf(N.NEXT_DOMAIN);
  for (const d of new Set(files.map(f => f.domain))) { labs[d] = await ladderOf(d); trees[d] = await treeOf(d); }
  return `<ul class="files">${files.map(f => {
    const L = labs[f.domain] || {}, rs = f.rounds || [], n = rs.length;
    const badge = !f.done ? '途中' : n ? `次の一手${n}回目${rs[n - 1].done ? '' : '・途中'}` : '結果あり';
    const st = currentStatus(f), last = N.latestDone(f.records), rc = (f.records || []).length;
    const did = last ? [fmtDay(last.date), L.recordTypes?.[last.toType] || common[last.toType], L.methods?.[last.method]].filter(Boolean).join(' ') : f.done && lastDid(f, trees[f.domain], ntree);
    const lastTxt = did ? '最後にしたこと：' + did : '';
    const meta = [`${fmtDate(f.updatedAt)} 更新`, st && STATUS.find(s => s.value === st)?.label, lastTxt, rc && `記録${rc}件`].filter(Boolean).join('・');
    return `<li><a href="${href ? href(f) : `#/f/${f.id}/${f.done ? 'result' : 'q'}`}"><b>${esc(fileName(f))}</b> <span class="tag">${badge}</span><span class="meta">${esc(meta)}</span></a>
      ${manage ? `<span class="row"><button class="btn slim" data-act="rename" data-id="${f.id}">名前を変える</button><button class="btn slim" data-act="delfile" data-id="${f.id}">削除</button></span>` : ''}</li>`;
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
  const files = S.listFiles().filter(f => f.domain === domain);
  setView(`
    <p class="crumb"><a href="#/">トップ</a></p>
    <h1>${esc(d.name)}</h1>
    <p class="lead">${esc(d.intro || '')}</p>
    <div class="region-start"><b>お住まいの地域</b>${regionSelects(S.getSettings().region)}<small>わからなければ空欄のままで進めます（あとで選べます）</small></div>
    <div id="dup"></div>
    <h2 class="q2">${rich(node.text)}</h2>${node.help ? `<p class="help">${rich(node.help)}</p>` : ''}<div class="termbox" hidden></div>
    <div class="stack">${E.optionsOf(tree, node, {}).map(o => `<div class="opt"><button class="btn big left" data-act="startans" data-domain="${domain}" data-v="${esc(o.value)}">${esc(plain(o.label))}</button>${termBtns(o.label)}</div>`).join('')}</div>
    <ul class="points small"><li>質問は最大${tree.maxQuestions}問。わからない質問は「わからない」で進めます</li><li>結果は法的な判断ではなく、次の行動を整理するためのものです</li></ul>
    ${files.length ? `<h2>前回の続き</h2>${await fileList(files)}` : ''}
    <div class="row wrap"><a class="btn slim" href="#/cases/${domain}">似た問題の事例集</a>${d.emergency ? '<a class="btn slim danger" href="#/emergency">今まさに危険なとき</a>' : ''}</div>`, d.name);
  if (!S.available()) main.insertAdjacentHTML('afterbegin', '<p class="warn">この端末・ブラウザでは保存ができません（プライベートモードなど）。画面を閉じると内容は消えます。</p>');
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
  const asked = st.history.filter(h => !h.auto).length, max = E.maxRemaining(tree, full.history[0]?.node || full.node);
  const opts = E.optionsOf(tree, node, st.facts);
  const cv = c.holder.prev?.[st.node] ?? st.facts[node.fact];
  // 答えの印：まだ答えていない質問で、前の診断の答えに合う選択肢（例：最初の診断の「これまでにしたこと」）
  const hint = cv === undefined ? N.hintsFor(tree, st.node, st.facts) : [];
  const on = v => (Array.isArray(cv) ? cv.includes(v) : cv === v) || hint.includes(v);
  let body;
  if (node.type === 'yesno') body = `<div class="yn">${opts.map(o => `<button class="btn big${on(o.value) ? ' chosen' : ''}" data-act="ans" data-v="${o.value}">${o.label}</button>`).join('')}</div>`;
  else if (node.type === 'choice') body = `<div class="stack">${opts.map(o => `<div class="opt"><button class="btn big left${on(o.value) ? ' chosen' : ''}" data-act="ans" data-v="${esc(o.value)}">${esc(plain(o.label))}</button>${termBtns(o.label)}</div>`).join('')}</div>`;
  else body = `<fieldset class="stack"><legend class="sr">${esc(plain(node.text))}</legend>${opts.map(o => `<div class="opt"><label class="btn big left check"><input type="checkbox" value="${o.value}"${on(o.value) ? ' checked' : ''}${o.exclusive ? ' data-ex="1"' : ''}> <span>${esc(plain(o.label))}</span></label>${termBtns(o.label)}</div>`).join('')}</fieldset>
    <p class="err" id="err" role="alert"></p><button class="btn big primary" data-act="multi">次へ</button>`;
  // 記録や前の診断から引き継いだ答え（聞かずに進めた質問・これから聞かずに進める質問）は、最初に聞く質問にだけ、
  // 質問の順に「見出し「答え」直す」で並べる（結果の「答えた内容」と同じ形）
  let inherited = '';
  if (!asked) {
    const item = (id, f) => esc(`${tree.nodes[id].sum}「${E.labelOf(tree, id, f[tree.nodes[id].fact])}」`);
    const init = c.state.history[0]?.facts ?? c.state.facts;
    const items = [
      ...st.history.map((h, i) => (h.auto ? `${item(h.node, h.facts)} <a href="${qHash(c, i + 1)}?edit=1">直す</a>` : '')).filter(Boolean),
      ...pendingInherited(c, st).map(id => `${item(id, init)} <button class="linklike" data-act="uninherit" data-n="${id}">直す</button>`)
    ];
    if (items.length) inherited = `<p class="note">引き継いだ内容：${items.join('／')}</p>`;
  }
  setView(`
    ${DOM(cur.file.domain)?.emergency ? '<a class="btn danger slim" href="#/emergency">今まさに危険なことが起きている</a>' : ''}
    ${c.roundId !== 'main' ? `<p class="crumb"><a href="#/f/${cur.file.id}/result">${esc(fileName(cur.file))}</a> › 次の一手</p>` : ''}
    <div class="progress" aria-label="進み具合"><span>質問 ${n} / 最大 ${max}</span><div class="bar"><i style="width:${Math.min(100, Math.round((n / max) * 100))}%"></i></div></div>
    ${inherited}
    ${cur.edit ? '<p class="note">直したら、ほかの答えはそのままで結果に戻ります。</p>' : ''}
    ${hint.length ? '<p class="note">前の診断の答えに合うものに印を付けています。違うときは選び直してください。</p>' : ''}
    <h1 class="q">${rich(node.text)}</h1>
    ${node.help ? `<p class="help">${rich(node.help)}</p>` : ''}
    <div class="termbox" hidden></div>
    ${body}
    <div class="nav"><button class="btn" data-act="back">← 戻る</button>${cur.edit && full.node === E.RESULT ? `<a class="btn" href="${resultHash(c)}">直さずに結果へ</a>` : '<button class="btn" data-act="restart">最初からやり直す</button>'}<a class="btn" href="#/">保存して中断</a></div>`, c.roundId === 'main' ? '診断' : '次の一手');
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
function linksBlock(links = []) {
  if (!links.length) return '';
  return `<div class="links">${links.map(l => {
    const ext = !INTERNAL.includes(l.type);
    const label = l.label || G.links.labels?.[l.type] || (l.type === 'next' ? '次の一手を探す' : 'ひらく');
    return `<a class="btn${l.type === 'next' || l.primary ? ' primary' : ''}" href="${esc(linkHref(l))}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(label)}${ext ? ' ↗' : ''}</a>`;
  }).join('')}</div>`;
}

// 「これをする」：案内を、対応の記録に「これからする（予定）」として加える
function chooseBtn(c, chosen) {
  const k = c.key || c.id;
  return chosen.has(k)
    ? `<p class="note">この行動は「対応の記録」に予定として入っています。<a href="#/f/${cur.file.id}/records">記録をひらく</a></p>`
    : `<button class="btn slim" data-act="choose" data-id="${esc(c.id)}">これをする（記録に予定として入れる）</button>`;
}
// 案内の文は、答えに合う部品だけをつなげ、共通情報（場所・困りごと）を差し込む（T = { facts, vars }）
const fill = (v, T) => fillText(v, T?.facts || {}, T?.vars || {});
const partsOf = (xs, T) => (xs || []).filter(x => typeof x === 'string' || E.test(x.when, T?.facts || {})).map(x => fill(typeof x === 'string' ? x : x.t, T));
function todoCard(c, i, open, chosen, T) {
  const where = fill(c.where, T), script = fill(c.script, T), check = fill(c.check, T), bring = partsOf(c.bring, T);
  // 地域の担当課が出るときは、一般的な説明を1行にたたむ（押すと全文）
  const ex = whereExtra(c, where, T);
  return `<details class="card todo"${open ? ' open' : ''}><summary><span class="num">${i + 1}</span>${rich(fill(c.title, T))}</summary>
    ${c.body ? `<p>${rich(fill(c.body, T))}</p>` : ''}
    <dl>
      <dt>どこへ</dt><dd>${ex.contacts ? `${ex.html}<details class="gen"><summary>${esc(plain(where))}</summary></details>` : rich(where) + ex.html}</dd>
      ${check ? `<dt>確認すること</dt><dd>${rich(check)}</dd>` : ''}
      ${bring.length ? `<dt>用意するもの</dt><dd><ul>${bring.map(b => `<li>${rich(b)}</li>`).join('')}</ul></dd>` : ''}
      ${script ? `<dt>聞き方・伝え方の例</dt><dd class="script">${rich(script)}<br><button class="btn slim" data-act="copy" data-text="${esc(plain(script))}">この文をコピー</button></dd>` : ''}
      ${c.ifNoAnswer ? `<dt>答えが得られなかったら</dt><dd>${rich(fill(c.ifNoAnswer, T))}</dd>` : ''}
    </dl>${linksBlock(c.links)}${chosen ? chooseBtn(c, chosen) : ''}${sourcesBlock(c.sources, c.facts)}<div class="termbox" hidden></div></details>`;
}
function infoCard(c, T, open = false) {
  const items = partsOf(c.items, T);
  return `<details class="card"${open ? ' open' : ''}><summary>${rich(fill(c.title, T))}</summary><p>${rich(fill(c.body || '', T))}</p>
    ${items.length ? `<ul>${items.map(x => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}${linksBlock(c.links)}${sourcesBlock(c.sources, c.facts)}<div class="termbox" hidden></div></details>`;
}
function checklistBlock(items, checked, T) {
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

// 結果の画面：主役は「今の状況」「次にすること」「次の一手」の3つ。ほかは「ほかの情報」1つにまとめて閉じておく
function viewResult() {
  const c = ctx(), file = cur.file;
  if (c.state.node !== E.RESULT) { swap(qHash(c, c.state.history.length + 1)); return; }
  const isRound = c.roundId !== 'main';
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
  const top = fresh.slice(0, 3), rest = fresh.slice(3);
  const lad = ladderState(cur.data.ladder, file.state.facts, file.records);
  const rounds = file.rounds || [];
  const nth = isRound ? rounds.findIndex(x => x.id === c.roundId) + 1 : 0;
  const caseDom = isRound ? N.NEXT_DOMAIN : file.domain;
  const T = { facts, vars: infoVals() };
  const other = [
    more(`そのほかにできること（${rest.length}件）`, rest.map((x, i) => todoCard(x, i + 3, false, chosen, T)).join('')),
    more(`すでに試したこと・選んだこと（${tried.length}件・同じ提案はしません）`, tried.length ? `<ul>${tried.map(x => `<li>${rich(fill(x.title, T))}</li>`).join('')}</ul>` : ''),
    more('また起きたとき・ほかの困りごとが残るとき', r.recur.map((x, i) => todoCard(x, i, false, chosen, T)).join('')),
    more(`まず確認すること（${r.check.length}件）`, r.check.map(x => infoCard(x, T)).join('')),
    r.checklist.length ? checklistBlock(r.checklist, file.checks || {}, T) : '',
    r.dont.map(x => infoCard(x, T)).join(''),
    !isRound && lad.next ? more(`この分野の次の段階：${esc(lad.next.title)}`, `<p>${rich(lad.next.body)}</p>${linksBlock(lad.next.links)}`) : '',
    r.ifnot.filter(x => !/段階/.test(x.title)).map(x => infoCard(x, T)).join(''),
    isRound ? '' : regionInfo(top.concat(rest).some(x => x.region === 'list')),
    // 次の一手では「役所の対応」の事例を出す（事例のページから、この回の次の一手に戻れるよう回のIDも渡す）
    more('似た問題の事例', (r.cases.length ? r.cases.map(x => caseItem(x, caseDom, isRound ? `${file.id}&n=${c.roundId}` : file.id)).join('') : '<p class="note">似た事例は、確認でき次第追加します。</p>') + `<a class="btn" href="#/cases/${caseDom}">事例集をすべて見る</a>`)
  ].join('');
  setView(`
    <p class="crumb"><a href="#/">トップ</a>${isRound ? ` › <a href="#/f/${file.id}/result">${esc(fileName(file))}</a>` : ''}</p>
    <h1>${isRound ? `次の一手（${nth}回目）` : '診断の結果'}</h1>
    ${regionLine()}
    <div class="box now"><b>今の状況</b><p>${esc(nowText(sum))}</p>
      <details><summary>答えた内容をすべて見る</summary><ul>${sum.map(s => `<li>${esc(s.label)}：<b>${esc(s.value)}</b> <a class="fix" href="${qHash(c, s.n)}?edit=1">直す</a></li>`).join('')}</ul></details></div>
    ${outcome ? `<p class="note">「対応の記録」で今の状態を「${esc(STATUS.find(s => s.value === st).label)}」にしているので、それに合わせた案内を出しています。<a href="#/f/${file.id}/records">状態を変える</a></p>` : ''}
    ${r.cause.length ? `<section><h2>うまくいかなかった理由の見立て</h2>${r.cause.slice(0, 2).map(x => `<div class="box cause"><b>${rich(fill(x.title, T).replace(/^見立て：/, ''))}</b><p>${rich(fill(x.body, T))}</p>${sourcesBlock(x.sources, x.facts)}<div class="termbox" hidden></div></div>`).join('')}</section>` : ''}
    <section><h2>次にすること</h2>
      ${top.length ? top.map((x, i) => todoCard(x, i, i === 0, chosen, T)).join('') : r.none.map(x => { const its = partsOf(x.items, T); return `<div class="box warn-box"><b>${rich(fill(x.title, T))}</b><p>${rich(fill(x.body, T))}</p>${its.length ? `<ul>${its.map(t => `<li>${rich(t)}</li>`).join('')}</ul>` : ''}${linksBlock(x.links)}</div>`; }).join('')}
      <div class="row wrap start">${allDocs().length ? `<a class="btn" href="#/f/${file.id}/doc">問い合わせ文・要望書を作る</a>` : ''}<a class="btn primary" href="#/f/${file.id}/records">対応を記録する</a></div>
    </section>
    <section><h2>次の一手</h2>
      <p class="help">行動してうまくいかなかったとき（回答がない・断られたなど）に、理由の見立てと次の手段を探せます。答えと記録は引き継ぎます。</p>
      <a class="btn big primary" href="#/f/${file.id}/next/new">次の一手を探す</a>
      ${rounds.length ? `<ul class="files">${rounds.map((x, i) => `<li><a href="#/f/${file.id}/next/${x.id}${x.done ? '' : '/q'}">次の一手（${i + 1}回目）<span class="meta">${fmtDate(x.createdAt)}${x.done ? '' : '・途中'}</span></a></li>`).join('')}</ul>` : ''}
    </section>
    ${other ? `<details class="more other"><summary>ほかの情報</summary>${other}</details>` : ''}
    <div class="row wrap noprint"><button class="btn" data-act="restart">この診断を最初からやり直す</button><button class="btn" data-act="print">印刷・PDF</button></div>
    <p class="note">この結果は、対応の仕方を整理するためのもので、法的な判断ではありません。</p>`, isRound ? '次の一手' : '診断の結果');
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
  const own = cur.data.docs;
  if (cur.file.domain === N.NEXT_DOMAIN) return own;
  const hasDisc = own.some(d => /disclosure/.test(d.id));
  const common = (cur.next?.docs || []).filter(d => !own.some(o => o.id === d.id) && !(hasDisc && d.id === 'disclosure_memo'));
  return [...own, ...common.map(d => ({ ...d, common: true }))];
}
function docPrefill(d) {
  const { file, data } = cur, facts = file.state.facts, v = {};
  for (const f of d.fields) {
    if (f.prefill?.fact && facts[f.prefill.fact] !== undefined) {
      // 実際に答えた質問の選択肢から名前を取る（同じ事実を聞く質問が複数あるため）
      const nodeId = file.state.history.map(h => h.node).find(id => data.tree.nodes[id].fact === f.prefill.fact);
      if (nodeId) v[f.id] = E.labelOf(data.tree, nodeId, facts[f.prefill.fact]);
    }
    if (f.prefill?.region && file.region) v[f.id] = file.region[f.prefill.region] || '';
  }
  return v;
}
// 欄の値：共通情報の欄（info）は相談の共通情報から、ほかは下書きごとに保存した値から
function docValues(d) {
  const sv = cur.file.docs?.[d.id], I = infoVals();
  const v = { ...docPrefill(d), ...(sv?.values || {}) };
  for (const f of d.fields) if (f.info) v[f.id] = I[f.info] || '';
  return v;
}
// 今の段階に合う下書き：結果の「次にすること」（上の3件）から案内している下書き（次の一手があれば、いちばん新しい回の結果）
function recommendedDocs() {
  const rs = (cur.file.rounds || []).filter(x => x.done);
  const lastR = rs.at(-1);
  const [data, state, rid] = lastR ? [cur.next, lastR.state, lastR.id] : [cur.data, cur.file.state, 'main'];
  if (state?.node !== E.RESULT) return new Set();
  const { fresh } = N.splitActions(E.compose(data, state.facts).todo, N.usedKeys(cur.file, rid));
  return new Set(fresh.slice(0, 3).flatMap(c => (c.links || []).filter(l => l.type === 'doc').map(l => l.doc)));
}

function viewDocs() {
  const { file } = cur;
  const ds = allDocs(), rec = recommendedDocs();
  const item = d => `<a class="btn big left" href="#/f/${file.id}/doc/${d.id}"><b>${esc(d.title)}</b><br><small>${esc(d.desc)}</small></a>`;
  const top = ds.filter(d => rec.has(d.id)), others = ds.filter(d => !rec.has(d.id));
  setView(`<p class="crumb"><a href="#/f/${file.id}/result">診断の結果</a></p>
    <h1>文書の下書きを作る</h1>
    <p class="note">入力した事実だけで文章を組み立てます。入力していないことは書きません。出す前に必ず読み直して直してください。</p>
    ${top.length ? `<h2>おすすめ（今の段階に合うもの）</h2><div class="stack">${top.map(item).join('')}</div><h2>ほかの下書き</h2>` : ''}
    <div class="stack">${others.map(item).join('')}</div>
    <h2>届け方は「声を届ける」で</h2><p class="help">文章はこのサイトで作れます。どこへ送るか（窓口）と、電話のかけ方、メール・手紙の送り方、情報公開請求・請願・陳情・パブコメの手続きは、姉妹サイト「声を届ける」で詳しく案内しています。</p>
    ${linksBlock([{ type: 'todokeru-guide', guide: 'phone', section: 'manual', label: '電話のかけ方' }, { type: 'todokeru-guide', guide: 'email', section: 'manual', label: 'メール・手紙の送り方' }, { type: 'todokeru-contacts', label: '窓口を探す' }])}`, '文書の下書き');
}

function viewDoc(docId) {
  const { file } = cur;
  const d = allDocs().find(x => x.id === docId);
  if (!d) return viewDocs();
  const saved = file.docs?.[docId];
  const values = docValues(d);
  const text = saved?.edited ? saved.text : renderDoc(d, values);
  const field = f => {
    const v = esc(values[f.id] || '');
    const input = f.type === 'textarea' ? `<textarea data-act="field" data-f="${f.id}" rows="3" placeholder="${esc(f.placeholder || '')}">${v}</textarea>`
      : `<input type="${f.type === 'date' ? 'date' : 'text'}" data-act="field" data-f="${f.id}" value="${v}" placeholder="${esc(f.placeholder || '')}">`;
    return `<label class="field"><span>${esc(f.label)}${f.info ? ' <small>（共通）</small>' : ''}${f.optional ? ' <small>（なくても可）</small>' : ''}</span>${f.help ? `<small>${esc(f.help)}</small>` : ''}${input}</label>`;
  };
  setView(`<p class="crumb"><a href="#/f/${file.id}/doc">文書の一覧</a></p>
    <h1>${esc(d.title)}</h1><p class="help">${esc(d.desc)}</p>
    <section class="card plainc"><h2>1. 事実を入れる</h2><p class="note">わかることだけ入れてください。空欄の項目は、文章に出てきません。（共通）の欄は、ほかの下書きと結果の例文にも入ります。</p>${d.fields.map(field).join('')}</section>
    <section class="card plainc"><h2>2. できた下書き（ここで直せます）</h2>
      <p class="warn" id="editwarn" role="status"${saved?.edited ? '' : ' hidden'}>手で直した下書きです。これからは上の欄を変えても、この下書きには反映されません（手で直した内容はそのまま残ります）。<button class="btn slim" data-act="regen">欄の内容で作り直す</button></p>
      <textarea id="doctext" data-act="doctext" rows="14">${esc(text)}</textarea>
      <div class="row"><button class="btn" data-act="copydoc">コピー</button><button class="btn" data-act="savedoc">テキストで保存</button><button class="btn" data-act="print">印刷・PDF</button></div></section>
    <section class="card plainc"><h2>3. 出す前の確認</h2><ul class="checklist">${(d.checks || []).map(c => `<li><label><input type="checkbox"> ${esc(c)}</label></li>`).join('')}</ul></section>
    ${deliverBlock(d)}`, d.title);
}
// 4. 伝える・届ける：電話・メールなど届け方ごとに分けたボタン（deliver）か、ボタンだけ（links）
function deliverBlock(d) {
  const groups = d.deliver || (d.links ? [{ links: d.links }] : []);
  if (!groups.length) return '';
  const toTodokeru = groups.some(g => g.links.some(l => l.type.startsWith('todokeru')));
  return `<section class="card plainc noprint"><h2>4. ${d.deliver ? '伝える' : '届ける'}</h2>
    ${groups.map(g => g.title ? `<div class="box deliver"><h3>${esc(g.title)}</h3>${g.note ? `<p class="help">${esc(g.note)}</p>` : ''}${linksBlock(g.links)}</div>` : linksBlock(g.links)).join('')}
    ${toTodokeru ? '<p class="note">↗（右上向きの矢印）の付いたボタンは、別のサイトが開きます。姉妹サイト「声を届ける」では、窓口と伝え方を見られます。文章はこのページで完成しているので、作り直す必要はありません。</p>' : ''}</section>`;
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
  return `<select name="toType"><option value="">選んでください</option><optgroup label="相手">${who.map(o).join('')}</optgroup>${how.length ? `<optgroup label="手段">${how.map(o).join('')}</optgroup>` : ''}${map.other ? o('other') : ''}</select>`;
}
function viewRecords(editId) {
  const { file, data } = cur;
  const L = recLabels();
  const st = currentStatus(file);
  const lad = ladderState(data.ladder, file.state.facts, file.records);
  const rs = (file.records || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const ed = (file.records || []).find(r => r.id === editId) || { date: today(), toType: '', method: '', state: 'doing' };
  const sel = (name, map, val, empty = '選んでください') => `<select name="${name}"><option value="">${empty}</option>${Object.entries(map).map(([k, v]) => `<option value="${k}"${k === val ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  let next = '';
  if (st === 'resolved') next = '<div class="box ok"><b>解決したと記録されています。</b><p>記録は残しておくと、また起きたときに役立ちます。</p></div>';
  else {
    if (['partial', 'same', 'worse'].includes(st)) next += `<div class="box"><b>「${esc(STATUS.find(s => s.value === st).label)}」と記録されています。</b><p>これまでの診断と記録を引き継いで、理由の見立てと次の手段を探せます。</p><a class="btn big primary" href="#/f/${file.id}/next/new">次の一手を探す</a></div>`;
    else if (lad.next) next += `<div class="box"><b>次の段階：${esc(lad.next.title)}</b><p>${rich(lad.next.body)}</p>${linksBlock(lad.next.links)}</div>`;
  }
  if (lad.repeated.length && st !== 'resolved') next += `<p class="warn">${lad.repeated.map(t => esc((L.toType[t.toType] || '') + (t.toName ? `（${t.toName}）` : ''))).join('・')}には2回以上相談しています。同じ相談を繰り返すより、回答の内容を記録して、「次の一手を探す」で別の手段を考えましょう。</p>`;
  if (lad.planned.length) next += `<p class="note">予定（まだしていないこと）の記録が${lad.planned.length}件あります。予定は「済んだこと」に数えていません。実際にしたら、その記録の「直す」から、日付・回答・状況を書き足してください。</p>`;
  setView(`<p class="crumb"><a href="#/f/${file.id}/result">診断の結果</a></p>
    <h1>対応の記録</h1>
    <p class="help">${esc(fileName(file))}</p>
    <section class="card plainc"><h2>${editId ? '記録を直す' : '記録を追加する'}</h2>
      <form id="recform" data-id="${esc(ed.id || '')}">
        <label class="field"><span>日付</span><input type="date" name="date" value="${esc(ed.date)}"></label>
        <label class="field"><span>相手・手段</span>${typeSelect(L.toType, ed.toType)}</label>
        <label class="field"><span>相手の部署・名前 <small>（なくても可）</small></span><input name="toName" value="${esc(ed.toName || '')}" placeholder="〇〇区 生活衛生課"></label>
        <label class="field"><span>方法</span>${sel('method', L.method, ed.method)}</label>
        <label class="field"><span>したこと・伝えた内容</span><textarea name="content" rows="3">${esc(ed.content || '')}</textarea></label>
        <label class="field"><span>相手からの回答</span><textarea name="response" rows="3">${esc(ed.response || '')}</textarea></label>
        <label class="field"><span>相手の回答の種類 <small>（なくても可）</small></span>${sel('resultType', L.result, ed.resultType, 'まだない・選ばない')}</label>
        <label class="field"><span>次にすること</span><textarea name="next" rows="2">${esc(ed.next || '')}</textarea></label>
        <label class="field"><span>この件の状況</span>${sel('state', L.state, ed.state)}</label>
        <p class="err" id="err" role="alert"></p>
        <button class="btn big primary" type="submit">${editId ? '直した内容を保存' : '記録を保存'}</button>${editId ? ` <a class="btn" href="#/f/${file.id}/records">やめる</a>` : ''}
      </form></section>
    ${rs.length ? `<section class="card plainc"><h2>今の状態</h2><p class="help">行動のあと、結果を選んでください。</p><div class="row wrap">${STATUS.map(s => `<label class="pill"><input type="radio" name="status" value="${s.value}"${st === s.value ? ' checked' : ''} data-act="status"> ${s.label}</label>`).join('')}</div>
      ${(file.statusLog || []).length ? `<details><summary>状態の変化（${file.statusLog.length}件）</summary><ul>${file.statusLog.map(s => `<li>${esc(s.date)}：${STATUS.find(x => x.value === s.status)?.label}</li>`).join('')}</ul></details>` : ''}</section>` : ''}
    <section><h2>次の一手</h2>${next || '<p class="note">記録をつけると、次の一手をご案内します。</p>'}
      ${st !== 'resolved' && !['partial', 'same', 'worse'].includes(st) ? `<a class="btn" href="#/f/${file.id}/next/new">次の一手を探す（記録を引き継ぎます）</a>` : ''}</section>
    <section><h2>これまでの記録（${rs.length}件）</h2>
      ${rs.map(r => `<article class="card plainc rec"><b>${esc(r.date)}</b>　${isPlanned(r) ? '<span class="tag">予定</span>' : ''}${r.auto ? '<span class="tag">次の一手の答えから自動で追加</span>' : ''}${esc([(L.toType[r.toType] || '') + (r.toName ? `（${r.toName}）` : ''), L.method[r.method], L.result[r.resultType], L.state[r.state]].filter(Boolean).join('・'))}
        ${r.content ? `<p><small>したこと・伝えた内容</small><br>${esc(r.content)}</p>` : ''}${r.response ? `<p><small>回答</small><br>${esc(r.response)}</p>` : ''}${r.next ? `<p><small>次にすること</small><br>${esc(r.next)}</p>` : ''}
        <div class="row"><a class="btn slim" href="#/f/${file.id}/records/${r.id}">直す</a><button class="btn slim" data-act="delrec" data-id="${r.id}">削除</button></div></article>`).join('') || '<p class="note">まだ記録はありません。</p>'}</section>
    <div class="row"><button class="btn" data-act="savetxt">テキストで保存</button><button class="btn" data-act="print">印刷・PDF</button></div>
    <p class="note">この端末の中だけに保存されます。大事な記録は「テキストで保存」か<a href="#/data">バックアップ</a>で残してください。</p>`, '対応の記録');
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

async function viewData(confirming) {
  const files = S.listFiles();
  setView(`<p class="crumb"><a href="#/">トップ</a></p><h1>保存データの管理</h1>
    <ul class="points"><li>診断の答え・チェック・記録は、この端末のブラウザの中だけに保存されています。サーバーには送っていません。</li>
    <li>ブラウザの履歴やサイトのデータを消すと、記録も消えます。iPhone の Safari では、しばらく開かないと消えることがあります。大事な記録は「バックアップを保存」でファイルに残してください。</li>
    <li>家族や職場と共有している端末では、使い終わったら削除してください。</li></ul>
    <h2>保存されている相談（${files.length}件）</h2>
    ${files.length ? await fileList(files, { manage: true }) : '<p class="note">ありません。</p>'}
    <div class="stack"><button class="btn" data-act="backup">バックアップを保存（ファイル）</button>
    <label class="btn">バックアップから戻す<input type="file" accept=".json,application/json" data-act="restore" hidden></label>
    ${confirming ? '<p class="warn">このサイトの記録をすべて削除します。元に戻せません。</p><button class="btn danger" data-act="wipe2">すべて削除する</button><a class="btn" href="#/data">やめる</a>' : '<button class="btn" data-act="wipe">このサイトの記録をすべて削除</button>'}</div>
    <p class="note" id="msg" role="status"></p>`, 'データの管理');
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
      if (c === 'records') return viewRecords(d);
      if (c === 'next') {
        const rounds = file.rounds || [];
        if (!d || d === 'new') {
          // 途中の回があれば、新しく作らずに続きへ
          const open = rounds.find(r => !r.done);
          if (open) { swap(`#/f/${file.id}/next/${open.id}/q`); return; }
          return startRound();
        }
        cur.round = rounds.find(r => r.id === d) || (draft?.fileId === file.id && draft.round.id === d ? draft.round : null);
        if (!cur.round) { swap(`#/f/${file.id}/result`); return; }
        if (e === 'q') { cur.qn = +f || 0; return viewQuestion(); }
        return viewResult();
      }
      return swap(`#/f/${file.id}/${file.done ? 'result' : 'q'}`);
    }
    await viewHome();
  } catch (err) {
    setView(`<h1>表示できませんでした</h1><p>${esc(err.message)}</p><a class="btn" href="#/">トップへ</a>`);
  }
}

// ---------- 操作 ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'button')) return;
  const act = t.dataset.act;
  if (act === 'startans') {
    const dom = t.dataset.domain, v = t.dataset.v;
    const [data, next] = await Promise.all([loadDomain(dom), loadDomain(N.NEXT_DOMAIN)]);
    const n0 = data.tree.nodes[data.tree.start];
    // 同じ分野・同じ状況の相談がすでにあれば、続きから／新しく始める を選んでもらう（同じ相談を重複して作らない）
    const same = S.listFiles().filter(f => f.domain === dom && f.state?.facts?.[n0.fact] === v);
    if (same.length && !t.dataset.force) {
      const box = document.getElementById('dup');
      const label = E.optionsOf(data.tree, n0).find(o => o.value === v)?.label || '';
      box.innerHTML = `<div class="box warn-box" role="alert"><b>「${esc(plain(label))}」の相談が保存されています。</b><p>続きからなら、下の相談を選んでください。</p>${await fileList(same.slice(0, 3))}
        <button class="btn" data-act="startans" data-domain="${dom}" data-v="${esc(v)}" data-force="1">新しく始める</button></div>`;
      box.scrollIntoView({ block: 'center' });
      return;
    }
    // 保存データは1問目に答えたこの時点で作る。分野のページの履歴は1問目の画面に置き換える（戻るで1問目に戻れるように）
    const f = S.createFile(dom, E.begin(data.tree), { region: S.getSettings().region || null });
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
    // 1つ前に表示した質問へ（引き継いで聞かなかった質問は飛ばす）。最初の質問なら分野のページ（次の一手なら結果）へ
    const c = ctx(), h = c.state.history;
    let k = cur.qn - 1;
    while (k >= 1 && h[k - 1]?.auto) k--;
    goBack(k >= 1 ? qHash(c, k) + (cur.edit ? '?edit=1' : '') : c.roundId === 'main' ? `#/start/${cur.file.domain}` : `#/f/${cur.file.id}/result`);
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
    if (c.roundId === 'main') c.holder.state = E.begin(c.tree);
    else c.holder.state = N.newRound(c.tree, { ...cur.file, rounds: (cur.file.rounds || []).filter(r => r.id !== c.roundId) }, c.roundId).state;
    c.holder.done = c.holder.state.node === E.RESULT; c.holder.prev = {}; save();
    go(c.holder.done ? resultHash(c) : qHash(c, c.holder.state.history.length + 1));
  }
  else if (act === 'choose') {
    const c = ctx();
    const card = c.data.cards.find(x => x.id === t.dataset.id);
    if (!card) return;
    const key = card.key || card.id;
    const L = recLabels();
    cur.file.records = [...(cur.file.records || []), { id: S.newId(), date: today(), toType: N.recTypeFor(card, L.toType), toName: '', method: '', content: plain(card.title), response: '', next: '', state: 'todo', actionKey: key, round: c.roundId }];
    c.holder.chosen = [...new Set([...(c.holder.chosen || []), key])];
    save();
    t.outerHTML = `<p class="note" role="status">「対応の記録」に予定として入れました。実際にしたら、記録の「直す」から日付・回答・状況を書き足してください。<a href="#/f/${cur.file.id}/records">記録をひらく</a></p>`;
  }
  else if (act === 'term') {
    const box = t.closest('details, .box, main')?.querySelector('.termbox') || main.querySelector('.termbox');
    const gl = cur?.round ? { ...cur.data.glossary, ...cur.next.glossary } : { ...(cur?.next?.glossary || {}), ...(cur?.data?.glossary || {}) };
    let txt = gl[t.dataset.term];
    if (!txt && !cur) { const dom = location.hash.split('/')[2]?.split('?')[0]; txt = cache[dom]?.glossary?.[t.dataset.term] || cache[N.NEXT_DOMAIN]?.glossary?.[t.dataset.term]; }
    if (box) { const same = !box.hidden && box.dataset.term === t.dataset.term; box.hidden = same; box.dataset.term = t.dataset.term; box.innerHTML = `<b>${esc(t.dataset.term)}</b>：${esc(txt || '説明を準備中です。')}`; }
  }
  else if (act === 'copy') copy(t.dataset.text, t);
  else if (act === 'copydoc') copy(document.getElementById('doctext').value, t);
  else if (act === 'savedoc') download(`下書き_${new Date().toLocaleDateString('sv-SE')}.txt`, document.getElementById('doctext').value);
  else if (act === 'regen') {
    if (!confirm('手で直した部分は消えて、上の欄の内容で下書きを作り直します。よろしいですか？')) return;
    const id = location.hash.split('/')[4]; cur.file.docs[id].edited = false; save(); viewDoc(id);
  }
  else if (act === 'print') window.print();
  else if (act === 'savetxt') download(`対応の記録_${new Date().toLocaleDateString('sv-SE')}.txt`, recordsText(cur.file, recLabels()));
  else if (act === 'delrec') { if (!confirm('この記録を削除します。元に戻せません。よろしいですか？')) return; cur.file.records = cur.file.records.filter(r => r.id !== t.dataset.id); save(); viewRecords(); }
  else if (act === 'histback') history.length > 1 ? history.back() : (location.hash = '#/');
  else if (act === 'rename') {
    const f = S.getFile(t.dataset.id); if (!f) return;
    const v = prompt('相談の名前', fileName(f));
    if (v === null || !v.trim()) return;
    f.title = v.trim().slice(0, 80); f.titleCustom = true; S.putFile(f); saved(); route();
  }
  else if (act === 'delfile') { if (!confirm('この相談の答え・記録をすべて削除します。元に戻せません。よろしいですか？')) return; S.removeFile(t.dataset.id); saved(); route(); }
  else if (act === 'backup') download(`困りごと次どうする_バックアップ_${new Date().toLocaleDateString('sv-SE')}.json`, S.backupText(), 'application/json');
  else if (act === 'wipe') viewData(true);
  else if (act === 'wipe2') { S.clearAll(); await viewData(false); document.getElementById('msg').textContent = 'このサイトの記録をすべて削除しました。'; }
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
  else if (act === 'pref' || act === 'city') {
    // 地域は端末に覚えて、新しい相談でも初期値にする。開いている相談があれば、その相談の地域も変える
    const prefs = G.areas?.prefs || [], old = regionNow();
    let r;
    if (act === 'pref') { const p = prefs.find(x => x.code === t.value); r = p ? { pref: p.code, prefName: p.name, code: '', cityName: '' } : null; }
    else { const p = prefs.find(x => x.code === old?.pref); const c = p?.cities.find(([k]) => k === t.value); r = { ...old, code: c ? c[0] : '', cityName: c ? c[1] : '' }; }
    S.setSettings({ region: r });
    if (cur?.file) { cur.file.region = r; save(); route().then(() => main.querySelector('.region-line')?.setAttribute('open', '')); }
    else t.closest('[data-region]').outerHTML = regionSelects(r);
  }
  else if (act === 'status') { cur.file.statusLog = [...(cur.file.statusLog || []), { date: today(), status: t.value }]; save(); viewRecords(); }
  else if (act === 'cfilter') { const q = new URLSearchParams(location.hash.split('?')[1] || ''); t.value ? q.set(t.dataset.k, t.value) : q.delete(t.dataset.k); location.hash = location.hash.split('?')[0] + (q.toString() ? '?' + q : ''); }
  else if (act === 'restore' && t.files[0]) { try { const n = S.restore(await t.files[0].text()); migrate(); saved(); await viewData(false); document.getElementById('msg').textContent = S.lastOk ? `${n}件の相談を戻しました。` : `${n}件の相談を画面に戻しましたが、この端末には保存できませんでした。`; } catch (er) { document.getElementById('msg').textContent = er.message; } }
});

document.addEventListener('input', e => {
  const t = e.target, act = t.dataset.act;
  if (act !== 'field' && act !== 'doctext') return;
  const id = location.hash.split('/')[4];
  const d = allDocs().find(x => x.id === id);
  if (!d) return;
  const sv = (cur.file.docs ||= {})[id] || (cur.file.docs[id] = { values: {}, edited: false, text: '' });
  if (act === 'field') {
    // 共通情報の欄は相談の共通情報へ（ほかの下書きと結果の例文にも入る）、ほかは下書きごとに保存
    const fd = d.fields.find(x => x.id === t.dataset.f);
    if (fd?.info) (cur.file.info ||= {})[fd.info] = t.value; else sv.values[t.dataset.f] = t.value;
    if (!sv.edited) document.getElementById('doctext').value = renderDoc(d, docValues(d));
  } else {
    // 最初に手で直したときに、その場で「以後は欄の変更が反映されない」ことを知らせる
    if (!sv.edited) { const w = document.getElementById('editwarn'); if (w) w.hidden = false; }
    sv.edited = true; sv.text = t.value;
  }
  save();
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'recform') return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  if (!fd.date || !fd.toType) { document.getElementById('err').textContent = '日付と相手・手段を入れてください'; return; }
  if (fd.date > today() && fd.state !== 'todo') { document.getElementById('err').textContent = '日付が今日より先です。まだしていないことなら、「この件の状況」を「これからする（予定）」にしてください。'; return; }
  const id = e.target.dataset.id;
  const recs = cur.file.records || [];
  // 自動で追加した記録も、直して保存したら自分の記録として扱う（auto を外す）
  if (id) { const r = recs.find(x => x.id === id); Object.assign(r, fd); delete r.auto; } else recs.push({ id: S.newId(), ...fd });
  cur.file.records = recs; save();
  location.hash = `#/f/${cur.file.id}/records`;
  if (!id) viewRecords();
});

window.addEventListener('hashchange', route);
loadCommon().then(() => { migrate(); route(); });
