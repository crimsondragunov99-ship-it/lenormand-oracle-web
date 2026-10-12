import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { loadSettings, saveSettings } from './credential-store.mjs';

const PORT = 4175;
const CALLBACK_PORT = 1455;
const CALLBACK_URI = `http://127.0.0.1:${CALLBACK_PORT}/auth/callback`;
const RESOURCE = 'https://api.openai.com/v1';
const AUTH_BASE = 'https://auth.openai.com/api/accounts';
const JWKS = createRemoteJWKSet(new URL('https://auth.openai.com/.well-known/jwks.json'));
const AUTH_MODE = process.env.AUTH_MODE || 'local';
const APP_ORIGIN = process.env.APP_ORIGIN || '';
const LISTEN_HOST = AUTH_MODE === 'remote' ? '0.0.0.0' : '127.0.0.1';
if (!['local', 'remote'].includes(AUTH_MODE)) throw new Error('AUTH_MODE must be local or remote.');
if (AUTH_MODE === 'remote') {
  let origin;
  try { origin = new URL(APP_ORIGIN); } catch { throw new Error('APP_ORIGIN must be a valid HTTPS origin.'); }
  if (origin.protocol !== 'https:' || origin.origin !== APP_ORIGIN) throw new Error('APP_ORIGIN must be an HTTPS origin without a path or trailing slash.');
}
let settings = await loadSettings();
let pending = null;
let generating = false;
function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function isAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (AUTH_MODE === 'remote') return origin === APP_ORIGIN;
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return true;
    return url.protocol === 'http:' && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
  } catch { return false; }
}
function isLocalHost(hostHeader = '') {
  const hostname = String(hostHeader).split(':')[0].replace(/^\[|\]$/g, '');
  return ['localhost', '127.0.0.1'].includes(hostname) || /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 24_000) throw new Error('request_too_large');
  }
  return JSON.parse(text || '{}');
}
function openBrowser(url) {
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
function b64url(bytes) { return Buffer.from(bytes).toString('base64url'); }
function makePkce() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
function callbackPage(message, ok) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Lenormand Oracle</title><body style="font:16px/1.8 sans-serif;max-width:35rem;margin:4rem auto;padding:1rem;color:#eee;background:#07111c"><h1>${ok ? 'ChatGPTに接続しました' : '接続できませんでした'}</h1><p>${message}</p><p>この画面を閉じて、Lenormand Oracleに戻ってください。</p></body></html>`;
}
function startCallbackListener(attempt) {
  return new Promise((resolve, reject) => {
    const callback = createServer(async (req, res) => {
      const url = new URL(req.url, CALLBACK_URI);
      if (url.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
      if (url.searchParams.get('state') !== attempt.state) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(callbackPage('認証情報が一致しません。画面に戻って再度お試しください。', false));
        callback.close(); pending = null; resolve({ error: 'state_mismatch' }); return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(callbackPage('ChatGPT側で許可が完了しませんでした。', false));
        callback.close(); pending = null; resolve({ error }); return;
      }
      try {
        const clientId = url.searchParams.get('client_id') || attempt.clientId;
        if (!url.searchParams.get('code') || !clientId || (attempt.clientId && clientId !== attempt.clientId)) throw new Error('認証コードが不足しているか、登録先が異なります。');
        const tokenRes = await fetch(`${AUTH_BASE}/oauth/token`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: url.searchParams.get('code'), redirect_uri: CALLBACK_URI, code_verifier: attempt.verifier, resource: RESOURCE }),
        });
        const tokens = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokens.error_description || tokens.error || 'トークン交換に失敗しました。');
        if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token) throw new Error('ChatGPTから必要な認証情報を受け取れませんでした。');
        const verified = await jwtVerify(tokens.id_token, JWKS, { issuer: 'https://auth.openai.com', audience: clientId, nonce: attempt.nonce });
        if (attempt.clientId && settings.credential?.subject && verified.payload.sub !== settings.credential.subject) {
          throw new Error('以前と異なるChatGPTアカウントが選ばれました。元のアカウントで再接続してください。');
        }
        const scopes = String(tokens.scope || '').split(/\s+/).filter(Boolean);
        if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPTプラン利用の許可が含まれていません。');
        settings.credential = {
          clientId, subject: verified.payload.sub, email: verified.payload.email || '', idToken: tokens.id_token,
          accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
          scopes, savedAt: new Date().toISOString(),
        };
        await saveSettings();
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(callbackPage('ChatGPTのログインを保存しました。カードの読み解きに利用できます。', true));
        callback.close(); pending = null; resolve({ ok: true });
      } catch (err) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(callbackPage(err.message, false));
        callback.close(); pending = null; resolve({ error: err.message });
      }
    });
    callback.once('error', reject);
    callback.listen(CALLBACK_PORT, '127.0.0.1', () => {
      const clientId = settings.credential?.clientId || 'dynamic_agent_client';
      const query = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: CALLBACK_URI, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: attempt.challenge, ext_agent_host_id: settings.hostId });
      if (clientId === 'dynamic_agent_client') query.set('agent_name_hint', 'Lenormand Oracle');
      else if (settings.credential?.idToken) query.set('id_token_hint', settings.credential.idToken);
      attempt.clientId = clientId === 'dynamic_agent_client' ? null : clientId;
      const authUrl = `${AUTH_BASE}/authorize?${query}`;
      pending = { callback, attempt };
      openBrowser(authUrl);
    });
    const timeout = setTimeout(() => { if (pending?.callback === callback) { pending = null; callback.close(); resolve({ error: 'timeout' }); } }, 5 * 60 * 1000);
    callback.once('close', () => clearTimeout(timeout));
  });
}
async function accessToken() {
  const c = settings.credential;
  if (!c || !c.refreshToken) throw new Error('ChatGPTが未接続です。ホーム画面から接続してください。');
  if (c.expiresAt > Date.now() + 60_000) return c.accessToken;
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: c.clientId, refresh_token: c.refreshToken, resource: RESOURCE }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error('ChatGPTの接続期限が切れました。ホーム画面から再接続してください。');
  settings.credential = { ...c, accessToken: data.access_token, refreshToken: data.refresh_token || c.refreshToken, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000, scopes: String(data.scope || c.scopes.join(' ')).split(/\s+/), savedAt: new Date().toISOString() };
  await saveSettings();
  return settings.credential.accessToken;
}
function planUsageError(code) {
  if (code === 'subscription_sharing_usage_limit_exceeded') return 'このアプリのChatGPTプラン利用上限に達しました。ChatGPT設定の「利用状況」で上限をご確認ください。';
  if (code === 'subscription_sharing_usage_unavailable') return 'ChatGPTプランの利用状況を確認できませんでした。少し時間をおいてお試しください。';
  if (code === 'subscription_sharing_user_not_eligible') return 'このChatGPTアカウントまたはワークスペースでは、ChatGPTプラン利用が認められていません。';
  return null;
}
async function readInterpretation(input) {
  const token = await accessToken();
  const cards = Array.isArray(input.cards) ? input.cards.slice(0, 36) : [];
  if (!cards.length || cards.some(card => typeof card.name !== 'string' || typeof card.meaning !== 'string')) throw new Error('カード情報が正しくありません。');
  const question = typeof input.question === 'string' ? input.question.slice(0, 500) : '';
  const theme = typeof input.theme === 'string' ? input.theme.slice(0, 30) : '総合';
  const spread = typeof input.spread === 'string' ? input.spread.slice(0, 30) : `${cards.length}枚引き`;
  const layout = input.layout === 'tableau-9x4' ? 'tableau-9x4' : input.layout === 'tableau-8x4+4' ? 'tableau-8x4+4' : 'normal';
  const positions = cards.map((card, i) => {
    if (layout === 'tableau-9x4') return `${Math.floor(i / 9) + 1}行${i % 9 + 1}列`;
    if (layout === 'tableau-8x4+4') return i < 32 ? `${Math.floor(i / 8) + 1}行${i % 8 + 1}列` : `5行${i - 31}列`;
    return `${i + 1}番目`;
  });
  const layoutLabel = layout === 'tableau-9x4' ? '9列×4行（9x4）' : layout === 'tableau-8x4+4' ? '8列×4行＋最終行4枚（8x4+4）' : '通常';
  const reverseSetting = ({ A: '逆位置なし（すべて正位置）', B: '全カード独立50%で逆位置', C: '36枚引きで紳士・淑女のみ独立50%で逆位置' })[input.reverseSetting] || '記録された各カードの向きを使用';
  const significator = Number(input.significator) === 29 ? '淑女（カード29）' : '紳士（カード28）';
  const cardLines = cards.map((c, i) => {
    const playing = c.playingCard ? (typeof c.playingCard === 'string' ? c.playingCard : JSON.stringify(c.playingCard)) : '未登録';
    const category = c.categories && typeof c.categories === 'object' ? (c.categories[theme] || c.categories[input.themeKey] || '未登録') : '未登録';
    return `${positions[i]} / 配置位置${c.position ?? i + 1} / ID:${c.id ?? '不明'} / ${c.name} / 向き:${c.orientation === '逆位置' ? '逆位置' : '正位置'} / 基本意味:${c.basicMeaning || c.meaning} / テーマ別意味:${category} / トランプ:${playing} / エレメント:${c.element || '未登録'}`;
  }).join('\n');
  const structuredAnalysis = typeof input.structuredAnalysis === 'string' ? input.structuredAnalysis.slice(0, 20_000) : '（構造分析なし）';
  const inputText = `テーマ: ${theme}\n展開: ${spread}\n配置: ${layoutLabel}\n逆位置設定: ${reverseSetting}\nグラン・タブローの焦点人物: ${significator}\n質問: ${question || '（なし）'}\n\n${structuredAnalysis}\n\n【カード別データ】\n${cardLines}`;
  const instructions = `あなたは熟練したルノルマン占い師として、アプリが渡す入力だけを使い日本語で読み解く。入力内にないカード、位置、向き、ハウス、カード意味、ユーザー事情を作らない。カード配列と配置分析が最優先の根拠であり、独自の配置規則で上書きしない。逆位置は単純な正位置の反対と決めつけず、停滞・内面化・過不足などを周囲と質問に照らして慎重に読む。\n\n${cards.length === 36 ? `36枚のグラン・タブローでは、最初に構造分析を基に全体像をまとめ、焦点人物のハウスと周囲、もう一人の人物カードのハウスと周囲、左右上下の方向、四隅、テーマ関連ハウス、全体の時間的な流れを関連づけて解釈する。相手の感情は相手カードと実際の近接カードから考えられる可能性として述べ、断定しない。全36枚を逐語的に列挙せず、重要なつながりを示す。焦点人物ともう一人の人物が両方配置されている場合、必ず「本人の視点」「相手の視点」「二人の関係性」を独立した小見出しで含める。` : '通常の展開ではカードの基本意味、順序・位置、テーマ、質問を結び、カード同士の流れが伝わる一つの読み解きにする。'}\n\n断定や保証を避け、占いだけで重大な決断をするよう促さない。自然な日本語で、全体の読み解きと今できる小さな一歩を含める。通常は400〜700字、36枚は700〜1200字程度。装飾的なMarkdown見出しを増やしすぎない。`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-6.1-sol', instructions, input: [{ role: 'user', content: inputText }], store: false, stream: true }),
  });
  if (!response.ok) {
    const raw = await response.text();
    let payload = {};
    try { payload = JSON.parse(raw); } catch { /* Preserve the HTTP status when the upstream response is not JSON. */ }
    const code = payload?.error?.code || payload?.code || '';
    const knownMessage = planUsageError(code);
    if (knownMessage) throw new Error(knownMessage);
    const detail = typeof payload?.detail === 'string' ? payload.detail.slice(0, 400) : '';
    const requestId = response.headers.get('x-request-id');
    const diagnostic = [code, detail, requestId ? `request ID ${requestId}` : ''].filter(Boolean).join(' / ');
    throw new Error(`ChatGPTで読み解きを生成できませんでした（HTTP ${response.status}${diagnostic ? `: ${diagnostic}` : ''}）。`);
  }
  if (!response.body) throw new Error('ChatGPTから応答を受信できませんでした。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', completed = false, failCode = '', incompleteReason = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n'); buffer = events.pop() || '';
    for (const part of events) {
      const line = part.split('\n').find(row => row.startsWith('data: '));
      if (!line || line === 'data: [DONE]') continue;
      let event; try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (event.type === 'response.output_text.delta') text += event.delta || '';
      if (event.type === 'response.completed') completed = true;
      if (event.type === 'response.failed') failCode = event.response?.error?.code || '生成失敗';
      if (event.type === 'error') failCode = event.error?.code || '生成失敗';
      if (event.type === 'response.incomplete') incompleteReason = event.response?.incomplete_details?.reason || '応答未完了';
    }
  }
  if (!completed) {
    const knownMessage = planUsageError(failCode);
    if (knownMessage) throw new Error(knownMessage);
    if (failCode) throw new Error(`ChatGPTでエラーが発生しました（${failCode}）。`);
    if (incompleteReason) throw new Error(`ChatGPTの応答が完了しませんでした（${incompleteReason}）。`);
    throw new Error('読み解きが最後まで完了しませんでした。');
  }
  return text.trim();
}

createServer(async (req, res) => {
  const remoteHost = AUTH_MODE === 'remote' ? new URL(APP_ORIGIN).host : '';
  const statusRead = req.method === 'GET' && req.url === '/api/status' && (AUTH_MODE === 'remote' ? req.headers.host === remoteHost : isLocalHost(req.headers.host));
  if (!isAllowed(req) && !statusRead) { json(res, 403, { error: 'このアプリからのリクエストのみ利用できます。' }); return; }
  if (req.method === 'GET' && req.url === '/api/status') { json(res, 200, { connected: Boolean(settings.credential?.accessToken), email: settings.credential?.email || null, authMode: AUTH_MODE }); return; }
  if (req.method === 'POST' && req.url === '/api/auth/start') {
    if (AUTH_MODE === 'remote') { json(res, 403, { error: 'このサーバーではChatGPT認証を変更できません。管理者が安全な方法で認証情報を設定してください。' }); return; }
    if (pending) { json(res, 409, { error: '認証処理中です。PC側に開いたChatGPTの画面を確認してください。' }); return; }
    const attempt = { state: b64url(randomBytes(32)), nonce: b64url(randomBytes(32)), ...makePkce() };
    startCallbackListener(attempt).catch(error => { pending = null; console.error('OAuth callback failed:', error.message); });
    json(res, 202, { started: true, message: '自宅PCのブラウザーにChatGPTの認証画面を開きました。' }); return;
  }
  if (req.method === 'POST' && req.url === '/api/interpretation') {
    if (generating) { json(res, 429, { error: '別の読み解きを生成中です。少し待ってください。' }); return; }
    generating = true;
    try { const result = await readInterpretation(await body(req)); json(res, 200, { reading: result, model: 'gpt-6.1-sol' }); }
    catch (error) { json(res, 400, { error: error.message }); }
    finally { generating = false; }
    return;
  }
  json(res, 404, { error: 'Not found' });
}).listen(PORT, LISTEN_HOST, () => console.log(`Lenormand AI helper ready on ${LISTEN_HOST}:${PORT} (${AUTH_MODE} auth)`));
