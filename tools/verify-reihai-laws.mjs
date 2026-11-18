// 礼拝施設の確認チェックリスト（data/reihai/）の根拠条文を e-Gov 法令API で取得し、語句を照合する。
// 使い方：node tools/verify-reihai-laws.mjs           … 照合だけ
//         node tools/verify-reihai-laws.mjs --dump    … 取得した条文を research/reihai-laws.txt にも保存
// 「含まれる語句」に加え、「含まれないはずの語句」（!で始める）も照合する。
// 条番号に「別表第一」などを書くと、法令全文から該当する別表だけを取り出して照合する。
import { writeFileSync, mkdirSync } from 'node:fs';

const LAWS = {
  touki: ['416AC0000000123', '不動産登記法'],
  chihouzei: ['325AC0000000226', '地方税法'],
  toshi: ['343AC0000000100', '都市計画法'],
  toshiRei: ['344CO0000000158', '都市計画法施行令'],
  kenchiku: ['325AC0000000201', '建築基準法'],
  shoboRei: ['336CO0000000037', '消防法施行令'],
  shoboKisoku: ['336M50000008006', '消防法施行規則'],
  shobo: ['323AC1000000186', '消防法'],
  souon: ['343AC0000000098', '騒音規制法'],
  ryokan: ['323AC0000000138', '旅館業法'],
  shokuhin: ['322AC0000000233', '食品衛生法'],
  jifuku: ['322AC0000000164', '児童福祉法'],
  jokaso: ['358AC1000000043', '浄化槽法'],
  shako: ['337AC0000000145', '自動車の保管場所の確保等に関する法律'],
  doro: ['327AC1000000180', '道路法'],
  dokoho: ['335AC0000000105', '道路交通法'],
  toukiRei: ['416CO0000000379', '不動産登記令'],
  shukyo: ['326AC0000000126', '宗教法人法'],
  tetsuzuki: ['405AC0000000088', '行政手続法'],
  kenpou: ['321CONSTITUTION', '日本国憲法'],
  bochi: ['323AC0000000048', '墓地、埋葬等に関する法律'],
  fufuku: ['426AC0000000068', '行政不服審査法']
};

// [法令, 条（枝番は _）または別表名, 照合する語句…（!で始まるものは含まれないこと）]
export const CHECKS = [
  ['touki', '47', '新築した建物', '一月以内に、表題登記を申請しなければならない'],
  ['touki', '51', '変更があった日から一月以内に、当該登記事項に関する変更の登記を申請しなければならない'],
  ['touki', '119', '何人も', '登記事項証明書'],
  ['touki', '121', '何人も', '政令で定める図面'],
  ['touki', '164', '十万円以下の過料'],
  ['chihouzei', '22', '秘密を漏らし'],
  ['chihouzei', '348', '宗教法人が専らその本来の用に供する宗教法人法第三条に規定する境内建物及び境内地'],
  ['chihouzei', '382_2', '納税義務者その他の政令で定める者の求め'],
  ['toshi', '29', '開発行為をしようとする者は', '許可を受けなければならない'],
  ['toshi', '34', '市街化調整区域', '開発審査会の議を経て'],
  ['toshi', '42', '予定建築物等以外の建築物', 'その用途を変更して', '許可したとき'],
  ['toshi', '43', '市街化調整区域', 'その用途を変更して', '許可を受けなければ'],
  ['toshi', '47', '登録簿', '閲覧'],
  ['toshi', '81', '違反した者', '必要な措置をとることを命ずる'],
  ['toshiRei', '21', '公民館', '図書館', '!寺院', '!宗教'],
  ['kenchiku', '2', '特殊建築物', '集会場', '!寺院', '!教会'],
  ['kenchiku', '3', '現に存する建築物', '適用しない'],
  ['kenchiku', '6', '十平方メートル以内', '二百平方メートル'],
  ['kenchiku', '9', '違反した建築物', '使用禁止'],
  ['kenchiku', '49', '特別用途地区', '条例で'],
  ['kenchiku', '87', '用途を変更して', '特殊建築物'],
  ['kenchiku', '93_2', '閲覧'],
  ['kenchiku', '別表第一', '集会場', '!寺院', '!教会'],
  ['kenchiku', '別表第二', '神社、寺院、教会その他これらに類するもの'],
  ['shoboRei', '別表第一', '公会堂又は集会場', '神社、寺院、教会その他これらに類するもの'],
  ['shoboRei', '1_2', '五十人以上'],
  ['shoboKisoku', '1_3', '（十一）項', '礼拝、集会又は休憩の用に供する部分の床面積の合計を三平方メートルで除して得た数'],
  ['shobo', '17_3_3', '点検させ', '報告しなければならない'],
  ['shobo', '5_3', '避難その他の消防の活動に支障になると認める物件'],
  ['shobo', '8_2_4', '避難の支障になる物件'],
  ['shukyo', '65', '商業登記法'],
  ['jifuku', '59_2', '少数の乳児又は幼児を対象とするもの'],
  ['souon', '28', '拡声機を使用する放送', '地方公共団体'],
  ['ryokan', '2', '宿泊料を受けて、人を宿泊させる営業'],
  ['ryokan', '3', '許可を受けなければならない'],
  ['shokuhin', '55', '許可を受けなければならない'],
  ['jifuku', '59_2', '一月以内', '届け出なければならない'],
  ['jokaso', '5', '浄化槽を設置し', '届け出なければならない'],
  ['shako', '11', '道路上の場所', '十二時間', '八時間'],
  ['doro', '32', '許可を受けなければならない'],
  ['dokoho', '45', '消防用防火水槽', '五メートル以内'],
  ['toukiRei', '21', '建物図面', '各階平面図'],
  ['shukyo', '85', '干渉する権限'],
  ['tetsuzuki', '3', '地方公共団体の機関がする処分（その根拠となる規定が条例又は規則に置かれているものに限る。）及び行政指導'],
  ['tetsuzuki', '36_3', '何人も', '法令に違反する事実', '必要な調査を行い'],
  ['kenpou', '20', '信教の自由は、何人に対してもこれを保障する'],
  ['bochi', '10', '許可を受けなければならない'],
  ['fufuku', '18', '三月']
];

const plain = xml => xml
  .replace(/<ArticleTitle>([^<]*)<\/ArticleTitle>/g, '\n$1\n')
  .replace(/<ParagraphNum>([^<]*)<\/ParagraphNum>/g, '\n[$1] ')
  .replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

const fullCache = {};
async function fetchText(lawId, art) {
  if (art.startsWith('別表')) {
    if (!fullCache[lawId]) {
      const r = await fetch(`https://laws.e-gov.go.jp/api/1/lawdata/${lawId}`);
      fullCache[lawId] = await r.text();
    }
    const tables = fullCache[lawId].match(/<AppdxTable[\s\S]*?<\/AppdxTable>/g) || [];
    const t = tables.find(x => (x.match(/<AppdxTableTitle[^>]*>([^<]*)</) || [])[1]?.startsWith(art));
    if (!t) throw new Error(`取得できません: ${lawId} ${art}`);
    return plain(t);
  }
  const r = await fetch(`https://laws.e-gov.go.jp/api/1/articles;lawId=${lawId};article=${art}`);
  const x = await r.text();
  if (!/<Code>0<\/Code>/.test(x)) throw new Error(`取得できません: ${lawId} 第${art}条`);
  return plain(x.split('<LawContents>')[1] || '');
}

const dump = process.argv.includes('--dump');
let ng = 0;
const out = [];
for (const [law, art, ...phrases] of CHECKS) {
  const [id, name] = LAWS[law];
  const label = art.startsWith('別表') ? art : `第${art.replace(/_/g, '条の').replace(/^(\d+)$/, '$1条')}`;
  let text = '';
  try { text = await fetchText(id, art); } catch (e) { console.log('NG', name, e.message); ng++; continue; }
  const flat = text.replace(/\s/g, '');
  const miss = phrases.filter(p => p.startsWith('!') ? flat.includes(p.slice(1)) : !flat.includes(p.replace(/\s/g, '')));
  console.log(miss.length ? 'NG' : 'OK', `${name} ${label}`, miss.length ? '合わない語句：' + miss.join(' / ') : '');
  if (miss.length) ng++;
  out.push(`=== ${name} ${id} ${label} ===\n${text}\n`);
}
if (dump) { mkdirSync('research', { recursive: true }); writeFileSync('research/reihai-laws.txt', out.join('\n')); }
console.log(ng ? `照合できなかったもの ${ng} 件` : 'すべて照合できました', `（確認日 ${new Date().toLocaleDateString('sv-SE')}）`);
process.exit(ng ? 1 : 0);
