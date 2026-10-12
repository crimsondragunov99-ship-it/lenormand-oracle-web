const THEME_HOUSES = {
  romance:[24,25,28,29], work:[14,19,28,35], money:[15,34,35,2], general:[1,4,16,20,31,33,36]
};

function coord(index, layout) {
  if (layout === 'tableau-8x4+4' && index >= 32) return { row:4, col:index-32, width:4 };
  const width = layout === 'tableau-9x4' ? 9 : 8;
  return { row:Math.floor(index/width), col:index%width, width };
}

function cardAt(cards, row, col, layout) {
  if (row < 0 || col < 0) return null;
  const width = layout === 'tableau-9x4' ? 9 : 8;
  if (layout === 'tableau-8x4+4' && row === 4) return col < 4 ? cards[32+col] || null : null;
  if (col >= width || row >= 4) return null;
  const index = row * width + col;
  return cards[index] || null;
}

function cardLabel(card) {
  return card ? `${card.name}${card.orientation === '逆位置' ? '［逆］' : ''}` : '（該当なし）';
}

export function buildReadingAnalysis(cards, theme, layout, significatorId='28', houseCards=[]) {
  if (!layout?.startsWith('tableau-') || cards.length !== 36) return '';
  const focusId = Number(significatorId) === 29 ? 29 : 28;
  const companionId = focusId === 28 ? 29 : 28;
  const indexOf = id => cards.findIndex(card => Number(card.id) === id);
  const houseName = id => houseCards.find(card => Number(card.id) === id)?.name || `カード${id}`;
  const houseMeaning = id => houseCards.find(card => Number(card.id) === id)?.basic_meaning || '意味未登録';
  const houseLabel = id => `ハウス${id}「${houseName(id)}」`;
  const focusIndex = indexOf(focusId), companionIndex = indexOf(companionId);
  const fmt = i => i < 0 ? 'カードがありません' : `${i+1}番位置（${cardLabel(cards[i])}）`;
  const houseOccupants = cards.map((card, i) => `${houseLabel(i+1)}← ${cardLabel(card)}（${card.meaning || card.basic_meaning || '意味未登録'}）`);
  const around = (index, label) => {
    if (index < 0) return `${label}: 配置なし`;
    const {row,col}=coord(index,layout);
    return `${label}: 上=${cardLabel(cardAt(cards,row-1,col,layout))}／下=${cardLabel(cardAt(cards,row+1,col,layout))}／左=${cardLabel(cardAt(cards,row,col-1,layout))}／右=${cardLabel(cardAt(cards,row,col+1,layout))}`;
  };
  const corners = layout === 'tableau-9x4' ? [0,8,27,35] : [0,7,24,31];
  const themeHouses = THEME_HOUSES[theme] || THEME_HOUSES.general;
  const timeline = cards.map((c,i)=>`${i+1}:${cardLabel(c)}（${c.element||'要素未登録'}）`).join(' → ');
  return [
    '【グラン・タブロー構造分析】',
    `配置=${layout==='tableau-9x4'?'9列×4行':'8列×4行＋最終4枚'}。焦点人物=${focusId===28?'紳士':'淑女'}。`,
    `焦点カード=${fmt(focusIndex)}。焦点カードが入る${houseLabel(focusIndex+1)}（意味: ${houseMeaning(focusIndex+1)}）。`,
    `もう一人の人物カード=${fmt(companionIndex)}。その位置の${houseLabel(companionIndex+1)}（意味: ${houseMeaning(companionIndex+1)}）。`,
    around(focusIndex,'焦点人物の近接カード'), around(companionIndex,'相手人物の近接カード'),
    '時間方向の目安: 左=過去、上=表面化した状況、下=背景・潜在要因、右=今後。端の空欄をカードとして解釈しない。',
    `四隅（盤面全体のムード）: ${corners.map(i=>`${houseLabel(i+1)}=${cardLabel(cards[i])}（${cards[i].meaning||cards[i].basic_meaning||'意味未登録'}）`).join('；')}`,
    `テーマ関連ハウス（${themeHouses.join(',')}）: ${themeHouses.map(n=>`${houseLabel(n)}←${cardLabel(cards[n-1])}（${cards[n-1].meaning||cards[n-1].basic_meaning||''}）`).join('；')}`,
    `全36ハウス: ${houseOccupants.join('；')}`,
    `全体の流れ（並び順）: ${timeline}`,
    '注: ハウス番号は各配置位置に対応。近接カード・向き・正逆を取り違えず、カードにない事実を補わない。'
  ].join('\n');
}
