import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function readSecret(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal.');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const done = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') return done(new Error('Cancelled.'));
        if (char === '\r' || char === '\n') return done();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

const [sourcePath, bundlePath] = process.argv.slice(2);
if (!sourcePath || !bundlePath) {
  console.error('Usage: node server/export-credential-bundle.mjs <local-credential-json> <encrypted-output-file>');
  process.exit(2);
}
if (path.resolve(sourcePath) === path.resolve(bundlePath)) throw new Error('Input and output paths must differ.');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const credential = source.credential || source;
for (const field of ['clientId', 'accessToken', 'refreshToken', 'idToken']) {
  if (typeof credential[field] !== 'string' || !credential[field]) throw new Error(`Credential file is missing ${field}.`);
}
if (!Array.isArray(credential.scopes) || !credential.scopes.includes('chatgpt.tokens.use.direct')) {
  throw new Error('Credential does not include ChatGPT plan usage permission.');
}

const passphrase = await readSecret('Transfer passphrase (min. 16 characters): ');
if (passphrase.length < 16) throw new Error('Use a passphrase with at least 16 characters.');
const confirm = await readSecret('Re-enter passphrase: ');
if (passphrase !== confirm) throw new Error('Passphrases did not match.');

const salt = randomBytes(16);
const iv = randomBytes(12);
const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1 });
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credential), 'utf8'), cipher.final()]);
const bundle = JSON.stringify({ version: 1, salt: salt.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') });
await writeFile(bundlePath, bundle, { mode: 0o600, flag: 'wx' });
try { await chmod(bundlePath, 0o600); } catch { /* Windows ACLs replace POSIX mode bits. */ }
console.log('Encrypted credential bundle created. It contains secrets; transfer it only over SSH and delete it after import.');
