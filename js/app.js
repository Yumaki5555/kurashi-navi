// 画面の組み立て。URL の # 以降で画面を切り替える（# 以降はサーバーに送られない）。
import * as E from './engine.js';
import * as S from './store.js';
import { renderDoc } from './docs.js';
import { STATUS, STATUS_OUTCOME, ladderState, currentStatus, recordsText, isPlanned } from './records.js';
import * as N from './rounds.js';

const SITE = '困りごと、次どうする？';
const main = document.getElementById('main');
const G = { sources: {}, links: {}, domains: [], areas: null, lists: null, focus: null, actions: [] };
const cache = {};
let cur = null; // { file, data（分野）, next（次の一手の共通データ）, round（次の一手の回。最初の診断なら null） }
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

// 今いる診断：最初の診断（分野のデータ）か、「次の一手」の回（共通データ）か
function ctx() {
  const f = cur.file, r = cur.round;
  return r
    ? { data: cur.next, tree: cur.next.tree, state: r.state, roundId: r.id, base: `#/f/${f.id}/next/${r.id}`, holder: r }
    : { data: cur.data, tree: cur.data.tree, state: f.state, roundId: 'main', base: `#/f/${f.id}`, holder: f };
}
const resultHash = c => (c.roundId === 'main' ? `${c.base}/result` : c.base);

// ---------- 画面：トップ ----------
function viewHome() {
  const files = S.listFiles();
  const ds = G.domains.filter(d => d.status === 'active');
  setView(`
    <p class="tagline">困ったときも、行き詰まったときも。次にできることがわかる行動ガイド</p>
    <h1>何に困っていますか？</h1>
    <p class="lead">質問に答えると、今の状況に合った次の行動がわかります。すでに相談や請願をした方も、そこから先の方法を探せます。</p>
    <div class="stack cats">${ds.map(d => `<a class="btn big left cat" href="#/start/${d.id}"><b>${esc(d.name)}</b><small>${esc(d.desc || '')}</small></a>`).join('')}</div>
    ${files.length ? `<h2>続きから</h2>${fileList(files.slice(0, 5))}${files.length > 5 ? '<p><a href="#/data">すべての相談を見る</a></p>' : ''}` : ''}
    <h2>自分で行動する</h2>
    <p class="help">問い合わせ・情報公開請求・請願など、使いたい手段が決まっている方へ。</p>
    <div class="stack"><a class="btn" href="#/act">手段の一覧と、使う前の注意</a><a class="btn danger slim" href="#/emergency">今まさに危険なことが起きている</a></div>
    <p class="note">入力した内容は、この端末の中だけに保存されます。サーバーへは送りません。共有の端末では、使い終わったら<a href="#/data">データを削除</a>してください。</p>`);
}

function fileList(files) {
  return `<ul class="files">${files.map(f => {
    const st = currentStatus(f);
    const n = (f.rounds || []).length;
    return `<li><a href="#/f/${f.id}/${f.done ? 'result' : 'q'}"><b>${esc(f.title || '診断の途中')}</b>
      <span class="meta">${fmtDate(f.updatedAt)} 更新${st ? '・' + STATUS.find(s => s.value === st).label : f.done ? '' : '・途中'}${n ? `・次の一手 ${n}回` : ''}</span></a></li>`;
  }).join('')}</ul>`;
}

// 分野のページ：最初の質問（具体的な困りごと）をそのまま選べるようにして、1回分の操作を減らす
async function viewStart(domain) {
  const d = G.domains.find(x => x.id === domain && x.status === 'active');
  if (!d) return viewHome();
  const data = await loadDomain(domain);
  const tree = data.tree, node = tree.nodes[tree.start];
  const files = S.listFiles().filter(f => f.domain === domain);
  const first = node.type === 'choice'
    ? `<h2 class="q2">${rich(node.text)}</h2>${node.help ? `<p class="help">${rich(node.help)}</p>` : ''}<div class="termbox" hidden></div>
       <div class="stack">${E.optionsOf(tree, node).map(o => `<div class="opt"><button class="btn big left" data-act="startans" data-domain="${domain}" data-v="${esc(o.value)}">${esc(plain(o.label))}</button>${termBtns(o.label)}</div>`).join('')}</div>`
    : `<button class="btn big primary" data-act="new" data-domain="${domain}">診断を始める</button>`;
  setView(`
    <p class="crumb"><a href="#/">トップ</a></p>
    <h1>${esc(d.name)}</h1>
    <p class="lead">${esc(d.intro || '')}</p>
    ${first}
    <ul class="points small"><li>質問は最大${tree.maxQuestions}問。わからない質問は「わからない」で進めます</li><li>結果は法的な判断ではなく、次の行動を整理するためのものです</li></ul>
    ${files.length ? `<h2>前回の続き</h2>${fileList(files)}` : ''}
    <div class="row wrap"><a class="btn slim" href="#/cases/${domain}">似た問題の事例集</a><a class="btn slim danger" href="#/emergency">今まさに危険なとき</a></div>`, d.name);
  if (!S.available()) main.insertAdjacentHTML('afterbegin', '<p class="warn">この端末・ブラウザでは保存ができません（プライベートモードなど）。画面を閉じると内容は消えます。</p>');
}

// ---------- 画面：質問 ----------
function viewQuestion() {
  const c = ctx(), tree = c.tree, st = c.state;
  if (st.node === E.RESULT) { location.hash = resultHash(c); return; }
  const node = tree.nodes[st.node];
  const n = st.history.length + 1, max = st.history.length + E.maxRemaining(tree, st.node);
  const prev = c.holder.prev?.[st.node];
  const opts = E.optionsOf(tree, node);
  let body;
  if (node.type === 'yesno') body = `<div class="yn">${opts.map(o => `<button class="btn big${prev === o.value ? ' chosen' : ''}" data-act="ans" data-v="${o.value}">${o.label}</button>`).join('')}</div>`;
  else if (node.type === 'choice') body = `<div class="stack">${opts.map(o => `<div class="opt"><button class="btn big left${prev === o.value || st.facts[node.fact] === o.value ? ' chosen' : ''}" data-act="ans" data-v="${esc(o.value)}">${esc(plain(o.label))}</button>${termBtns(o.label)}</div>`).join('')}</div>`;
  else body = `<fieldset class="stack"><legend class="sr">${esc(plain(node.text))}</legend>${opts.map(o => `<div class="opt"><label class="btn big left check"><input type="checkbox" value="${o.value}"${Array.isArray(prev) && prev.includes(o.value) ? ' checked' : ''}${o.exclusive ? ' data-ex="1"' : ''}> <span>${esc(plain(o.label))}</span></label>${termBtns(o.label)}</div>`).join('')}</fieldset>
    <p class="err" id="err" role="alert"></p><button class="btn big primary" data-act="multi">次へ</button>`;
  // 記録や前の診断から引き継いだ答え（聞かずに進めた質問）
  const autos = st.history.filter(h => h.auto).map(h => `${tree.nodes[h.node].sum}：${E.labelOf(tree, h.node, st.facts[tree.nodes[h.node].fact])}`);
  setView(`
    <a class="btn danger slim" href="#/emergency">今まさに危険なことが起きている</a>
    ${c.roundId !== 'main' ? `<p class="crumb"><a href="#/f/${cur.file.id}/result">${esc(cur.file.title || '診断の結果')}</a> › 次の一手</p>` : ''}
    <div class="progress" aria-label="進み具合"><span>質問 ${n} / 最大 ${max}</span><div class="bar"><i style="width:${Math.round((n / max) * 100)}%"></i></div></div>
    ${autos.length ? `<p class="note">これまでの記録・答えから「${esc(autos.join('／'))}」を引き継いでいます。違うときは「戻る」で選び直せます。</p>` : ''}
    <h1 class="q">${rich(node.text)}</h1>
    ${node.help ? `<p class="help">${rich(node.help)}</p>` : ''}
    <div class="termbox" hidden></div>
    ${body}
    <div class="nav"><button class="btn" data-act="back">← 戻る</button><button class="btn" data-act="restart">最初からやり直す</button><a class="btn" href="#/">保存して中断</a></div>`, c.roundId === 'main' ? '診断' : '次の一手');
}

// 答えを進める。最初の診断で、分野が「次の一手」へ続けると決めている答え（startNextIf）なら、そのまま次の一手を始める
function doAnswer(value) {
  const c = ctx(), file = cur.file;
  let state;
  try {
    c.holder.prev = { ...(c.holder.prev || {}), [c.state.node]: value };
    state = E.answer(c.tree, c.state, value);
  } catch (e) { alert(e.message); return; }
  c.holder.state = state;
  // 分野のページで最初の答えを選んだときは、URL を質問の画面に合わせる（再読み込みしても続きから）
  if (state.node !== E.RESULT) { save(); const h = `${c.base}/q`; if (location.hash !== h) location.hash = h; else viewQuestion(); return; }
  c.holder.done = true;
  if (c.roundId !== 'main') { save(); location.hash = c.base; return; }
  if (!file.title) file.title = `${c.tree.title}：${E.labelOf(c.tree, c.tree.start, state.facts[c.tree.nodes[c.tree.start].fact])}（${new Date().toLocaleDateString('ja-JP')}）`;
  if (c.tree.startNextIf && E.test(c.tree.startNextIf, state.facts)) { save(); startRound(); return; }
  save(); location.hash = `#/f/${file.id}/result`;
}

function startRound() {
  const file = cur.file;
  const r = N.newRound(cur.next.tree, file, S.newId());
  file.rounds = [...(file.rounds || []), r];
  save();
  location.replace(`#/f/${file.id}/next/${r.id}${r.state.node === E.RESULT ? '' : '/q'}`);
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
    case 'todokeru-guide': return L.todokeru + '#/guide/' + l.guide;
    case 'minpaku-map': { const q = new URLSearchParams(); if (r?.prefName) q.set('pref', r.prefName); if (r?.cityName) q.set('city', r.cityName); return L.minpakuMap + (q.toString() ? '?' + q : ''); }
    case 'pubcome': return L.pubcome;
    case 'shomei': return L.shomei;
    case 'doc': return f ? `#/f/${f.id}/doc/${l.doc}` : '#/';
    case 'records': return f ? `#/f/${f.id}/records` : '#/';
    case 'next': return f ? `#/f/${f.id}/next/new` : '#/start/gyosei';
    case 'page': return l.url;
    case 'tel': return 'tel:' + l.tel.replace(/[^0-9#+]/g, '');
    default: return l.url || '#/';
  }
}
const INTERNAL = ['doc', 'records', 'tel', 'next', 'page'];
function linksBlock(links = []) {
  if (!links.length) return '';
  return `<div class="links">${links.map(l => {
    const ext = !INTERNAL.includes(l.type);
    const label = l.label || G.links.labels?.[l.type] || (l.type === 'next' ? '次の一手を探す' : 'ひらく');
    return `<a class="btn${l.type === 'next' ? ' primary' : ''}" href="${esc(linkHref(l))}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(label)}${ext ? ' ↗' : ''}</a>`;
  }).join('')}</div>`;
}

// 「これをする」：案内を、対応の記録に「これからする（予定）」として加える
function chooseBtn(c, chosen) {
  const k = c.key || c.id;
  return chosen.has(k)
    ? `<p class="note">この行動は「対応の記録」に予定として入っています。<a href="#/f/${cur.file.id}/records">記録をひらく</a></p>`
    : `<button class="btn slim" data-act="choose" data-id="${esc(c.id)}">これをする（記録に予定として入れる）</button>`;
}
function todoCard(c, i, open, chosen) {
  const script = plain(c.script);
  return `<details class="card todo"${open ? ' open' : ''}><summary><span class="num">${i + 1}</span>${rich(c.title)}</summary>
    ${c.body ? `<p>${rich(c.body)}</p>` : ''}
    <dl>
      <dt>どこへ</dt><dd>${rich(c.where)}</dd>
      <dt>確認すること</dt><dd>${rich(c.check)}</dd>
      <dt>用意するもの</dt><dd><ul>${c.bring.map(b => `<li>${rich(b)}</li>`).join('')}</ul></dd>
      <dt>聞き方・伝え方の例</dt><dd class="script">${rich(c.script)}<br><button class="btn slim" data-act="copy" data-text="${esc(script)}">この文をコピー</button></dd>
      <dt>答えが得られなかったら</dt><dd>${rich(c.ifNoAnswer)}</dd>
    </dl>${linksBlock(c.links)}${chosen ? chooseBtn(c, chosen) : ''}${sourcesBlock(c.sources, c.facts)}<div class="termbox" hidden></div></details>`;
}
function infoCard(c, open = false) {
  return `<details class="card"${open ? ' open' : ''}><summary>${rich(c.title)}</summary><p>${rich(c.body || '')}</p>
    ${c.items ? `<ul>${c.items.map(x => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}${linksBlock(c.links)}${sourcesBlock(c.sources, c.facts)}<div class="termbox" hidden></div></details>`;
}
function checklistBlock(items, checked) {
  const n = items.filter(i => checked[i.id]).length;
  return `<details class="more" id="checklist" data-cl="1"><summary>チェックリスト <small class="cnt">${n} / ${items.length}</small></summary>
    <p class="help">項目の「確かめ方」を開くと、確認の方法・聞く先・聞き方の例が出ます。</p>
    <ul class="checklist">${items.map(i => `<li><label><input type="checkbox" data-act="check" data-id="${i.id}"${checked[i.id] ? ' checked' : ''}> ${rich(i.text)}</label>
      ${i.how || i.ask || i.script ? `<details class="how"><summary>確かめ方</summary>${i.how ? `<p><b>どうやって</b>：${rich(i.how)}</p>` : ''}${i.ask ? `<p><b>どこに聞く</b>：${rich(i.ask)}</p>` : ''}${i.script ? `<p><b>聞き方の例</b>：${rich(i.script)} <button class="btn slim" data-act="copy" data-text="${esc(plain(i.script))}">コピー</button></p>` : ''}</details>` : ''}</li>`).join('')}</ul><div class="termbox" hidden></div></details>`;
}
const more = (title, inner, open = false) => inner ? `<details class="more"${open ? ' open' : ''}><summary>${title}</summary>${inner}</details>` : '';

function regionBlock() {
  const r = cur.file.region;
  const prefs = G.areas?.prefs || [];
  const pref = prefs.find(p => p.code === r?.pref);
  let info = '';
  if (r && cur.file.domain !== 'minpaku') {
    // 民泊以外の分野は、地域ごとの確認済み情報をまだ持っていない。推測では出さず、窓口探しだけを案内する
    info += `<p class="note">この地域の条例や担当窓口は、この分野ではまだ確認できていません（要確認）。ほかの自治体のルールを当てはめず、推測ではお出ししません。下のボタンから、お住まいの自治体の窓口を探せます。</p>`;
    info += linksBlock([{ type: 'todokeru-contacts' }]);
  } else if (r) {
    const area = (G.focus?.areas || []).find(a => a.code === r.code && a.status === 'verified');
    const lists = [...(G.lists?.byCode?.[r.code] || []), ...(G.lists?.byCode?.[r.pref] || [])];
    const KINDS = { jutaku: '届出の民泊（住宅宿泊事業）', ryokan: '旅館業', tokku: '特区民泊' };
    if (area) info += `<div class="box ok"><b>${esc(area.name)}の確認済み情報</b>（確認日 ${esc(area.checked)}）
      ${area.rules.map(x => `<p><b>${esc(x.title)}</b>：${esc(x.summary)}${x.effective ? `（施行 ${esc(x.effective)}）` : ''}</p>`).join('')}
      ${area.contacts.map(c => `<p>${esc(c.dept)}${c.tel ? ` <a href="tel:${esc(c.tel.replace(/[^0-9]/g, ''))}">${esc(c.tel)}</a>` : ''}${c.hours ? `（${esc(c.hours)}）` : ''}${c.url ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener">ページ↗</a>` : ''}</p>`).join('')}</div>`;
    if (lists.length) info += `<div class="box"><b>自治体が公開している施設の一覧</b><ul>${lists.map(l => `<li>${KINDS[l.kind] || ''}：<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a><br><small>${esc(l.owner)}・資料の時点 ${esc(l.dataDate || '不明')}・確認日 ${esc(l.checked || '')}</small></li>`).join('')}</ul>
      <p><small>一覧に載っていなくても、更新の時期のずれや別の営業の種類のことがあります。「無許可」と決めつけず、窓口に確認してください。</small></p></div>`;
    if (!area) info += `<p class="note">この地域の民泊のルール（条例）と担当窓口は、まだこのサイトでは確認できていません（要確認）。推測ではお出ししません。下のボタンから窓口を探せます。</p>`;
    info += linksBlock([{ type: 'todokeru-contacts' }, { type: 'minpaku-map' }]);
  }
  return `<details class="more region"${r ? ' open' : ''}><summary>お住まいの地域（選ぶと窓口探しが加わります）</summary>
    <div class="row"><select data-act="pref" aria-label="都道府県"><option value="">都道府県</option>${prefs.map(p => `<option value="${p.code}"${p.code === r?.pref ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <select data-act="city" aria-label="市区町村"${pref ? '' : ' disabled'}><option value="">市区町村</option>${(pref?.cities || []).map(([c, n]) => `<option value="${c}"${c === r?.code ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    ${info}</details>`;
}

// 「今の状況」：答えを短くつなげる。困りごと・したこと・相手・結果を優先して5つまで（全部は「答えた内容」で見られる）
const KEY_LABEL = /^(状況|困りごと)$|困っていること|心配なこと|起きていること|したこと|相手|相談した|結果|回答|様子|情報の状況/;
function nowText(sum) {
  const pri = sum.filter(s => KEY_LABEL.test(s.label));
  const pick = new Set(pri.length >= 5 ? pri.slice(0, 5) : [...pri, ...sum.filter(s => !pri.includes(s)).slice(0, 5 - pri.length)]);
  return sum.filter(s => pick.has(s)).map(s => (/^(状況|困りごと)$/.test(s.label) ? s.value : `${s.label}：${s.value}`)).join('／');
}

function viewResult() {
  const c = ctx(), file = cur.file;
  if (c.state.node !== E.RESULT) { location.hash = `${c.base}/q`; return; }
  const isRound = c.roundId !== 'main';
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
  const docsN = allDocs().length;
  FX = c.data.facts;
  const html = `
    <p class="crumb"><a href="#/">トップ</a>${isRound ? ` › <a href="#/f/${file.id}/result">${esc(file.title || '診断の結果')}</a>` : ''}</p>
    <h1>${isRound ? `次の一手（${nth}回目）` : '診断の結果'}</h1>
    <div class="box now"><b>今の状況</b><p>${esc(nowText(sum))}</p>
      <details><summary>答えた内容をすべて見る</summary><ul>${sum.map(s => `<li>${esc(s.label)}：<b>${esc(s.value)}</b></li>`).join('')}</ul><button class="btn slim" data-act="edit">答えを直す</button></details></div>
    ${outcome ? `<p class="note">「対応の記録」で今の状態を「${esc(STATUS.find(s => s.value === st).label)}」にしているので、それに合わせた案内を出しています。<a href="#/f/${file.id}/records">状態を変える</a></p>` : ''}
    ${r.cause.length ? `<section><h2>うまくいかなかった理由の見立て</h2>${r.cause.slice(0, 2).map(x => `<div class="box cause"><b>${rich(x.title.replace(/^見立て：/, ''))}</b><p>${rich(x.body)}</p>${sourcesBlock(x.sources, x.facts)}<div class="termbox" hidden></div></div>`).join('')}</section>` : ''}
    <section><h2>次にすること</h2>
      ${top.length ? top.map((x, i) => todoCard(x, i, i === 0, chosen)).join('') : r.none.map(x => `<div class="box warn-box"><b>${rich(x.title)}</b><p>${rich(x.body)}</p>${x.items ? `<ul>${x.items.map(t => `<li>${rich(t)}</li>`).join('')}</ul>` : ''}${linksBlock(x.links)}</div>`).join('')}
    </section>
    <section class="start"><h2>行動を始める</h2><div class="row wrap">
      ${docsN ? `<a class="btn" href="#/f/${file.id}/doc">問い合わせ文・要望書を作る</a>` : ''}
      <a class="btn" href="#checklist" data-act="opencl">チェックリストを使う</a>
      <a class="btn primary" href="#/f/${file.id}/records">対応を記録する</a></div></section>
    ${more(`そのほかにできること（${rest.length}件）`, rest.map((x, i) => todoCard(x, i + 3, false, chosen)).join(''))}
    ${more(`すでに試したこと・選んだこと（${tried.length}件・同じ提案はしません）`, tried.length ? `<ul>${tried.map(x => `<li>${rich(x.title)}</li>`).join('')}</ul>` : '')}
    ${more('また起きたとき・ほかの困りごとが残るとき', r.recur.map((x, i) => todoCard(x, i, false, chosen)).join(''))}
    ${more(`まず確認すること（${r.check.length}件）`, r.check.map(x => infoCard(x)).join(''))}
    ${r.checklist.length ? checklistBlock(r.checklist, file.checks || {}) : ''}
    ${r.dont.length ? `<section><h2>やってはいけないこと</h2>${r.dont.map(x => infoCard(x)).join('')}</section>` : ''}
    ${isRound ? '' : regionBlock()}
    ${isRound ? '' : more('似た問題の事例', (r.cases.length ? r.cases.map(x => caseItem(x, file.domain)).join('') : '<p class="note">似た事例は、確認でき次第追加します。</p>') + `<a class="btn" href="#/cases/${file.domain}">事例集をすべて見る</a>`)}
    <section><h2>うまくいかなかったら</h2>
      <p class="help">行動した結果（回答がない・断られた・不開示・不採択など）を入れると、理由の見立てと、次に取れる手段をご案内します。これまでの答えと記録は引き継ぎます。</p>
      ${!isRound && lad.next ? `<div class="box"><b>この分野の次の段階：${esc(lad.next.title)}</b><p>${rich(lad.next.body)}</p>${linksBlock(lad.next.links)}</div>` : ''}
      ${r.ifnot.filter(x => !/段階/.test(x.title)).map(x => infoCard(x)).join('')}
      <a class="btn big primary" href="#/f/${file.id}/next/new">次の一手を探す</a>
      ${rounds.length ? `<ul class="files">${rounds.map((x, i) => `<li><a href="#/f/${file.id}/next/${x.id}${x.done ? '' : '/q'}">次の一手（${i + 1}回目）<span class="meta">${fmtDate(x.createdAt)}${x.done ? '' : '・途中'}</span></a></li>`).join('')}</ul>` : ''}
    </section>
    <div class="row wrap noprint"><button class="btn" data-act="restart">この診断を最初からやり直す</button><button class="btn" data-act="print">印刷・PDF</button></div>
    <p class="note">この結果は、対応の仕方を整理するためのもので、法的な判断ではありません。</p>`;
  setView(html, isRound ? '次の一手' : '診断の結果');
}

// 事例の分野は、表示している一覧の分野を必ず渡す（開いている相談の分野を使うと、別の分野の事例に入れない）
function caseItem(c, domain) {
  return `<a class="case" href="#/case/${domain}/${c.id}"><span class="tag o-${c.outcome}">${OUTCOME[c.outcome]}</span>
    <b>${esc(c.title)}</b><span class="meta">${esc(c.place?.pref || '')}${esc(c.place?.city || '')}・${esc(c.period || '')}</span><span>${esc(c.lesson || '')}</span></a>`;
}

// ---------- 画面：自分で行動する ----------
function viewAct() {
  setView(`<p class="crumb"><a href="#/">トップ</a></p><h1>自分で行動する</h1>
    <p class="lead">使いたい手段が決まっている方へ。どの手段にも、向いている場面と限界があります。何をしたいのかを決めてから選びましょう。</p>
    <div class="box"><b>迷ったら</b><p>困りごとの分野から診断すると、目的に合った手段を順番にご案内します。すでに行動してうまくいかなかったときは「役所の対応」から、理由の見立てと次の手段を探せます。</p>
      <div class="row wrap"><a class="btn" href="#/">分野から診断する</a><a class="btn" href="#/start/gyosei">役所の対応から探す</a></div></div>
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
  const d = G.domains.find(x => x.id === domain);
  const out = q.o || '', kind = q.k || '';
  const list = data.cases.filter(c => (!out || c.outcome === out) && (!kind || c.sources.some(s => (G.sources[s.sourceId]?.kind || s.kind) === kind)));
  setView(`<p class="crumb"><a href="#/">トップ</a> › <a href="#/start/${domain}">${esc(d?.name || data.tree.title)}</a></p>
    <h1>似た問題の事例集</h1>
    <p class="note">一次資料（自治体・議会・裁判所など）で確認できた事例だけを載せています。確認できない点は「不明」としています。報道された要望と、役所が実際に行ったことは分けて書いています。</p>
    <div class="row"><select data-act="cfilter" data-k="o" aria-label="結果で絞り込む"><option value="">結果：すべて</option>${Object.entries(OUTCOME).map(([k, v]) => `<option value="${k}"${k === out ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <select data-act="cfilter" data-k="k" aria-label="資料の種類で絞り込む"><option value="">資料：すべて</option>${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    ${list.length ? list.map(c => caseItem(c, domain)).join('') : '<p class="note">この分野で、一次資料で確かめられた事例はまだありません。確認でき次第追加します。</p>'}`, '事例集');
}

async function viewCase(domain, id) {
  const data = await loadDomain(domain);
  const c = data.cases.find(x => x.id === id);
  if (!c) return viewCases(domain);
  const row = (k, v) => `<dt>${k}</dt><dd>${v ? esc(v) : '<span class="muted">不明</span>'}</dd>`;
  setView(`<p class="crumb"><a href="#/cases/${domain}">事例集</a></p>
    <h1>${esc(c.title)}</h1><p><span class="tag o-${c.outcome}">${OUTCOME[c.outcome]}</span></p>
    <dl class="case-detail">${row('地域', (c.place?.pref || '') + (c.place?.city || ''))}${row('時期', c.period)}${row('最初の状況', c.situation)}${row('問題の概要', c.issue)}${row('住民や行政・議会の対応', c.response)}${row('使われた法律・条例・制度', (c.laws || []).join('、'))}${row('結果', c.result || OUTCOME[c.outcome])}${row('その後の動き', c.after)}${row('参考になる点', c.lesson)}</dl>
    <h2>根拠資料</h2><ul>${c.sources.map(s => { const x = G.sources[s.sourceId] || {}; return `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || s.sourceId)}</a><br><small>${KIND[x.kind || s.kind] || ''}・${esc(x.publisher || '')}・公表 ${esc(x.published || '不明')}・確認日 ${esc(x.checked || c.checked || '')}</small></li>`; }).join('')}</ul>`, c.title);
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

function viewDocs() {
  const { file } = cur;
  const ds = allDocs();
  const item = d => `<a class="btn big left" href="#/f/${file.id}/doc/${d.id}"><b>${esc(d.title)}</b><br><small>${esc(d.desc)}</small></a>`;
  setView(`<p class="crumb"><a href="#/f/${file.id}/result">診断の結果</a></p>
    <h1>文書の下書きを作る</h1>
    <p class="note">入力した事実だけで文章を組み立てます。入力していないことは書きません。出す前に必ず読み直して直してください。</p>
    <div class="stack">${ds.filter(d => !d.common).map(item).join('')}</div>
    ${ds.some(d => d.common) ? `<h2>役所とのやりとりに使う文書</h2><div class="stack">${ds.filter(d => d.common).map(item).join('')}</div>` : ''}
    <h2>届け方は「声を届ける」で</h2><p class="help">電話のかけ方、メール・手紙の送り方、情報公開請求・請願・陳情・パブコメの手続きは、姉妹サイト「声を届ける」で詳しく案内しています。</p>
    ${linksBlock([{ type: 'todokeru-guide', guide: 'phone', label: '電話のかけ方' }, { type: 'todokeru-guide', guide: 'email', label: 'メール・手紙の送り方' }, { type: 'todokeru-contacts', label: '窓口を探す' }])}`, '文書の下書き');
}

function viewDoc(docId) {
  const { file } = cur;
  const d = allDocs().find(x => x.id === docId);
  if (!d) return viewDocs();
  const saved = file.docs?.[docId];
  const values = { ...docPrefill(d), ...(saved?.values || {}) };
  const text = saved?.edited ? saved.text : renderDoc(d, values);
  const field = f => {
    const v = esc(values[f.id] || '');
    const input = f.type === 'textarea' ? `<textarea data-act="field" data-f="${f.id}" rows="3" placeholder="${esc(f.placeholder || '')}">${v}</textarea>`
      : `<input type="${f.type === 'date' ? 'date' : 'text'}" data-act="field" data-f="${f.id}" value="${v}" placeholder="${esc(f.placeholder || '')}">`;
    return `<label class="field"><span>${esc(f.label)}${f.optional ? ' <small>（なくても可）</small>' : ''}</span>${f.help ? `<small>${esc(f.help)}</small>` : ''}${input}</label>`;
  };
  setView(`<p class="crumb"><a href="#/f/${file.id}/doc">文書の一覧</a></p>
    <h1>${esc(d.title)}</h1><p class="help">${esc(d.desc)}</p>
    <section class="card plainc"><h2>1. 事実を入れる</h2><p class="note">わかることだけ入れてください。空欄の項目は、文章に出てきません。</p>${d.fields.map(field).join('')}</section>
    <section class="card plainc"><h2>2. できた下書き（ここで直せます）</h2>
      <p class="warn" id="editwarn" role="status"${saved?.edited ? '' : ' hidden'}>手で直した下書きです。これからは上の欄を変えても、この下書きには反映されません（手で直した内容はそのまま残ります）。<button class="btn slim" data-act="regen">欄の内容で作り直す</button></p>
      <textarea id="doctext" data-act="doctext" rows="14">${esc(text)}</textarea>
      <div class="row"><button class="btn" data-act="copydoc">コピー</button><button class="btn" data-act="savedoc">テキストで保存</button><button class="btn" data-act="print">印刷・PDF</button></div></section>
    <section class="card plainc"><h2>3. 出す前の確認</h2><ul class="checklist">${(d.checks || []).map(c => `<li><label><input type="checkbox"> ${esc(c)}</label></li>`).join('')}</ul></section>
    ${d.links ? `<h2>届け方</h2>${linksBlock(d.links)}` : ''}`, d.title);
}

// ---------- 画面：記録 ----------
function recLabels() {
  const L = cur.data.ladder, C = cur.next?.ladder?.commonRecordTypes || {};
  return { toType: { ...(L.recordTypes || {}), ...Object.fromEntries(Object.entries(C).filter(([k]) => !(L.recordTypes || {})[k])) }, method: L.methods || {}, state: L.states || {} };
}
function viewRecords(editId) {
  const { file, data } = cur;
  const L = recLabels();
  const st = currentStatus(file);
  const lad = ladderState(data.ladder, file.state.facts, file.records);
  const rs = (file.records || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const ed = (file.records || []).find(r => r.id === editId) || { date: today(), toType: '', method: '', state: 'doing' };
  const sel = (name, map, val) => `<select name="${name}"><option value="">選んでください</option>${Object.entries(map).map(([k, v]) => `<option value="${k}"${k === val ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  let next = '';
  if (st === 'resolved') next = '<div class="box ok"><b>解決したと記録されています。</b><p>記録は残しておくと、また起きたときに役立ちます。</p></div>';
  else {
    if (['partial', 'same', 'worse'].includes(st)) next += `<div class="box"><b>「${esc(STATUS.find(s => s.value === st).label)}」と記録されています。</b><p>これまでの診断と記録を引き継いで、理由の見立てと次に取れる手段を探せます。同じ情報を最初から入れ直す必要はありません。</p><a class="btn big primary" href="#/f/${file.id}/next/new">次の一手を探す</a></div>`;
    else if (lad.next) next += `<div class="box"><b>次の段階：${esc(lad.next.title)}</b><p>${rich(lad.next.body)}</p>${linksBlock(lad.next.links)}</div>`;
  }
  if (lad.repeated.length && st !== 'resolved') next += `<p class="warn">${lad.repeated.map(t => esc((L.toType[t.toType] || '') + (t.toName ? `（${t.toName}）` : ''))).join('・')}には2回以上相談しています。同じ相談を繰り返すより、回答の内容を記録して、「次の一手を探す」で別の手段を考えましょう。</p>`;
  if (lad.planned.length) next += `<p class="note">予定（まだしていないこと）の記録が${lad.planned.length}件あります。予定は「済んだこと」に数えていません。実際にしたら、その記録の「直す」から、日付・回答・状況を書き足してください。</p>`;
  setView(`<p class="crumb"><a href="#/f/${file.id}/result">診断の結果</a></p>
    <h1>対応の記録</h1>
    <p class="help">${esc(file.title || '')}</p>
    <p class="note">この端末の中だけに保存されます。ブラウザのデータを消すと記録も消えるので、大事な記録は「テキストで保存」か<a href="#/data">バックアップ</a>で残してください。共有の端末では、終わったら<a href="#/data">データを削除</a>してください。</p>
    <section class="card plainc"><h2>今の状態</h2><p class="help">行動のあと、結果を選んでください。</p><div class="row wrap">${STATUS.map(s => `<label class="pill"><input type="radio" name="status" value="${s.value}"${st === s.value ? ' checked' : ''} data-act="status"> ${s.label}</label>`).join('')}</div>
      ${(file.statusLog || []).length ? `<details><summary>状態の変化（${file.statusLog.length}件）</summary><ul>${file.statusLog.map(s => `<li>${esc(s.date)}：${STATUS.find(x => x.value === s.status)?.label}</li>`).join('')}</ul></details>` : ''}</section>
    <section><h2>次の一手</h2>${next || '<p class="note">記録をつけると、次の一手をご案内します。</p>'}
      ${st !== 'resolved' && !['partial', 'same', 'worse'].includes(st) ? `<a class="btn" href="#/f/${file.id}/next/new">次の一手を探す（記録を引き継ぎます）</a>` : ''}</section>
    <section class="card plainc"><h2>${editId ? '記録を直す' : '記録を追加する'}</h2>
      <form id="recform" data-id="${esc(ed.id || '')}">
        <label class="field"><span>日付</span><input type="date" name="date" value="${esc(ed.date)}"></label>
        <label class="field"><span>相手の種類</span>${sel('toType', L.toType, ed.toType)}</label>
        <label class="field"><span>相手の部署・名前 <small>（なくても可）</small></span><input name="toName" value="${esc(ed.toName || '')}" placeholder="〇〇区 生活衛生課"></label>
        <label class="field"><span>方法</span>${sel('method', L.method, ed.method)}</label>
        <label class="field"><span>したこと・伝えた内容</span><textarea name="content" rows="3">${esc(ed.content || '')}</textarea></label>
        <label class="field"><span>相手からの回答</span><textarea name="response" rows="3">${esc(ed.response || '')}</textarea></label>
        <label class="field"><span>次にすること</span><textarea name="next" rows="2">${esc(ed.next || '')}</textarea></label>
        <label class="field"><span>この件の状況</span>${sel('state', L.state, ed.state)}</label>
        <p class="err" id="err" role="alert"></p>
        <button class="btn big primary" type="submit">${editId ? '直した内容を保存' : '記録を保存'}</button>${editId ? ` <a class="btn" href="#/f/${file.id}/records">やめる</a>` : ''}
      </form></section>
    <section><h2>これまでの記録（${rs.length}件）</h2>
      ${rs.map(r => `<article class="card plainc rec"><b>${esc(r.date)}　${esc(L.toType[r.toType] || '')}${r.toName ? '（' + esc(r.toName) + '）' : ''}</b><span class="meta">${isPlanned(r) ? '<span class="tag">予定</span> ' : ''}${esc(L.method[r.method] || '')}${r.method ? '・' : ''}${esc(L.state[r.state] || '')}</span>
        ${r.content ? `<p><small>したこと・伝えた内容</small><br>${esc(r.content)}</p>` : ''}${r.response ? `<p><small>回答</small><br>${esc(r.response)}</p>` : ''}${r.next ? `<p><small>次にすること</small><br>${esc(r.next)}</p>` : ''}
        <div class="row"><a class="btn slim" href="#/f/${file.id}/records/${r.id}">直す</a><button class="btn slim" data-act="delrec" data-id="${r.id}">削除</button></div></article>`).join('') || '<p class="note">まだ記録はありません。</p>'}</section>
    <div class="row"><button class="btn" data-act="savetxt">テキストで保存</button><button class="btn" data-act="print">印刷・PDF</button></div>`, '対応の記録');
}

// ---------- 画面：その他 ----------
function viewEmergency() {
  setView(`<h1>まず安全を確保してください</h1>
    <div class="box danger"><p>けんか・暴力・不審者の侵入など：<a class="tel" href="tel:110">110</a></p><p>火事・けが・急病：<a class="tel" href="tel:119">119</a></p>
    <p>緊急ではない警察への相談：<a class="tel" href="tel:%239110">#9110</a></p>
    <p>子どもが「死にたい」と言う・いじめで追い詰められているなど（夜間・休日も、子ども本人も保護者も）：24時間子供SOSダイヤル <a class="tel" href="tel:0120078310">0120-078310</a></p></div>
    <ul class="points"><li>相手に直接詰め寄らず、離れた安全な場所から連絡してください</li><li>落ち着いたら、いつ・何が起きたかをメモしておくと、後の相談に役立ちます</li></ul>
    <button class="btn big" data-act="histback">前の画面に戻る</button>`, '緊急のとき');
}

function viewData(confirming) {
  const files = S.listFiles();
  setView(`<p class="crumb"><a href="#/">トップ</a></p><h1>保存データの管理</h1>
    <ul class="points"><li>診断の答え・チェック・記録は、この端末のブラウザの中だけに保存されています。サーバーには送っていません。</li>
    <li>ブラウザの履歴やサイトのデータを消すと、記録も消えます。iPhone の Safari では、しばらく開かないと消えることがあります。大事な記録は「バックアップを保存」でファイルに残してください。</li>
    <li>家族や職場と共有している端末では、使い終わったら削除してください。</li></ul>
    <h2>保存されている相談（${files.length}件）</h2>
    ${files.length ? `<ul class="files">${files.map(f => `<li><a href="#/f/${f.id}/${f.done ? 'result' : 'q'}">${esc(f.title || '診断の途中')}</a> <button class="btn slim" data-act="delfile" data-id="${f.id}">削除</button></li>`).join('')}</ul>` : '<p class="note">ありません。</p>'}
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
async function route() {
  const [, a, b, c, d, e] = (location.hash.slice(1).split('?')[0] || '/').split('/');
  const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  try {
    if (!a) return viewHome();
    if (a === 'start') return viewStart(b);
    if (a === 'act') return viewAct();
    if (a === 'cases' && !b) return viewCaseDomains();
    if (a === 'cases') return viewCases(b, q);
    if (a === 'case') return viewCase(b, c);
    if (a === 'emergency') return viewEmergency();
    if (a === 'data') return viewData(false);
    if (a === 'about') return viewAbout();
    if (a === 'f') {
      const file = openFile(b); if (!file) return;
      cur = { file, data: await loadDomain(file.domain), next: await loadDomain(N.NEXT_DOMAIN), round: null };
      if (c === 'q') return viewQuestion();
      if (c === 'result') return viewResult();
      if (c === 'doc') return d ? viewDoc(d) : viewDocs();
      if (c === 'records') return viewRecords(d);
      if (c === 'next') {
        const rounds = file.rounds || [];
        if (!d || d === 'new') {
          // 途中の回があれば、新しく作らずに続きへ
          const open = rounds.find(r => !r.done);
          if (open) { location.replace(`#/f/${file.id}/next/${open.id}/q`); return; }
          return startRound();
        }
        cur.round = rounds.find(r => r.id === d) || null;
        if (!cur.round) { location.replace(`#/f/${file.id}/result`); return; }
        return e === 'q' ? viewQuestion() : viewResult();
      }
    }
    viewHome();
  } catch (err) {
    setView(`<h1>表示できませんでした</h1><p>${esc(err.message)}</p><a class="btn" href="#/">トップへ</a>`);
  }
}

// ---------- 操作 ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'button')) return;
  const act = t.dataset.act;
  if (act === 'new') { const data = await loadDomain(t.dataset.domain); const f = S.createFile(t.dataset.domain, E.begin(data.tree)); saved(); location.hash = `#/f/${f.id}/q`; }
  else if (act === 'startans') {
    const dom = t.dataset.domain;
    const [data, next] = await Promise.all([loadDomain(dom), loadDomain(N.NEXT_DOMAIN)]);
    const f = S.createFile(dom, E.begin(data.tree));
    cur = { file: f, data, next, round: null };
    doAnswer(t.dataset.v);
  }
  else if (act === 'ans') doAnswer(t.dataset.v);
  else if (act === 'multi') {
    const v = [...main.querySelectorAll('fieldset input:checked')].map(x => x.value);
    if (!v.length) { document.getElementById('err').textContent = 'どれか1つ以上選んでください'; return; }
    doAnswer(v);
  }
  else if (act === 'back') {
    const c = ctx();
    if (!c.state.history.length) { location.hash = c.roundId === 'main' ? `#/start/${cur.file.domain}` : `#/f/${cur.file.id}/result`; return; }
    c.holder.state = E.back(c.state); save(); viewQuestion();
  }
  else if (act === 'edit') { const c = ctx(); c.holder.state = E.back(c.state); c.holder.done = false; save(); location.hash = `${c.base}/q`; }
  else if (act === 'restart') {
    const c = ctx();
    if (c.roundId === 'main') c.holder.state = E.begin(c.tree);
    else c.holder.state = N.newRound(c.tree, { ...cur.file, rounds: (cur.file.rounds || []).filter(r => r.id !== c.roundId) }, c.roundId).state;
    c.holder.done = false; c.holder.prev = {}; save();
    location.hash === `${c.base}/q` ? viewQuestion() : (location.hash = `${c.base}/q`);
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
  else if (act === 'opencl') { e.preventDefault(); const d = document.getElementById('checklist'); if (d) { d.open = true; d.scrollIntoView(); } }
  else if (act === 'term') {
    const box = t.closest('details, .box, main')?.querySelector('.termbox') || main.querySelector('.termbox');
    const gl = cur?.round ? { ...cur.data.glossary, ...cur.next.glossary } : { ...(cur?.next?.glossary || {}), ...(cur?.data?.glossary || {}) };
    let txt = gl[t.dataset.term];
    if (!txt && !cur) { const dom = location.hash.split('/')[2]; txt = cache[dom]?.glossary?.[t.dataset.term] || cache[N.NEXT_DOMAIN]?.glossary?.[t.dataset.term]; }
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
  else if (act === 'delfile') { if (!confirm('この相談の答え・記録をすべて削除します。元に戻せません。よろしいですか？')) return; S.removeFile(t.dataset.id); saved(); viewData(false); }
  else if (act === 'backup') download(`困りごと次どうする_バックアップ_${new Date().toLocaleDateString('sv-SE')}.json`, S.backupText(), 'application/json');
  else if (act === 'wipe') viewData(true);
  else if (act === 'wipe2') { S.clearAll(); viewData(false); document.getElementById('msg').textContent = 'このサイトの記録をすべて削除しました。'; }
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
  else if (act === 'pref') { const p = (G.areas?.prefs || []).find(x => x.code === t.value); cur.file.region = p ? { pref: p.code, prefName: p.name, code: '', cityName: '' } : null; save(); viewResult(); main.querySelector('.region')?.scrollIntoView(); }
  else if (act === 'city') { const p = (G.areas?.prefs || []).find(x => x.code === cur.file.region?.pref); const c = p?.cities.find(([k]) => k === t.value); cur.file.region = { ...cur.file.region, code: c ? c[0] : '', cityName: c ? c[1] : '' }; save(); viewResult(); main.querySelector('.region')?.scrollIntoView(); }
  else if (act === 'status') { cur.file.statusLog = [...(cur.file.statusLog || []), { date: today(), status: t.value }]; save(); viewRecords(); }
  else if (act === 'cfilter') { const q = new URLSearchParams(location.hash.split('?')[1] || ''); t.value ? q.set(t.dataset.k, t.value) : q.delete(t.dataset.k); location.hash = location.hash.split('?')[0] + (q.toString() ? '?' + q : ''); }
  else if (act === 'restore' && t.files[0]) { try { const n = S.restore(await t.files[0].text()); saved(); viewData(false); document.getElementById('msg').textContent = S.lastOk ? `${n}件の相談を戻しました。` : `${n}件の相談を画面に戻しましたが、この端末には保存できませんでした。`; } catch (er) { document.getElementById('msg').textContent = er.message; } }
});

document.addEventListener('input', e => {
  const t = e.target, act = t.dataset.act;
  if (act !== 'field' && act !== 'doctext') return;
  const id = location.hash.split('/')[4];
  const d = allDocs().find(x => x.id === id);
  if (!d) return;
  const sv = (cur.file.docs ||= {})[id] || (cur.file.docs[id] = { values: { ...docPrefill(d) }, edited: false, text: '' });
  if (act === 'field') {
    sv.values[t.dataset.f] = t.value;
    if (!sv.edited) document.getElementById('doctext').value = renderDoc(d, sv.values);
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
  if (!fd.date || !fd.toType) { document.getElementById('err').textContent = '日付と相手の種類を入れてください'; return; }
  if (fd.date > today() && fd.state !== 'todo') { document.getElementById('err').textContent = '日付が今日より先です。まだしていないことなら、「この件の状況」を「これからする（予定）」にしてください。'; return; }
  const id = e.target.dataset.id;
  const recs = cur.file.records || [];
  if (id) Object.assign(recs.find(r => r.id === id), fd); else recs.push({ id: S.newId(), ...fd });
  cur.file.records = recs; save();
  location.hash = `#/f/${cur.file.id}/records`;
  if (!id) viewRecords();
});

window.addEventListener('hashchange', route);
loadCommon().then(route);
