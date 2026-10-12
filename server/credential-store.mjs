import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'),
  'LenormandOracleWeb',
);

const SETTINGS_FILE = path.join(DATA_DIR, 'chatgpt-credentials.json');
const HOST_ID_FILE = path.join(DATA_DIR, 'ext-agent-host-id');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function encryptionKey() {
  const encoded = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encoded) {
    if (IS_PRODUCTION) throw new Error('TOKEN_ENCRYPTION_KEY is required in production.');
    return null;
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes.');
  return key;
}

async function writeSecure(filePath, contents) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const handle = await open(tempPath, 'w', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, filePath);
}

function encryptSettings(settings, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ credential: settings.credential }), 'utf8'),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  });
}

function decryptSettings(serialized, key) {
  const record = JSON.parse(serialized);
  if (record.version !== 1 || !record.iv || !record.tag || !record.ciphertext) {
    throw new Error('Credential file format is invalid.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(cleartext);
}

export async function loadSettings() {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  let hostId;
  try {
    hostId = (await readFile(HOST_ID_FILE, 'utf8')).trim();
    if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(hostId)) throw new Error('VM host ID is invalid.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    let legacySettings = {};
    try { legacySettings = JSON.parse(await readFile(SETTINGS_FILE, 'utf8')); }
    catch (legacyError) { if (legacyError.code !== 'ENOENT') throw legacyError; }
    hostId = typeof legacySettings.hostId === 'string' && /^urn:uuid:[0-9a-f-]{36}$/i.test(legacySettings.hostId)
      ? legacySettings.hostId
      : `urn:uuid:${randomUUID()}`;
    await writeSecure(HOST_ID_FILE, hostId);
  }

  const key = encryptionKey();
  let credential = null;
  try {
    const serialized = await readFile(SETTINGS_FILE, 'utf8');
    if (key && serialized.includes('"ciphertext"')) {
      credential = decryptSettings(serialized, key).credential || null;
    } else {
      if (IS_PRODUCTION) throw new Error('Refusing to load an unencrypted production credential file.');
      credential = JSON.parse(serialized).credential || null;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { hostId, credential };
}

export async function saveSettings(settings) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const key = encryptionKey();
  if (IS_PRODUCTION && settings.credential && !key) {
    throw new Error('Cannot save credentials without TOKEN_ENCRYPTION_KEY.');
  }
  if (settings.hostId) await writeSecure(HOST_ID_FILE, settings.hostId);
  const serialized = key
    ? encryptSettings(settings, key)
    : JSON.stringify(settings, null, 2);
  await writeSecure(SETTINGS_FILE, serialized);
}

export async function installImportedCredential(credential) {
  const required = ['clientId', 'accessToken', 'refreshToken', 'idToken'];
  if (!credential || required.some((field) => typeof credential[field] !== 'string' || !credential[field])) {
    throw new Error('The imported ChatGPT credential file is incomplete.');
  }
  if (!Array.isArray(credential.scopes) || !credential.scopes.includes('chatgpt.tokens.use.direct')) {
    throw new Error('The imported ChatGPT session does not include plan usage permission.');
  }
  const current = await loadSettings();
  await saveSettings({ ...current, credential });
  return current.hostId;
}
