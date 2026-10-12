const gasAvailable = () => Boolean(globalThis.google?.script?.run);
const gasCall = (name, ...args) => new Promise((resolve, reject) => {
  const runner = globalThis.google.script.run
    .withSuccessHandler(resolve)
    .withFailureHandler(error => reject(new Error(error?.message || String(error))));
  runner[name](...args);
});

async function readJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export const isGasApp = gasAvailable;

export async function loadCardDatabase() {
  return gasAvailable() ? gasCall('getCardDatabase') : readJson('/cards_db.json');
}

export async function getChatStatus() {
  return gasAvailable() ? gasCall('getChatStatus') : readJson('/api/status');
}

export async function startChatAuth() {
  if (gasAvailable()) return gasCall('startChatAuth');
  const response = await fetch('/api/auth/start', { method: 'POST' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '接続を開始できませんでした');
  return result;
}

export async function requestInterpretation(payload) {
  if (gasAvailable()) return gasCall('generateInterpretation', payload);
  const response = await fetch('/api/interpretation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'AI生成に失敗しました');
  return result;
}

export async function loadCardImages(cardIds) {
  const ids = [...new Set(cardIds.map(Number).filter(id => Number.isInteger(id) && id >= 1 && id <= 36))];
  const images = {};
  if (!gasAvailable()) {
    for (const id of ids) images[String(id)] = `/cards/${String(id).padStart(2, '0')}.png`;
    return images;
  }
  for (let start = 0; start < ids.length; start += 8) {
    const batch = ids.slice(start, start + 8);
    Object.assign(images, await gasCall('getPrivateCardImages', batch));
  }
  return images;
}
