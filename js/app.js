// 画面の組み立て。URL の # 以降で画面を切り替える（# 以降はサーバーに送られない）。
import * as E from './engine.js';
import * as S from './store.js';
import { renderDoc } from './docs.js';
import { STATUS, STATUS_OUTCOME, ladderState, currentStatus, recordsText, isPlanned } from './records.js';

const main = document.getElementById('main');
const G = { sources: {}, links: {}, domains: [], areas: null, lists: null, focus: null };
const cache = {};
let cur = null; // { file, data }

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
const KIND = { law: '法令', ordinance: '条例', guideline: '国の指針・ガイドライン', official: '公式発表', minutes: '議会議事録', court: '裁判例', news: '報道' };
const OUTCOME = { resolved: '解決', partial: '一部改善', unresolved: '未解決', unknown: '結果不明' };

async function loadCommon() {
  const [domains, sources, links, areas, lists, focus] = await Promise.all([
    getJSON('data/domains.json'), getJSON('data/sources.json'), getJSON('data/links.json'),
    getJSON('data/regions/areas.json'), getJSON('data/regions/minpaku-lists.json'), getJSON('data/regions/focus.json')
  ]);
  G.domains = domains?.domains || [];
  for (const s of sources?.sources || []) G.sources[s.id] = s;
  G.links = links || {}; G.areas = areas; G.lists = lists; G.focus = focus;
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
  document.title = (title ? title + '｜' : '') + '暮らしの問題解決ナビ';
  const h = main.querySelector('h1');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}

// ---------- 画面：トップ ----------
function viewHome() {
  const files = S.listFiles();
  const ds = G.domains.map(d => d.status === 'active'
    ? `<a class="btn big primary" href="#/start/${d.id}">${esc(d.name)}</a>`
    : `<div class="btn big off" aria-disabled="true">${esc(d.name)}<span class="tag">準備中</span></div>`).join('');
  setView(`
    <h1>何に困っていますか？</h1>
    <p class="lead">あなたの状況を「はい・いいえ・わからない」で整理して、次にすることをご案内します。</p>
    <div class="stack">${ds}</div>
    ${files.length ? `<h2>続きから</h2>${fileList(files)}` : ''}
    <p class="note">入力した内容は、この端末の中だけに保存されます。サーバーへは送りません。<a href="#/data">保存データの管理</a></p>`);
}

function fileList(files) {
  return `<ul class="files">${files.map(f => {
    const st = currentStatus(f);
    return `<li><a href="#/f/${f.id}/${f.done ? 'result' : 'q'}"><b>${esc(f.title || '診断の途中')}</b>
      <span class="meta">${fmtDate(f.updatedAt)} 更新${st ? '・' + STATUS.find(s => s.value === st).label : f.done ? '' : '・途中'}</span></a></li>`;
  }).join('')}</ul>`;
}

async function viewStart(domain) {
  const d = G.domains.find(x => x.id === domain && x.status === 'active');
  if (!d) return viewHome();
  const data = await loadDomain(domain);
  const files = S.listFiles().filter(f => f.domain === domain);
  setView(`
    <p class="crumb"><a href="#/">トップ</a></p>
    <h1>${esc(data.tree.title)}</h1>
    <p class="lead">${esc(d.intro || '')}</p>
    <ul class="points"><li>質問は最大${data.tree.maxQuestions}問、1〜3分ほどです</li><li>わからない質問は「わからない」で進めます</li><li>結果は法的な判断ではなく、対応を整理するためのものです</li></ul>
    <button class="btn big primary" data-act="new" data-domain="${domain}">診断を始める</button>
    ${files.length ? `<h2>前回の続き</h2>${fileList(files)}` : ''}
    <h2>ほかに見られるもの</h2>
    <div class="stack"><a class="btn" href="#/cases/${domain}">似た問題の事例集</a><a class="btn" href="#/emergency">今まさに危険なとき</a></div>`, d.name);
  if (!S.available()) main.insertAdjacentHTML('afterbegin', '<p class="warn">この端末・ブラウザでは保存ができません（プライベートモードなど）。画面を閉じると内容は消えます。</p>');
}

// ---------- 画面：質問 ----------
function viewQuestion() {
  const { file, data } = cur;
  const tree = data.tree;
  const st = file.state;
  if (st.node === E.RESULT) { location.hash = `#/f/${file.id}/result`; return; }
  const node = tree.nodes[st.node];
  const n = st.history.length + 1, max = st.history.length + E.maxRemaining(tree, st.node);
  const prev = file.prev?.[st.node];
  const opts = E.optionsOf(tree, node);
  let body;
  if (node.type === 'yesno') body = `<div class="yn">${opts.map(o => `<button class="btn big${prev === o.value ? ' chosen' : ''}" data-act="ans" data-v="${o.value}">${o.label}</button>`).join('')}</div>`;
  else if (node.type === 'choice') body = `<div class="stack">${opts.map(o => `<div class="opt"><button class="btn big left${prev === o.value ? ' chosen' : ''}" data-act="ans" data-v="${o.value}">${esc(plain(o.label))}</button>${termBtns(o.label)}</div>`).join('')}</div>`;
  else body = `<fieldset class="stack"><legend class="sr">${esc(plain(node.text))}</legend>${opts.map(o => `<div class="opt"><label class="btn big left check"><input type="checkbox" value="${o.value}"${Array.isArray(prev) && prev.includes(o.value) ? ' checked' : ''}${o.exclusive ? ' data-ex="1"' : ''}> <span>${esc(plain(o.label))}</span></label>${termBtns(o.label)}</div>`).join('')}</fieldset>
    <p class="err" id="err" role="alert"></p><button class="btn big primary" data-act="multi">次へ</button>`;
  setView(`
    <a class="btn danger slim" href="#/emergency">今まさに危険なことが起きている</a>
    <div class="progress" aria-label="進み具合"><span>質問 ${n} / 最大 ${max}</span><div class="bar"><i style="width:${Math.round((n / max) * 100)}%"></i></div></div>
    <h1 class="q">${rich(node.text)}</h1>
    ${node.help ? `<p class="help">${rich(node.help)}</p>` : ''}
    <div class="termbox" hidden></div>
    ${body}
    <div class="nav"><button class="btn" data-act="back">← 戻る</button><button class="btn" data-act="restart">最初からやり直す</button></div>`, '診断');
}

function doAnswer(value) {
  const { file, data } = cur;
  try {
    file.prev = { ...(file.prev || {}), [file.state.node]: value };
    file.state = E.answer(data.tree, file.state, value);
  } catch (e) { alert(e.message); return; }
  if (file.state.node === E.RESULT) {
    file.done = true;
    if (!file.title) file.title = `${data.tree.title}：${E.labelOf(data.tree, 'situation', file.state.facts.situation)}（${new Date().toLocaleDateString('ja-JP')}）`;
    save(); location.hash = `#/f/${file.id}/result`; return;
  }
  save(); viewQuestion();
}

// ---------- 画面：結果 ----------
function sourcesBlock(ids = [], factIds = []) {
  const fs = factIds.map(id => cur.data.facts[id]).filter(Boolean);
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
    case 'doc': return `#/f/${f.id}/doc/${l.doc}`;
    case 'records': return `#/f/${f.id}/records`;
    case 'tel': return 'tel:' + l.tel.replace(/[^0-9#+]/g, '');
    default: return l.url || '#/';
  }
}
function linksBlock(links = []) {
  if (!links.length) return '';
  return `<div class="links">${links.map(l => {
    const ext = !['doc', 'records', 'tel'].includes(l.type);
    const label = l.label || G.links.labels?.[l.type] || 'ひらく';
    return `<a class="btn" href="${esc(linkHref(l))}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(label)}${ext ? ' ↗' : ''}</a>`;
  }).join('')}</div>`;
}

function todoCard(c, i, open = i === 0) {
  const script = plain(c.script);
  return `<details class="card todo"${open ? ' open' : ''}><summary><span class="num">${i + 1}</span>${rich(c.title)}</summary>
    ${c.body ? `<p>${rich(c.body)}</p>` : ''}
    <dl>
      <dt>どこへ</dt><dd>${rich(c.where)}</dd>
      <dt>確認すること</dt><dd>${rich(c.check)}</dd>
      <dt>用意するもの</dt><dd><ul>${c.bring.map(b => `<li>${rich(b)}</li>`).join('')}</ul></dd>
      <dt>聞き方・伝え方の例</dt><dd class="script">${rich(c.script)}<br><button class="btn slim" data-act="copy" data-text="${esc(script)}">この文をコピー</button></dd>
      <dt>答えが得られなかったら</dt><dd>${rich(c.ifNoAnswer)}</dd>
    </dl>${linksBlock(c.links)}${sourcesBlock(c.sources, c.facts)}<div class="termbox" hidden></div></details>`;
}
function infoCard(c, open = false) {
  return `<details class="card"${open ? ' open' : ''}><summary>${rich(c.title)}</summary><p>${rich(c.body || '')}</p>
    ${c.items ? `<ul>${c.items.map(x => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}${linksBlock(c.links)}${sourcesBlock(c.sources, c.facts)}<div class="termbox" hidden></div></details>`;
}

function regionBlock() {
  const r = cur.file.region;
  const prefs = G.areas?.prefs || [];
  const pref = prefs.find(p => p.code === r?.pref);
  let info = '';
  if (r && cur.file.domain !== 'minpaku') {
    // 民泊以外の分野は、地域ごとの確認済み情報をまだ持っていない。推測では出さず、窓口探しだけを案内する
    info += `<p class="note">この地域の条例や担当窓口は、この分野ではまだ確認できていません。推測ではお出ししません。下のボタンから、お住まいの自治体の窓口を探せます。</p>`;
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
    if (!area) info += `<p class="note">この地域の民泊のルール（条例）と担当窓口は、まだこのサイトでは確認できていません。推測ではお出ししません。下のボタンから窓口を探せます。</p>`;
    info += linksBlock([{ type: 'todokeru-contacts' }, { type: 'minpaku-map' }]);
  }
  return `<section class="region"><h2>お住まいの地域</h2>
    <p class="help">選ぶと、地域の情報と窓口探しが加わります（選ばなくても使えます）。</p>
    <div class="row"><select data-act="pref" aria-label="都道府県"><option value="">都道府県</option>${prefs.map(p => `<option value="${p.code}"${p.code === r?.pref ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <select data-act="city" aria-label="市区町村"${pref ? '' : ' disabled'}><option value="">市区町村</option>${(pref?.cities || []).map(([c, n]) => `<option value="${c}"${c === r?.code ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    ${info}</section>`;
}

function viewResult() {
  const { file, data } = cur;
  if (file.state.node !== E.RESULT) { location.hash = `#/f/${file.id}/q`; return; }
  const st = currentStatus(file);
  // 記録の画面で選んだ「今の状態」があれば、診断のときの答え（その後どうなったか）より優先する
  const outcome = STATUS_OUTCOME[st];
  const facts = outcome ? { ...file.state.facts, outcome } : file.state.facts;
  const r = E.compose(data, facts);
  const sum = E.summarize(data.tree, file.state);
  const lad = ladderState(data.ladder, facts, file.records);
  const checked = file.checks || {};
  const nDone = r.checklist.filter(i => checked[i.id]).length;
  setView(`
    <p class="crumb"><a href="#/">トップ</a></p>
    <h1>診断の結果</h1>
    <p class="note">この結果は、対応の仕方を整理するためのもので、法的な判断ではありません。</p>
    <details class="card sum"><summary>あなたの状況（答えた内容）</summary><ul>${sum.map(s => `<li>${esc(s.label)}：<b>${esc(s.value)}</b></li>`).join('')}</ul>
      <button class="btn slim" data-act="edit">答えを直す</button></details>
    ${outcome ? `<p class="note">「対応の記録」で今の状態を「${esc(STATUS.find(s => s.value === st).label)}」にしているので、それに合わせた案内を出しています。<a href="#/f/${file.id}/records">状態を変える</a></p>` : ''}
    <section><h2>次にすること</h2>${r.todo.map((c, i) => todoCard(c, i)).join('')}</section>
    ${r.recur.length ? `<section><h2>また起きたとき・ほかの困りごとが残るとき</h2><p class="help">今は必要ありません。再び起きたときや、別の困りごとが残っているときに開いてください。</p>${r.recur.map((c, i) => todoCard(c, i, false)).join('')}</section>` : ''}
    ${regionBlock()}
    <section><h2>まず確認すること</h2>${r.check.map(c => infoCard(c)).join('')}</section>
    <section><h2>チェックリスト <small>${nDone} / ${r.checklist.length}</small></h2>
      <ul class="checklist">${r.checklist.map(i => `<li><label><input type="checkbox" data-act="check" data-id="${i.id}"${checked[i.id] ? ' checked' : ''}> ${rich(i.text)}</label></li>`).join('')}</ul></section>
    <section><h2>やってはいけないこと</h2>${r.dont.map(c => infoCard(c, true)).join('')}</section>
    <section><h2>似た問題の事例</h2>${r.cases.length ? r.cases.map(c => caseItem(c, file.domain)).join('') : '<p class="note">似た事例は、確認でき次第追加します。</p>'}
      <a class="btn" href="#/cases/${file.domain}">事例集をすべて見る</a></section>
    <section><h2>解決しなかったら</h2>
      ${lad.next ? `<div class="box"><b>次の段階：${esc(lad.next.title)}</b><p>${rich(lad.next.body)}</p>${linksBlock(lad.next.links)}</div>` : ''}
      ${r.ifnot.map(c => infoCard(c)).join('')}</section>
    <div class="stack sticky-end">
      <a class="btn big primary" href="#/f/${file.id}/records">対応を記録する・状態を残す</a>
      <a class="btn big" href="#/f/${file.id}/doc">連絡文・要望書の下書きを作る</a>
      <button class="btn" data-act="restart">最初からやり直す</button>
    </div>`, '診断の結果');
}

// 事例の分野は、表示している一覧の分野を必ず渡す（開いている相談の分野を使うと、別の分野の事例に入れない）
function caseItem(c, domain) {
  return `<a class="case" href="#/case/${domain}/${c.id}"><span class="tag o-${c.outcome}">${OUTCOME[c.outcome]}</span>
    <b>${esc(c.title)}</b><span class="meta">${esc(c.place?.pref || '')}${esc(c.place?.city || '')}・${esc(c.period || '')}</span><span>${esc(c.lesson || '')}</span></a>`;
}

// ---------- 画面：事例 ----------
function viewCaseDomains() {
  const ds = G.domains.filter(d => d.status === 'active');
  setView(`<p class="crumb"><a href="#/">トップ</a></p><h1>似た問題の事例集</h1>
    <p class="lead">分野を選んでください。</p>
    <div class="stack">${ds.map(d => `<a class="btn big" href="#/cases/${d.id}">${esc(d.name)}</a>`).join('')}</div>`, '事例集');
}

async function viewCases(domain, q = {}) {
  const data = await loadDomain(domain);
  const out = q.o || '', kind = q.k || '';
  const list = data.cases.filter(c => (!out || c.outcome === out) && (!kind || c.sources.some(s => (G.sources[s.sourceId]?.kind || s.kind) === kind)));
  setView(`<p class="crumb"><a href="#/">トップ</a> › <a href="#/start/${domain}">${esc(data.tree.title)}</a></p>
    <h1>似た問題の事例集</h1>
    <p class="note">一次資料（自治体・議会・裁判所など）で確認できた事例だけを載せています。確認できない点は「不明」としています。</p>
    <div class="row"><select data-act="cfilter" data-k="o" aria-label="結果で絞り込む"><option value="">結果：すべて</option>${Object.entries(OUTCOME).map(([k, v]) => `<option value="${k}"${k === out ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <select data-act="cfilter" data-k="k" aria-label="資料の種類で絞り込む"><option value="">資料：すべて</option>${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    ${list.length ? list.map(c => caseItem(c, domain)).join('') : '<p class="note">該当する事例はまだありません。</p>'}`, '事例集');
}

async function viewCase(domain, id) {
  const data = await loadDomain(domain);
  const c = data.cases.find(x => x.id === id);
  if (!c) return viewCases(domain);
  const row = (k, v) => `<dt>${k}</dt><dd>${v ? esc(v) : '<span class="muted">不明</span>'}</dd>`;
  setView(`<p class="crumb"><a href="#/cases/${domain}">事例集</a></p>
    <h1>${esc(c.title)}</h1><p><span class="tag o-${c.outcome}">${OUTCOME[c.outcome]}</span></p>
    <dl class="case-detail">${row('場所', (c.place?.pref || '') + (c.place?.city || ''))}${row('時期', c.period)}${row('どんな状況だったか', c.situation)}${row('何が問題になったか', c.issue)}${row('住民や行政の対応', c.response)}${row('使われた法律・条例・制度', (c.laws || []).join('、'))}${row('最終的にどうなったか', c.result || OUTCOME[c.outcome])}${row('参考にできること', c.lesson)}</dl>
    <h2>一次資料</h2><ul>${c.sources.map(s => { const x = G.sources[s.sourceId] || {}; return `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || s.sourceId)}</a><br><small>${KIND[x.kind || s.kind] || ''}・${esc(x.publisher || '')}・公表 ${esc(x.published || '不明')}・確認日 ${esc(x.checked || c.checked || '')}</small></li>`; }).join('')}</ul>`, c.title);
}

// ---------- 画面：文書 ----------
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
  const { file, data } = cur;
  setView(`<p class="crumb"><a href="#/f/${file.id}/result">診断の結果</a></p>
    <h1>文書の下書きを作る</h1>
    <p class="note">入力した事実だけで文章を組み立てます。入力していないことは書きません。出す前に必ず読み直して直してください。</p>
    <div class="stack">${data.docs.map(d => `<a class="btn big left" href="#/f/${file.id}/doc/${d.id}"><b>${esc(d.title)}</b><br><small>${esc(d.desc)}</small></a>`).join('')}</div>
    <h2>届け方は「声を届ける」で</h2><p class="help">電話のかけ方、メール・手紙の送り方、情報公開請求・請願・陳情・パブコメの手続きは、姉妹サイト「声を届ける」で詳しく案内しています。</p>
    ${linksBlock([{ type: 'todokeru-guide', guide: 'phone', label: '電話のかけ方' }, { type: 'todokeru-guide', guide: 'email', label: 'メール・手紙の送り方' }, { type: 'todokeru-contacts', label: '窓口を探す' }])}`, '文書の下書き');
}

function viewDoc(docId) {
  const { file, data } = cur;
  const d = data.docs.find(x => x.id === docId);
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
function recLabels() { const L = cur.data.ladder; return { toType: L.recordTypes || {}, method: L.methods || {}, state: L.states || {} }; }
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
  else if (lad.next) next = `<div class="box"><b>次の段階：${esc(lad.next.title)}</b><p>${rich(lad.next.body)}</p>${linksBlock(lad.next.links)}</div>`;
  if (lad.repeated.length && st !== 'resolved') next += `<p class="warn">${lad.repeated.map(t => esc((L.toType[t.toType] || '') + (t.toName ? `（${t.toName}）` : ''))).join('・')}には2回以上相談しています。同じ相談を繰り返すより、回答の内容を記録して、次の段階に進むことを考えましょう。</p>`;
  if (lad.planned.length) next += `<p class="note">予定（まだしていないこと）の記録が${lad.planned.length}件あります。予定は「済んだこと」に数えていません。実際にしたら、その記録の「直す」から状況を変えてください。</p>`;
  setView(`<p class="crumb"><a href="#/f/${file.id}/result">診断の結果</a></p>
    <h1>対応の記録</h1>
    <p class="note">この端末の中だけに保存されます。共有の端末では、終わったら<a href="#/data">データを削除</a>してください。</p>
    <section class="card plainc"><h2>今の状態</h2><div class="row wrap">${STATUS.map(s => `<label class="pill"><input type="radio" name="status" value="${s.value}"${st === s.value ? ' checked' : ''} data-act="status"> ${s.label}</label>`).join('')}</div>
      ${(file.statusLog || []).length ? `<details><summary>状態の変化（${file.statusLog.length}件）</summary><ul>${file.statusLog.map(s => `<li>${esc(s.date)}：${STATUS.find(x => x.value === s.status)?.label}</li>`).join('')}</ul></details>` : ''}</section>
    <section><h2>次の一手</h2>${next || '<p class="note">記録をつけると、次の一手をご案内します。</p>'}</section>
    <section class="card plainc"><h2>${editId ? '記録を直す' : '記録を追加する'}</h2>
      <form id="recform" data-id="${esc(ed.id || '')}">
        <label class="field"><span>日付</span><input type="date" name="date" value="${esc(ed.date)}"></label>
        <label class="field"><span>相手の種類</span>${sel('toType', L.toType, ed.toType)}</label>
        <label class="field"><span>相手の部署・名前 <small>（なくても可）</small></span><input name="toName" value="${esc(ed.toName || '')}" placeholder="〇〇区 生活衛生課"></label>
        <label class="field"><span>方法</span>${sel('method', L.method, ed.method)}</label>
        <label class="field"><span>伝えた内容・問い合わせた内容</span><textarea name="content" rows="3">${esc(ed.content || '')}</textarea></label>
        <label class="field"><span>相手からの回答</span><textarea name="response" rows="3">${esc(ed.response || '')}</textarea></label>
        <label class="field"><span>次にすること</span><textarea name="next" rows="2">${esc(ed.next || '')}</textarea></label>
        <label class="field"><span>この件の状況</span>${sel('state', L.state, ed.state)}</label>
        <p class="err" id="err" role="alert"></p>
        <button class="btn big primary" type="submit">${editId ? '直した内容を保存' : '記録を保存'}</button>${editId ? ` <a class="btn" href="#/f/${file.id}/records">やめる</a>` : ''}
      </form></section>
    <section><h2>これまでの記録（${rs.length}件）</h2>
      ${rs.map(r => `<article class="card plainc rec"><b>${esc(r.date)}　${esc(L.toType[r.toType] || '')}${r.toName ? '（' + esc(r.toName) + '）' : ''}</b><span class="meta">${isPlanned(r) ? '<span class="tag">予定</span> ' : ''}${esc(L.method[r.method] || '')}・${esc(L.state[r.state] || '')}</span>
        ${r.content ? `<p><small>内容</small><br>${esc(r.content)}</p>` : ''}${r.response ? `<p><small>回答</small><br>${esc(r.response)}</p>` : ''}${r.next ? `<p><small>次にすること</small><br>${esc(r.next)}</p>` : ''}
        <div class="row"><a class="btn slim" href="#/f/${file.id}/records/${r.id}">直す</a><button class="btn slim" data-act="delrec" data-id="${r.id}">削除</button></div></article>`).join('') || '<p class="note">まだ記録はありません。</p>'}</section>
    <div class="row"><button class="btn" data-act="savetxt">テキストで保存</button><button class="btn" data-act="print">印刷・PDF</button></div>`, '対応の記録');
}

// ---------- 画面：その他 ----------
function viewEmergency() {
  setView(`<h1>まず安全を確保してください</h1>
    <div class="box danger"><p>けんか・暴力・不審者の侵入など：<a class="tel" href="tel:110">110</a></p><p>火事・けが・急病：<a class="tel" href="tel:119">119</a></p>
    <p>緊急ではない警察への相談：<a class="tel" href="tel:%239110">#9110</a></p></div>
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
    <p>暮らしの中の困りごとを整理し、合法的で具体的な解決の行動を始めるための案内サイトです（試作版）。</p>
    <h2>大切なお願い</h2><ul class="points"><li>診断結果は法的な判断ではありません。個別の判断は、法テラスや弁護士会、自治体の無料法律相談などの専門家に相談してください。</li>
    <li>法律や条例は変わります。各案内の「根拠と確認日」を見て、最新の情報を窓口で確かめてください。</li>
    <li>相手の敷地に入る、個人の情報をネットに出す、詰め寄るなどの行為はしないでください。</li></ul>
    <h2>プライバシー</h2><p>入力内容はこの端末の中だけに保存し、外部へは送りません。アクセス解析も使っていません。</p>
    <h2>根拠資料（${ss.length}件）</h2><ul>${ss.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <small>${KIND[s.kind] || ''}・確認日 ${esc(s.checked)}</small></li>`).join('')}</ul>`, 'このサイトについて');
}

// ---------- 道順 ----------
async function route() {
  const [, a, b, c, d] = (location.hash.slice(1).split('?')[0] || '/').split('/');
  const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  try {
    if (!a) return viewHome();
    if (a === 'start') return viewStart(b);
    if (a === 'cases' && !b) return viewCaseDomains();
    if (a === 'cases') return viewCases(b, q);
    if (a === 'case') return viewCase(b, c);
    if (a === 'emergency') return viewEmergency();
    if (a === 'data') return viewData(false);
    if (a === 'about') return viewAbout();
    if (a === 'f') {
      const file = openFile(b); if (!file) return;
      cur = { file, data: await loadDomain(file.domain) };
      if (c === 'q') return viewQuestion();
      if (c === 'result') return viewResult();
      if (c === 'doc') return d ? viewDoc(d) : viewDocs();
      if (c === 'records') return viewRecords(d);
    }
    viewHome();
  } catch (e) {
    setView(`<h1>表示できませんでした</h1><p>${esc(e.message)}</p><a class="btn" href="#/">トップへ</a>`);
  }
}

// ---------- 操作 ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'button')) return;
  const act = t.dataset.act;
  if (act === 'new') { const data = await loadDomain(t.dataset.domain); const f = S.createFile(t.dataset.domain, E.begin(data.tree)); saved(); location.hash = `#/f/${f.id}/q`; }
  else if (act === 'ans') doAnswer(t.dataset.v);
  else if (act === 'multi') {
    const v = [...main.querySelectorAll('fieldset input:checked')].map(x => x.value);
    if (!v.length) { document.getElementById('err').textContent = 'どれか1つ以上選んでください'; return; }
    doAnswer(v);
  }
  else if (act === 'back') { if (!cur.file.state.history.length) { location.hash = `#/start/${cur.file.domain}`; return; } cur.file.state = E.back(cur.file.state); save(); viewQuestion(); }
  else if (act === 'edit') { cur.file.state = E.back(cur.file.state); cur.file.done = false; save(); location.hash = `#/f/${cur.file.id}/q`; }
  else if (act === 'restart') { cur.file.state = E.begin(cur.data.tree); cur.file.done = false; cur.file.prev = {}; save(); location.hash === `#/f/${cur.file.id}/q` ? viewQuestion() : (location.hash = `#/f/${cur.file.id}/q`); }
  else if (act === 'term') {
    const box = t.closest('details, main')?.querySelector('.termbox') || main.querySelector('.termbox');
    const txt = cur?.data?.glossary?.[t.dataset.term];
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
  else if (act === 'delrec') { cur.file.records = cur.file.records.filter(r => r.id !== t.dataset.id); save(); viewRecords(); }
  else if (act === 'histback') history.length > 1 ? history.back() : (location.hash = '#/');
  else if (act === 'delfile') { S.removeFile(t.dataset.id); saved(); viewData(false); }
  else if (act === 'backup') download(`暮らしの問題解決ナビ_バックアップ_${new Date().toLocaleDateString('sv-SE')}.json`, S.backupText(), 'application/json');
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
  if (act === 'check') { cur.file.checks = { ...cur.file.checks, [t.dataset.id]: t.checked }; save(); const h = t.closest('section').querySelector('h2 small'); const all = t.closest('ul').querySelectorAll('input'); h.textContent = `${[...all].filter(x => x.checked).length} / ${all.length}`; }
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
  const d = cur.data.docs.find(x => x.id === id);
  const sv = cur.file.docs[id] || (cur.file.docs[id] = { values: { ...docPrefill(d) }, edited: false, text: '' });
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
