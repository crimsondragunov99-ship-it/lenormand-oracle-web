import { createDecipheriv, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { installImportedCredential } from './credential-store.mjs';

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

const [bundlePath] = process.argv.slice(2);
if (!bundlePath) {
  console.error('Usage: node server/import-credential-bundle.mjs <encrypted-bundle-file>');
  process.exit(2);
}
const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
if (bundle.version !== 1 || !bundle.salt || !bundle.iv || !bundle.tag || !bundle.ciphertext) {
  throw new Error('Credential bundle format is invalid.');
}
const passphrase = await readSecret('Transfer passphrase: ');
const key = scryptSync(passphrase, Buffer.from(bundle.salt, 'base64url'), 32, { N: 32768, r: 8, p: 1 });
const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(bundle.iv, 'base64url'));
decipher.setAuthTag(Buffer.from(bundle.tag, 'base64url'));
const cleartext = Buffer.concat([
  decipher.update(Buffer.from(bundle.ciphertext, 'base64url')),
  decipher.final(),
]).toString('utf8');
const credential = JSON.parse(cleartext);
const hostId = await installImportedCredential(credential);
console.log(`Credential imported and encrypted in the server data directory. VM host ID: ${hostId}`);
