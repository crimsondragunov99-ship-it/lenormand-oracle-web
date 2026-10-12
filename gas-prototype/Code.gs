function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Lenormand Oracle')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function ping() {
  return { ok: true, service: 'Lenormand Oracle GAS', time: new Date().toISOString() };
}

function getChatStatus() {
  return { connected: false, email: null, authMode: 'gas' };
}

function startChatAuth() {
  return { error: 'GAS上でのChatGPTプラン連携は公式手順の対象として確認できていません。認証情報は取り込みません。' };
}

function getCardDatabase() {
  const file = findPrivateAsset_('cards_db.json');
  const data = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  if (!Array.isArray(data.cards) || data.cards.length !== 36) throw new Error('カード定義に36枚のデータがありません。');
  return data;
}

function getPrivateCardImages(cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 8) throw new Error('画像の一括取得は1〜8枚に制限されています。');
  const result = {};
  [...new Set(cardIds.map(Number))].forEach(id => {
    if (!Number.isInteger(id) || id < 1 || id > 36) throw new Error('カードIDが不正です。');
    const file = findPrivateAsset_(`${String(id).padStart(2, '0')}.webp`);
    const mimeType = file.getMimeType();
    if (mimeType !== 'image/webp') throw new Error(`カード${id}の画像形式がWebPではありません。`);
    const bytes = file.getBlob().getBytes();
    if (bytes.length > 900000) throw new Error(`カード${id}の画像サイズが上限を超えています。`);
    result[String(id)] = `data:${mimeType};base64,${Utilities.base64Encode(bytes)}`;
  });
  return result;
}

function getPrivateImagePreview() {
  const fileId = PropertiesService.getScriptProperties().getProperty('TEST_IMAGE_FILE_ID');
  if (!fileId) return { configured: false };
  const file = DriveApp.getFileById(fileId);
  const mimeType = file.getMimeType();
  if (!mimeType || !mimeType.startsWith('image/')) throw new Error('設定ファイルは画像ではありません。');
  const bytes = file.getBlob().getBytes();
  if (bytes.length > 1000000) throw new Error('確認用画像は1 MB以下にしてください。');
  return { configured: true, name: file.getName(), mimeType, dataUrl: `data:${mimeType};base64,${Utilities.base64Encode(bytes)}` };
}

function findPrivateAsset_(name) {
  const folderId = PropertiesService.getScriptProperties().getProperty('LENORMAND_ASSET_FOLDER_ID');
  if (!folderId) throw new Error('LENORMAND_ASSET_FOLDER_IDが未設定です。');
  const files = DriveApp.getFolderById(folderId).getFilesByName(name);
  if (!files.hasNext()) throw new Error(`Drive素材が見つかりません: ${name}`);
  const file = files.next();
  if (files.hasNext()) throw new Error(`Drive素材名が重複しています: ${name}`);
  return file;
}
