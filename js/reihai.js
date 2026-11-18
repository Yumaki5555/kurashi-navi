// 礼拝施設の確認チェックリスト（#/reihai）の画面。組み立ては reihai-core.js、データは data/reihai/checklist.json。
// 入力はこのブラウザの中（localStorage の kurashi-navi:reihai）だけに保存する。
import * as C from './reihai-core.js';
import * as GD from './reihai-guide.js';

let D = null, H = null, mem = null;
const base = '#/reihai';
const LEVEL_CLS = { law: 'lv-law', guide: 'lv-guide', local: 'lv-local', vol: 'lv-vol' };
const WHO = { all: 'だれでも取得・閲覧できる', pub: '公開されている', owner: '所有者など限られた人だけ', foi: '情報公開請求で求める（一部が開示されないことあり）', local: '扱いは自治体ごと', self: '自分で作る' };

// ---------- 保存（別のタブで新しく保存されていたら、上書きせずに読み直す） ----------
function ls() { try { return window.localStorage; } catch { return null; } }
function load() {
  try { const t = ls()?.getItem(C.KEY); if (t) return { ...C.emptyState(), ...JSON.parse(t) }; } catch { /* 読めなければ空から */ }
  return mem || C.emptyState();
}
let S = null;
function save(rerender = false) {
  const stored = load();
  if (stored.rev > S.rev) { S = stored; bar('別のタブで新しい内容が保存されていたので、そちらを読み直しました。もう一度操作してください。'); H.route(); return false; }
  S.rev++; S.updatedAt = new Date().toISOString(); mem = S;
  try { ls()?.setItem(C.KEY, JSON.stringify(S)); } catch { bar('このブラウザでは保存できません（画面を閉じると消えます）。「書き出す」でコピーして残してください。'); }
  if (rerender) H.route(true);
  return true;
}
function bar(msg) { const b = document.getElementById('savebar'); if (!b) return; b.className = 'savebar ng noprint'; b.textContent = msg; b.hidden = false; setTimeout(() => (b.hidden = true), 8000); }

// ---------- 小さな道具 ----------
const e = s => H.esc(s);
const li = xs => (xs || []).filter(Boolean).map(x => `<li>${e(x)}</li>`).join('');
const stPill = v => `<span class="rh-st rh-st-${v}">${e(C.statusLabel(D, v))}</span>`;
// 答えに合わせて言いかえた項目（例：「予定と聞いた」なら「使う予定」の文）
const itemById = id => { const it = D.items.find(x => x.id === id); return it && C.itemFor(it, C.active(D, S)); };
const groupOf = it => D.groups.find(g => g.id === it.g);
const copyBtn = (text, label = 'コピー') => `<button type="button" class="btn slim" data-r="copy" data-text="${e(text)}">${label}</button>`;
function srcLinks(ids) {
  const ss = [...new Set(ids)].map(H.src).filter(Boolean);
  return ss.length ? `<ul>${ss.map(s => `<li><a href="${e(s.url)}" target="_blank" rel="noopener">${e(s.title)}</a> <small class="ext">↗ 別タブ</small><br><small>${e(H.KIND[s.kind] || '')}・${e(s.publisher || '')}・確認日 ${e(s.checked)}</small></li>`).join('')}</ul>` : '';
}
const levelTag = k => `<span class="tag ${LEVEL_CLS[k]}">${e(D.levels[k])}</span>`;
const nav = () => `<nav class="rh-nav noprint" aria-label="チェックリスト内">
  <a href="${base}/list">項目</a><a href="${base}/guide">ガイド・印刷用PDF</a><a href="${base}/cross">比較表</a><a href="${base}/log">記録表</a><a href="${base}/resp">回答別</a><a href="${base}/out">書き出す</a></nav>`;

// ---------- 画面 ----------
function viewTop() {
  const started = Object.keys(S.ans).length > 0;
  H.setView(`<p class="crumb"><a href="#/">トップ</a> › 礼拝施設の確認</p>
    <p class="rh-kicker">${e(D.kicker)}</p>
    <h1>${e(D.title)}</h1>
    <p class="lead">${e(D.lead)}</p>
    <div class="box point"><b>このチェックリストの考え方</b><ul class="points">${li(D.principles)}</ul></div>
    <a class="emg-bar" href="#/emergency"><span>今すぐ危険なことが起きているとき<small>119・110・#9110</small></span></a>
    <div class="stack">
      ${started ? `<a class="btn primary big" href="${base}/list">続きから（確かめる項目の一覧へ）</a><a class="btn big" href="${base}/q/0">最初の質問に答え直す</a>`
    : `<a class="btn primary big" href="${base}/q/0">はじめる（かんたんな質問に答える）</a><a class="btn big" href="${base}/list">質問に答えずに、項目の一覧を見る</a>`}
    </div>
    <section class="box gd-entry"><h2>確認と相談のガイド（印刷できます）</h2>
      <p>気になることから、役所や運営者に聞く質問と相談先を探せます。電話の文例・記録用紙つきの印刷用資料（PDF・全85ページ）もあります。</p>
      <p class="row wrap"><a class="btn" href="${base}/guide">ガイドを画面で読む</a><a class="btn" href="print/shisetsu-guide.pdf" target="_blank" rel="noopener">印刷用PDFを開く <small class="ext">↗ 別タブ</small></a></p></section>
    <details class="more"><summary>誤解しやすい点（先に読んでおくと安心です）</summary>${mythTable()}</details>
    <details class="more"><summary>記録するときの注意</summary><ul>${li(D.safety)}</ul></details>
    <details class="more"><summary>このチェックリストで扱わないこと</summary><ul>${li(D.outOfScope)}</ul>
      ${srcLinks(['law_kenpou', 'law_shukyo'])}</details>
    <details class="more"><summary>言葉の説明</summary><dl class="rh-dl">${Object.entries(D.glossary).map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join('')}</dl></details>
    <p class="note">入力した内容は、このブラウザの中だけに保存されます（確認日 ${e(D.checked)} の情報にもとづく一般的な案内で、法的な判断ではありません）。
      ${started ? `<button type="button" class="linklike" data-r="wipe">このチェックリストの入力をすべて消す</button>` : ''}</p>`, D.title);
}
const mythTable = () => `<ul class="rh-myths">${D.myths.map(m => `<li><s>${e(m.wrong)}</s><br>→ ${e(m.right)}</li>`).join('')}</ul>`;

function viewQ(n) {
  const qs = C.questionsFor(D, S);
  if (n >= qs.length) { H.go(`${base}/list`); return; }
  const q = qs[n], v = S.ans[q.id], opts = C.optionsFor(q, S);
  let body = '';
  if (q.type === 'one') body = `<div class="stack">${opts.map(o => `<button type="button" class="btn big left${v === o.v ? ' chosen' : ''}" data-r="ans" data-q="${q.id}" data-v="${o.v}" aria-pressed="${v === o.v}">${e(o.label)}</button>`).join('')}</div>`;
  if (q.type === 'many') body = `<fieldset class="stack"><legend class="sr">${e(q.text)}</legend>${opts.map(o => `<label class="btn check left"><input type="checkbox" value="${o.v}"${o.ex ? ' data-ex="1"' : ''}${(v || []).includes(o.v) ? ' checked' : ''}><span>${e(o.label)}</span></label>`).join('')}</fieldset>
    <button type="button" class="btn primary big" data-r="many" data-q="${q.id}">次へ</button>`;
  if (q.type === 'text') body = `<div id="rh-info">${q.fields.map(f => `<label class="field"><span>${e(f.label)}</span><input type="text" data-k="${f.k}" value="${e(S.info[f.k] || '')}" autocomplete="off"></label>`).join('')}</div>
    <button type="button" class="btn primary big" data-r="info">次へ</button>`;
  H.setView(`<p class="crumb"><a href="${base}">礼拝施設の確認</a> › 最初の質問</p>
    <p class="progress">質問 ${n + 1} / ${qs.length}</p>
    <h1>${e(q.text)}</h1>${q.help ? `<p class="help">${e(q.help)}</p>` : ''}${body}
    <p class="row wrap">${n > 0 ? `<a class="btn slim" href="${base}/q/${n - 1}">戻る</a>` : `<a class="btn slim" href="${base}">戻る</a>`}
      <a class="btn slim" href="${base}/list">質問をとばして項目の一覧へ</a></p>`, '礼拝施設の確認｜質問');
}

function itemRow(it) {
  return `<li><a href="${base}/i/${it.id}"><span><b>${e(it.t)}</b></span>${stPill(C.statusOf(S, it.id))}</a></li>`;
}
function viewList() {
  const { rel, other } = C.relevant(D, S), cnt = C.counts(D, S), pri = C.priority(D, S);
  const qs = C.questionsFor(D, S).filter(q => q.type !== 'text');
  const A = C.active(D, S).ans, ansLine = qs.map(q => { const v = A[q.id]; const ls = (Array.isArray(v) ? v : v ? [v] : []).map(x => q.options.find(o => o.v === x)?.label).filter(Boolean); return ls.length ? `<li>${e(q.text.replace(/（いくつでも）/, ''))}<br><b>${e(ls.join('、'))}</b></li>` : ''; }).join('');
  H.setView(`<p class="crumb"><a href="${base}">礼拝施設の確認</a> › 項目の一覧</p>${nav()}
    <h1>確かめる項目</h1>
    ${S.info.addr ? `<p class="help">施設：${e(S.info.addr)}${S.info.name ? `（${e(S.info.name)}）` : ''}</p>` : ''}
    <p class="rh-counts">${D.statuses.map(s => `<span>${stPill(s.v)} ${cnt[s.v]}</span>`).join('')}</p>
    <p class="note">「未確認」は違反の数ではありません。確かめて問題がなかった項目は「問題なしと確認」にします。</p>
    <section class="box now"><h2>まずここから</h2>
      ${pri.length ? `<ol class="rh-pri">${pri.map(({ it, why }) => `<li><a href="${base}/i/${it.id}">${e(it.t)}</a><br><small>${e(why.join('・'))}</small></li>`).join('')}</ol>` : '<p>関係する項目は、すべて確かめ終わっています。改善待ちの項目は、時期が来たら記録表で様子を確かめます。</p>'}</section>
    ${D.groups.map(g => {
      const r = rel.filter(it => it.g === g.id), o = other.filter(it => it.g === g.id);
      if (!r.length && !o.length) return '';
      return `<section class="sec"><h2>${e(g.title)}</h2><p class="help">${e(g.lead)}</p>
        ${g.id === 'B' ? `<p><a class="btn slim" href="${base}/cross">比較表を開く</a></p>` : ''}
        ${r.length ? `<ul class="rh-items">${r.map(itemRow).join('')}</ul>` : ''}
        ${o.length ? `<details class="more"><summary>ほかの項目（当てはまるときに）${o.length}件</summary><ul class="rh-items">${o.map(itemRow).join('')}</ul></details>` : ''}</section>`;
    }).join('')}
    ${ansLine ? `<details class="more"><summary>最初の質問の答え</summary><ul>${ansLine}</ul><a class="btn slim" href="${base}/q/0">答えを直す</a></details>` : `<p><a class="btn" href="${base}/q/0">かんたんな質問に答えて、関係する項目にしぼる</a></p>`}`, '礼拝施設の確認｜項目');
}

function viewItem(id) {
  const it = itemById(id); if (!it) { H.go(`${base}/list`); return; }
  const { rel } = C.relevant(D, S), seq = rel.some(x => x.id === id) ? rel : D.items, i = seq.findIndex(x => x.id === id);
  const prev = seq[i - 1], next = seq[i + 1], st = C.statusOf(S, id), g = groupOf(it);
  // 質問文：部署ごとに違う項目は、あて先ごとに分けて出す（askBy で false の部署には聞かない）
  const asks = []; for (const d of it.dept || []) { const t = C.askFor(it, d); if (!t) continue; const a = asks.find(x => x.t === t); if (a) a.d.push(d); else asks.push({ t, d: [d] }); }
  const ask = asks.length ? C.fill(asks[0].t, S) : '';
  const askBox = x => `<div class="rh-ask"><p>${e(C.fill(x.t, S))}</p></div><p class="row wrap">${copyBtn(C.fill(x.t, S), '質問文をコピー')}</p>`;
  const sec = (h, inner) => (inner ? `<h2>${h}</h2>${inner}` : '');
  H.setView(`<p class="crumb"><a href="${base}/list">項目の一覧</a> › ${e(g.title)}</p>${nav()}
    <h1>${e(it.t)}</h1>
    <div class="rh-status" role="group" aria-label="この項目の状態">${D.statuses.map(s => `<button type="button" class="btn slim${st === s.v ? ' chosen' : ''}" data-r="st" data-id="${id}" data-v="${s.v}" aria-pressed="${st === s.v}">${e(s.label)}</button>`).join('')}</div>
    ${it.pick ? `<label class="field"><span>${e(it.pick.label)}</span><select data-rf="pick" data-id="${id}"><option value="">選んでください</option>${it.pick.options.map(o => `<option value="${o.v}"${S.picks[id] === o.v ? ' selected' : ''}>${e(o.label)}</option>`).join('')}</select></label>` : ''}
    ${sec('なぜ確かめるのか', `<p>${e(it.why)}</p>`)}
    ${sec('自分で確かめること', it.self?.length ? `<ul>${li(it.self)}</ul>` : '')}
    ${sec('役所に確かめてもらうこと', it.gov?.length ? `<ul>${li(it.gov)}</ul>` : '')}
    ${sec('手に入る資料と取り方', it.docs?.length ? `<ul>${it.docs.map(d => `<li><b>${e(d.n)}</b>：${e(d.w)}<br><small>${e(WHO[d.who] || '')}</small></li>`).join('')}</ul>` : '')}
    ${sec('相談先の候補', it.dept?.length ? `<ul>${li(it.dept.map(d => D.depts[d]))}</ul>` : '')}
    ${ask ? `<h2>そのまま使える質問文</h2>${asks.length > 1 || it.askBy ? asks.map(x => `<h3 class="rh-to">${e(x.d.map(d => D.depts[d].replace(/（.*$/, '')).join('・'))}あて</h3>${askBox(x)}`).join('') : askBox(asks[0])}
      <p class="row wrap">${S.info.addr ? '' : `<a class="btn slim" href="${base}/q/2">施設の住所を入れる</a>`}<a class="btn slim" href="${base}/out/sheet">相談票にまとめる</a></p>
      <p class="help">〇〇の部分は、自分の記録に合わせて書きかえてください。</p>` : ''}
    ${sec('求める対応', it.req ? `<p>${e(it.req)}</p>` : '')}
    ${sec('回答のあとの次の行動', it.next?.length ? `<ul>${li(it.next)}</ul>` : '')}
    ${it.warn ? `<p class="warn"><b>誤解しやすい点：</b>${e(it.warn)}</p>` : ''}
    <details class="src"><summary>根拠と確認日（${e(D.checked)}）</summary>
      <ul>${it.basis.map(b => `<li>${levelTag(b.k)}${e(b.s)}</li>`).join('')}</ul>${srcLinks(it.basis.map(b => b.src).filter(Boolean))}</details>
    <label class="field"><span>確かめた結果のメモ</span><small>日付・部署・回答・根拠など。相談票に入ります。</small><textarea rows="3" data-rf="memo" data-id="${id}">${e(S.memo[id] || '')}</textarea></label>
    <p class="row wrap"><a class="btn" href="${base}/log?item=${id}">記録表に書く</a>${it.cross || it.g === 'B' ? `<a class="btn" href="${base}/cross">比較表へ</a>` : ''}</p>
    <p class="row wrap rh-pn">${prev ? `<a class="btn slim" href="${base}/i/${prev.id}">‹ 前の項目</a>` : ''}<a class="btn slim" href="${base}/list">一覧</a>${next ? `<a class="btn slim" href="${base}/i/${next.id}">次の項目 ›</a>` : ''}</p>`, it.t.slice(0, 30));
}

function viewCross() {
  const X = D.cross, V = S.cross;
  const inp = (path, val, lbl, ph = '') => `<label class="field"><span>${e(lbl)}</span><textarea rows="2" data-rf="cross" data-path="${path}" placeholder="${e(ph)}">${e(val || '')}</textarea></label>`;
  H.setView(`<p class="crumb"><a href="${base}/list">項目の一覧</a> › 比較表</p>${nav()}
    <h1>建物の情報の比較表</h1>
    <p class="lead">今ある建物と、各制度の記録を並べます。制度ごとに記録は別々で、用語や分類も違います。</p>
    <p class="warn">「登記が見つからない＝違法建築」「課税されている＝適法」「消防に届出済み＝建築・開発も適法」ではありません。</p>
    <section class="card plainc"><h2>現況（現地・公開資料から）</h2><p class="help">B1の項目で確かめたことを書きます。</p>
      ${X.summary.map(f => inp(`summary.${f.k}`, V.summary?.[f.k], f.label)).join('')}</section>
    ${X.rows.map(r => {
      const v = V.rows?.[r.id] || {};
      return `<section class="card plainc"><h2>${e(r.label)}</h2>
        <p class="help">確かめること：${e(r.what)}<br>資料：${e(r.access)}　<a href="${base}/i/${r.item}">詳しい手順（${r.item}）</a></p>
        ${inp(`rows.${r.id}.now`, v.now, '現況（この制度で比べる点）')}
        ${inp(`rows.${r.id}.rec`, v.rec, 'この制度の記録', r.id === 'zei' ? '第三者には非公開。「非公開」と書く' : '')}
        <label class="field"><span>一致・不一致・不明</span><select data-rf="cross" data-path="rows.${r.id}.match">${X.match.map(m => `<option value="${m.v}"${(v.match || '') === m.v ? ' selected' : ''}>${e(m.label)}</option>`).join('')}</select></label>
        ${inp(`rows.${r.id}.where`, v.where || D.depts[r.dept], '確認先')}
        ${inp(`rows.${r.id}.ans`, v.ans, '回答（日付・担当も）')}
        ${inp(`rows.${r.id}.next`, v.next, '次の対応')}</section>`;
    }).join('')}
    <section class="sec"><h2>見落としやすい点</h2><ul class="checklist">${X.pitfalls.map((p, i) => `<li><label><input type="checkbox" data-rf="pit" data-i="${i}"${V.pit?.[i] ? ' checked' : ''}><span>${e(p)}</span></label></li>`).join('')}</ul></section>
    <p class="row wrap">${copyBtn(C.crossText(D, S), '比較表をコピー')}<a class="btn" href="${base}/i/B7">食い違いがあったとき（B7）</a></p>`, '礼拝施設の確認｜比較表');
}

function viewLog(q) {
  const { rel } = C.relevant(D, S), pre = q.item || '';
  const opts = `<option value="">（項目を選ばない）</option>${(rel.some(x => x.id === pre) ? rel : D.items).map(it => `<option value="${it.id}"${pre === it.id ? ' selected' : ''}>${it.id} ${e(it.t.slice(0, 26))}</option>`).join('')}`;
  const f = (k, lbl, type = 'text', extra = '') => `<label class="field"><span>${e(lbl)}</span>${type === 'area' ? `<textarea rows="2" name="${k}"${extra}></textarea>` : `<input type="${type}" name="${k}"${extra}>`}</label>`;
  const rows = (S.log || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  const kind = { ev: '出来事', co: '相談・回答', fx: '改善の確認' };
  H.setView(`<p class="crumb"><a href="${base}/list">項目の一覧</a> › 記録表</p>${nav()}
    <h1>相談・回答・改善の記録表</h1>
    <p class="help">起きたこと、役所や運営者とのやりとり、改善したかどうかを、日付ごとに残します。</p>
    <form id="rh-log" class="card plainc" autocomplete="off">
      <fieldset class="row wrap"><legend>記録の種類</legend>${Object.entries(kind).map(([k, v], i) => `<label class="pill"><input type="radio" name="type" value="${k}"${(q.type || 'ev') === k || (!q.type && i === 0) ? ' checked' : ''}> ${v}</label>`).join('')}</fieldset>
      ${f('date', '日付', 'date', ` value="${new Date().toLocaleDateString('sv-SE')}"`)}
      <label class="field"><span>関係する項目</span><select name="item">${opts}</select></label>
      <div data-for="ev">
        <fieldset class="row wrap"><legend>これは…</legend>${Object.entries(C.REAL).map(([k, v], i) => `<label class="pill"><input type="radio" name="real" value="${k}"${i === 0 ? ' checked' : ''}> ${v}</label>`).join('')}</fieldset>
        ${f('time', '時間帯（例：午前5時〜5時30分）')}${f('place', '場所（例：自宅の寝室、施設前の道路）')}${f('dur', '続いた時間')}${f('freq', '頻度（例：毎週金曜、月2回）')}${f('harm', '具体的な支障', 'area')}${f('mat', '資料（例：写真3枚、録音、行事案内の画面）')}
        <p class="help">人の顔・車のナンバーが分かる写真は、公開しないでください。</p></div>
      <div data-for="co" hidden>${f('dept', '相手（部署・担当者）')}
        <label class="field"><span>方法</span><select name="method">${D.logMethods.map(m => `<option>${e(m)}</option>`).join('')}</select></label>
        ${f('ask', '伝えた・聞いたこと', 'area')}${f('ans', '回答（言われたとおりに）', 'area')}${f('next', '次の対応')}${f('due', '回答の希望日・次に確かめる時期（法律上の期限ではありません）', 'date')}</div>
      <div data-for="fx" hidden>${f('what', '確かめた様子', 'area')}
        <label class="field"><span>結果</span><select name="result">${Object.entries(C.RESULT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
      <button type="submit" class="btn primary big">記録する</button></form>
    <section class="sec"><h2>これまでの記録（${rows.length}件）</h2>
      ${rows.length ? `<ul class="rh-log">${rows.map(x => `<li><b>${e(x.date || '日付なし')}・${kind[x.type]}${x.type === 'ev' ? `（${e(C.REAL[x.real] || '')}）` : ''}</b>${x.item ? ` <a href="${base}/i/${x.item}">${x.item}</a>` : ''}
        <br>${x.type === 'ev' ? e(C.evLine(x)) : x.type === 'co' ? `${e(x.dept || '')}／${e(x.method || '')}<br>伝えた：${e(x.ask || '—')}<br>回答：${e(x.ans || '—')}<br>次：${e(x.next || '—')}${x.due ? `（${e(x.due)}）` : ''}` : `${e(x.what || '')}／${e(C.RESULT[x.result] || '')}`}
        <br><button type="button" class="linklike" data-r="logdel" data-id="${x.id}">この記録を消す</button></li>`).join('')}</ul>
        <p>${copyBtn(C.logText(D, S), '記録表をコピー')}</p>` : '<p class="muted">まだ記録がありません。</p>'}</section>`, '礼拝施設の確認｜記録表');
}

function viewResp() {
  const got = C.active(D, S).ans.resp || [];
  H.setView(`<p class="crumb"><a href="${base}/list">項目の一覧</a> › 回答別の次の一手</p>${nav()}
    <h1>役所の回答ごとの「次の一手」</h1>
    <p class="help">言われた言葉に近いものを開くと、次に聞くことが分かります。聞いたことと回答は、記録表に残します。</p>
    ${D.responses.map(r => `<details class="card"${got.includes(r.id) ? ' open' : ''}><summary>${e(r.said)}</summary>
      <p>${e(r.mean)}</p><div class="rh-ask"><p>${e(C.fill(r.ask, S))}</p></div>
      <p>${copyBtn(C.fill(r.ask, S), '質問文をコピー')}</p><ul>${li(r.then)}</ul>
      <p><a class="btn slim" href="${base}/log?type=co">回答を記録する</a></p></details>`).join('')}
    <section class="sec"><h2>回答がない・改善しないときの進め方</h2>
      <ul class="rh-routes">${D.routes.map(r => `<li><b>${e(r.t)}</b><br>${levelTag(r.k)}${e(r.d)}${r.src ? srcLinks([r.src]) : ''}</li>`).join('')}</ul>
      <p class="note">情報公開請求は「すでにある文書」を求める手続きで、質問や調査のお願いとは別です。</p></section>`, '礼拝施設の確認｜回答別');
}

const OUTS = [
  ['pri', '優先して確かめる項目'], ['dept', '担当部署別の質問一覧'], ['sheet', '相談票'],
  ['cross', '比較表'], ['log', '記録表'], ['next', '回答がない・改善しないときの次の行動']
];
function viewOut(k, q) {
  k = OUTS.some(o => o[0] === k) ? k : 'pri';
  const groups = C.byDept(D, S).filter(g => g.dept !== 'op');
  const dept = C.sheetDept(D, S, q.dept || ''), hope = q.hope || '';
  const text = { pri: () => C.priorityText(D, S), dept: () => C.deptText(D, S), sheet: () => C.sheetText(D, S, dept, hope), cross: () => C.crossText(D, S), log: () => C.logText(D, S), next: () => C.nextText(D, S) }[k]();
  H.setView(`<p class="crumb"><a href="${base}/list">項目の一覧</a> › 書き出す</p>${nav()}
    <h1>書き出す・印刷する</h1>
    <div class="rh-outs noprint" role="group" aria-label="書き出すもの">${OUTS.map(([v, l]) => `<a class="btn slim${v === k ? ' chosen' : ''}" href="${base}/out/${v}"${v === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</div>
    ${k === 'sheet' ? `<form class="card plainc noprint" id="rh-sheet"><label class="field"><span>あて先の部署</span><small>相談票は1枚に1つの部署あてです。その部署に聞く質問だけが入ります。ほかの部署あては、選び直して作ります。</small><select name="dept">${groups.map(g => `<option value="${g.dept}"${dept === g.dept ? ' selected' : ''}>${e(g.name)}</option>`).join('')}</select></label>
      <label class="field"><span>回答の希望日（任意）</span><small>希望として書きます。一般の問い合わせに、法律で決まった回答の期限はありません。</small><input type="date" name="hope" value="${e(hope)}"></label>
      <button class="btn" type="submit">相談票に反映する</button></form>` : ''}
    <h2>${e(OUTS.find(o => o[0] === k)[1])}</h2>
    <pre class="rh-pre">${e(text)}</pre>
    <p class="row wrap noprint">${copyBtn(text)}<button type="button" class="btn slim" data-r="dl" data-name="${k}">ファイルに保存（.txt）</button><button type="button" class="btn slim" data-r="print">印刷する</button></p>
    <p class="note">提出する前に、〇〇の部分や個人の情報を見直してください。行政に出す文面は、結論を決めつけず「事実・制度上の取扱い・判断根拠の確認」をお願いする形にしています。</p>`, '礼拝施設の確認｜書き出す');
}

// ---------- 入口 ----------
export async function view(parts, q, helpers) {
  H = helpers;
  if (!D) { D = await H.getJSON('data/reihai/checklist.json'); if (!D) throw new Error('チェックリストのデータを読み込めませんでした。'); }
  S = load();
  const [a, b] = parts;
  if (!a) return viewTop();
  if (a === 'guide') return GD.view(b, q, H);
  if (a === 'q') return viewQ(+b || 0);
  if (a === 'list') return viewList();
  if (a === 'i') return viewItem(b);
  if (a === 'cross') return viewCross();
  if (a === 'log') return viewLog(q);
  if (a === 'resp') return viewResp();
  if (a === 'out') return viewOut(b, q);
  return viewTop();
}

// ---------- 操作 ----------
const onPage = () => location.hash.startsWith(base);
const qIndex = () => +(location.hash.match(/\/q\/(\d+)/)?.[1] || 0);
function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(k => (o = o[k] ||= {})); o[ks.at(-1)] = val; }

document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-r]'); if (!t || !onPage() || !S) return;
  const r = t.dataset.r;
  if (r === 'copy') return H.copy(t.dataset.text, t);
  if (r === 'print') return window.print();
  if (r === 'dl') return H.download(`reihai-${t.dataset.name}-${new Date().toLocaleDateString('sv-SE')}.txt`, document.querySelector('.rh-pre')?.textContent || '');
  if (r === 'ans') { S.ans[t.dataset.q] = t.dataset.v; if (save()) H.go(`${base}/q/${qIndex() + 1}`); return; }
  if (r === 'many') {
    const vs = [...document.querySelectorAll('fieldset input:checked')].map(x => x.value);
    if (vs.length) S.ans[t.dataset.q] = vs; else delete S.ans[t.dataset.q];
    if (save()) H.go(`${base}/q/${qIndex() + 1}`); return;
  }
  if (r === 'info') { document.querySelectorAll('#rh-info input').forEach(x => (S.info[x.dataset.k] = x.value.trim())); if (save()) H.go(`${base}/q/${qIndex() + 1}`); return; }
  if (r === 'st') { S.st[t.dataset.id] = t.dataset.v; if (save()) { t.parentNode.querySelectorAll('button').forEach(b => { b.classList.toggle('chosen', b === t); b.setAttribute('aria-pressed', String(b === t)); }); } return; }
  if (r === 'logdel') { if (!confirm('この記録を消しますか？（元に戻せません）')) return; S.log = S.log.filter(x => x.id !== t.dataset.id); save(true); return; }
  if (r === 'wipe') { if (!confirm('このチェックリストの答え・状態・メモ・比較表・記録表をすべて消します。元に戻せません。よろしいですか？')) return; try { ls()?.removeItem(C.KEY); } catch { /* なし */ } mem = null; S = C.emptyState(); H.route(); }
});
document.addEventListener('change', ev => {
  const t = ev.target; if (!onPage() || !S) return;
  if (t.closest('#rh-log') && t.name === 'type') { document.querySelectorAll('#rh-log [data-for]').forEach(d => (d.hidden = d.dataset.for !== t.value)); return; }
  const f = t.dataset.rf; if (!f) return;
  if (f === 'pick') { if (t.value) S.picks[t.dataset.id] = t.value; else delete S.picks[t.dataset.id]; save(); }
  if (f === 'pit') { S.cross.pit = { ...S.cross.pit, [t.dataset.i]: t.checked }; save(); }
  if (f === 'cross' && t.tagName === 'SELECT') { setPath(S.cross, t.dataset.path, t.value); save(); }
});
let typing = null;
document.addEventListener('input', ev => {
  const t = ev.target, f = t.dataset?.rf; if (!onPage() || !S || !f) return;
  if (f === 'memo') S.memo[t.dataset.id] = t.value;
  else if (f === 'cross' && t.tagName === 'TEXTAREA') setPath(S.cross, t.dataset.path, t.value);
  else return;
  clearTimeout(typing); typing = setTimeout(() => save(), 400);
});
document.addEventListener('submit', ev => {
  if (!onPage() || !S) return;
  const form = ev.target;
  if (form.id === 'rh-log') {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(form)), type = fd.type;
    const keep = { ev: ['real', 'time', 'place', 'dur', 'freq', 'harm', 'mat'], co: ['dept', 'method', 'ask', 'ans', 'next', 'due'], fx: ['what', 'result'] }[type];
    const rec = { id: Date.now().toString(36), type, date: fd.date, item: fd.item };
    keep.forEach(k => { if (fd[k]) rec[k] = String(fd[k]).trim(); });
    S.log = [...(S.log || []), rec];
    if (save()) H.go(`${base}/log`);
  }
  if (form.id === 'rh-sheet') {
    ev.preventDefault();
    const fd = new FormData(form);
    H.go(`${base}/out/sheet?dept=${encodeURIComponent(fd.get('dept') || '')}&hope=${encodeURIComponent(fd.get('hope') || '')}`);
  }
});
window.addEventListener('storage', ev => { if (ev.key === C.KEY && onPage() && !document.activeElement?.matches?.('input,textarea,select')) H.route(true); });
