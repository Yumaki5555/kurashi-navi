// 「近所の施設 確認と相談のガイド」のWeb版（#/reihai/guide）。
// データは data/reihai/guide.json（tools/import-guide.py で、印刷用PDF print/shisetsu-guide.pdf から作る）。
// コピーのボタン（data-r="copy"）は reihai.js の操作でまとめて受ける。
let G = null, H = null;
const base = '#/reihai/guide';
const e = s => H.esc(s);
const pdfAt = n => `${G.pdf}${n ? `#page=${n}` : ''}`;
const pdfUrl = () => new URL(G.pdf, location.href).href;
const mb = () => (G.pdfBytes / 1048576).toFixed(1);
const range = c => (c.from === c.to ? `${c.from}` : `${c.from}〜${c.to}`);
const chapterOf = n => G.chapters.find(c => n >= c.from && n <= c.to);
const copyBtn = (text, label = 'コピー') => `<button type="button" class="btn slim" data-r="copy" data-text="${e(text)}">${label}</button>`;
const unq = t => t.replace(/^「([\s\S]*)」$/, '$1');

// 「6ページ」「22〜23ページ」「61〜62・81ページ」をガイド内のリンクにする
const PG = /(\d{1,2}(?:〜\d{1,2})?(?:・\d{1,2}(?:〜\d{1,2})?)*)ページ/g;
const linkNums = nums => nums.split('・').map(x => {
  const a = +x.split('〜')[0];
  return a >= 1 && a <= G.pageCount ? `<a href="${base}/${a}">${x}</a>` : x;
}).join('・');
const rich = t => e(t).replace(PG, (m, nums) => `${linkNums(nums)}ページ`).replace(/\n/g, '<br>');
// 表の「ページ」の列では、行末の数字（例：63〜64、12〜13・78）もリンクにする
const richNums = t => rich(t).replace(/(^|<br>|[^\d〜・>])(\d{1,2}(?:〜\d{1,2})?(?:・\d{1,2}(?:〜\d{1,2})?)*)(?=<br>|$)/g, (m, pre, nums) => pre + linkNums(nums));

function table(b) {
  const [head, ...rows] = b.head ? b.rows : [null, ...b.rows];
  const lab = i => (head ? head[i] || '' : '');
  const pageCol = i => /ページ/.test(lab(i));
  return `<div class="gd-tbl-wrap"><table class="gd-tbl${head ? ' has-head' : ''}">
    ${head ? `<thead><tr>${head.map(h => `<th scope="col">${e(h)}</th>`).join('')}</tr></thead>` : ''}
    <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${head ? ` data-label="${e(lab(i))}"` : ''}>${pageCol(i) ? richNums(c) : rich(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function blocks(bs, pno) {
  let h = '', list = null;
  const flush = () => { if (list) { h += `<ul class="${list.cls}">${list.items.join('')}</ul>`; list = null; } };
  const push = (cls, item) => { if (!list || list.cls !== cls) { flush(); list = { cls, items: [] }; } list.items.push(item); };
  bs.forEach((b, i) => {
    if (b.k === 'li') return push('gd-li', `<li>${rich(b.t)}</li>`);
    if (b.k === 'chk') return push('gd-chk', `<li>${rich(b.t)}</li>`);
    flush();
    const next = bs[i + 1];
    switch (b.k) {
      case 'h': h += `<h3>${rich(b.t)}</h3>`; break;
      case 'p': h += `<p>${rich(b.t)}</p>`; break;
      case 'note': h += `<p class="gd-note">${rich(b.t)}</p>`; break;
      case 'nav': h += `<p class="gd-nav noprint">${rich(b.t)}</p>`; break;
      case 'q': {
        // 文になっている質問はそのままコピーできる。見出しだけの質問（追加確認）は、続く「」の文をコピーする
        const sentence = /[。？?]$/.test(b.t) || !(next && next.k === 'say');
        h += `<div class="gd-q" id="gd-q-${e(b.id)}"><span class="gd-qid">${e(b.id)}</span><div class="gd-qt"><p>${rich(b.t)}</p>${sentence ? copyBtn(b.t, '質問をコピー') : ''}</div></div>`;
        break;
      }
      case 'say': h += `<div class="gd-say"><p>${rich(b.t)}</p>${copyBtn(unq(b.t), '文をコピー')}</div>`; break;
      case 'rec': h += `<p class="gd-rec">✎ 記録欄は印刷用PDFのこのページにあります（<a href="${pdfAt(pno)}" target="_blank" rel="noopener">PDFの${pno}ページを開く</a> <small class="ext">↗ 別タブ</small>）。画面で残すなら<a href="#/reihai/log">記録表</a>も使えます。</p>`; break;
      case 'url': h += `<p class="gd-url"><a href="${e(b.u)}" target="_blank" rel="noopener">${e(b.u)}</a> <small class="ext">↗ 別タブ</small></p>`; break;
      case 'tbl': h += table(b); break;
      default: h += `<p>${rich(b.t || '')}</p>`;
    }
  });
  flush();
  return h;
}

const page = n => {
  const p = G.pages[n];
  return `<section class="gd-page" id="gd-p${n}" aria-labelledby="gd-h${n}">
    <p class="gd-pno"><span>PDF ${n}ページ</span><a class="noprint" href="${pdfAt(n)}" target="_blank" rel="noopener">このページを印刷用PDFで開く <small class="ext">↗</small></a></p>
    <h2 id="gd-h${n}">${e(p.t)}</h2>${blocks(p.b, n)}</section>`;
};

const pdfBox = (c) => `<div class="box gd-pdf">
  <p><b>印刷できる資料（PDF・全${G.pageCount}ページ・${mb()}MB）</b><br><small>${c ? `この章は PDF の ${range(c)}ページです。全部を印刷しなくても、使うページと29ページの記録用紙だけで始められます。` : '全部を印刷しなくても、使う相談ページと29ページの記録用紙だけで始められます。'}</small></p>
  <p class="row wrap"><a class="btn primary" href="${pdfAt(c ? c.from : 0)}" target="_blank" rel="noopener">${c ? `PDFの${range(c)}ページを開く` : '印刷用PDFを開く'} <small class="ext">↗ 別タブ</small></a>${c ? '' : copyBtn(pdfUrl(), 'PDFのリンクをコピー')}</p>
  ${c ? '' : `<p class="gd-direct"><small>直リンク：<a href="${G.pdf}" target="_blank" rel="noopener">${e(pdfUrl())}</a></small></p>`}</div>`;

const GROUPS = [
  ['first', 'まず読む', '最初の電話のしかたと、心配事から窓口を探す一覧です。'],
  ['topic', '気になることから選ぶ（A〜G）', '相談シート。必要な質問だけ選んで、役所や運営者に聞きます。'],
  ['life', '施設での活動・暮らしの心配事', '宿泊・食事・行事・動物・墓地・法人や税金など。'],
  ['land', '土地・工事を詳しく確かめる（H〜N）', '最初の回答で分からなかったことだけに使います。'],
  ['step', '聞き直す・記録する・進め方', '答えが分かりにくいとき、相談が進まないとき。'],
  ['ref', '早見表・参考資料', '法令と窓口の一覧、根拠にした公式資料へのリンク。'],
];

function viewIndex(q) {
  const word = (q.w || '').trim();
  const hits = word ? search(word) : [];
  const nq = Object.values(G.pages).reduce((s, p) => s + p.b.filter(b => b.k === 'q').length, 0);
  H.setView(`<p class="crumb"><a href="#/">トップ</a> › <a href="#/reihai">礼拝施設の確認</a> › 確認と相談のガイド</p>
    <h1>${e(G.title)}</h1>
    <p class="lead">近所の施設のことを、役所や運営者に確かめるための質問（${nq}問）と、相談の進め方をまとめたガイドです。住所と、聞きたいことが1つあれば始められます。</p>
    ${pdfBox(null)}
    <a class="emg-bar" href="#/emergency"><span>今すぐ危険なことが起きているとき<small>119・110・#9110</small></span></a>
    <form class="gd-search noprint" role="search" data-gd="search"><label class="field"><span>ことばで探す（例：駐車、騒音、宿泊、農地）</span>
      <span class="row"><input type="search" name="w" value="${e(word)}" enterkeyhint="search"><button class="btn slim" type="submit">探す</button></span></label></form>
    ${word ? `<section class="sec"><h2>「${e(word)}」が出てくるところ（${hits.length}件）</h2>${hits.length ? `<ul class="gd-hits">${hits.slice(0, 60).map(x => `<li><a href="${base}/${x.n}">${e(x.label)}</a><br><small>PDF ${x.n}ページ｜${e(G.pages[x.n].t)}</small></li>`).join('')}</ul>${hits.length > 60 ? '<p class="note">多いので最初の60件だけ出しています。ことばを足して絞ってください。</p>' : ''}` : '<p>見つかりませんでした。別のことばで探すか、下の一覧から選んでください。</p>'}</section>` : ''}
    ${GROUPS.map(([g, t, d]) => `<section class="sec"><h2>${t}</h2><p class="help">${d}</p><ul class="rh-items">${G.chapters.filter(c => c.g === g).map(c => `<li><a href="${base}/${c.from}"><b>${e(c.t)}</b><small class="gd-pg">${range(c)}ページ</small></a></li>`).join('')}</ul></section>`).join('')}
    <p class="note">このページは印刷用PDF（${e(G.edition)}版・法令照合日 ${e(G.lawChecked)}）の本文を、画面で読みやすく並べたものです。記入欄は印刷用PDFにあります。画面の文では、特定の宗教の名前を一般的なことばに言い換えています（PDFは元の文のままです）。一般的な案内で、法的な判断ではありません。</p>`, '確認と相談のガイド');
}

function search(word) {
  const ws = word.split(/[\s　]+/).filter(Boolean);
  const out = [];
  for (const [n, p] of Object.entries(G.pages)) {
    for (const b of p.b) {
      const txt = b.k === 'tbl' ? b.rows.map(r => r.join(' ')).join(' ') : b.t || '';
      if (!txt || !ws.every(w => txt.includes(w) || p.t.includes(w))) continue;
      const label = b.k === 'q' ? `${b.id}　${b.t}` : b.k === 'tbl' ? `表：${b.rows[0].join('／')}` : txt;
      out.push({ n: +n, label: label.length > 80 ? label.slice(0, 80) + '…' : label });
    }
  }
  return out;
}

function viewChapter(n) {
  const c = chapterOf(n);
  if (!c) return viewIndex({});
  const i = G.chapters.indexOf(c), prev = G.chapters[i - 1], next = G.chapters[i + 1];
  const pages = [];
  for (let k = c.from; k <= c.to; k++) pages.push(page(k));
  H.setView(`<p class="crumb"><a href="#/">トップ</a> › <a href="#/reihai">礼拝施設の確認</a> › <a href="${base}">確認と相談のガイド</a></p>
    <h1>${e(c.t)}</h1>
    ${pdfBox(c)}
    ${pages.join('')}
    <nav class="gd-pager noprint" aria-label="前後の章">
      ${prev ? `<a class="btn" href="${base}/${prev.from}">← ${e(prev.t)}</a>` : ''}
      <a class="btn" href="${base}">ガイドの目次へ</a>
      ${next ? `<a class="btn" href="${base}/${next.from}">${e(next.t)} →</a>` : ''}
    </nav>`, `${c.t}｜確認と相談のガイド`);
  if (n !== c.from) document.getElementById(`gd-p${n}`)?.scrollIntoView();
}

export async function view(arg, q, helpers) {
  H = helpers;
  if (!G) { G = await H.getJSON('data/reihai/guide.json'); if (!G) throw new Error('ガイドのデータを読み込めませんでした。'); }
  const n = parseInt(arg, 10);
  return n >= 1 && n <= G.pageCount ? viewChapter(n) : viewIndex(q);
}

// ことばで探す：URLに入れて、戻るボタンで検索結果に戻れるようにする
document.addEventListener('submit', ev => {
  const f = ev.target.closest('[data-gd="search"]'); if (!f) return;
  ev.preventDefault();
  const w = new FormData(f).get('w')?.toString().trim() || '';
  H.go(w ? `${base}?w=${encodeURIComponent(w)}` : base);
});
