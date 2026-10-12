import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const hostname = process.argv[2];
if (!hostname || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) {
  console.error('Usage: node scripts/init-cloud-secrets.mjs <public-hostname>');
  process.exit(2);
}
const siteAddress = hostname.toLowerCase();
const appOrigin = `https://${siteAddress}`;
const password = randomBytes(24).toString('base64url');

const hash = await new Promise((resolve, reject) => {
  const child = spawn('docker', ['run', '--rm', '-i', 'caddy:2-alpine', 'caddy', 'hash-password'], { stdio: ['pipe', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.once('error', reject);
  child.once('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`Caddy password hashing failed (exit ${code}).`)));
  child.stdin.end(`${password}\n`);
});
if (!hash.startsWith('$2')) throw new Error('Caddy returned an unexpected password hash.');

const key = randomBytes(32).toString('base64url');
const env = [
  `APP_ORIGIN=${appOrigin}`,
  `SITE_ADDRESS=${siteAddress}`,
  'BASIC_AUTH_USER=owner',
  `BASIC_AUTH_HASH=${hash.replaceAll('$', '$$')}`,
  `TOKEN_ENCRYPTION_KEY=${key}`,
  '',
].join('\n');
await writeFile('.env.production', env, { flag: 'wx', mode: 0o600 });
try { await (await import('node:fs/promises')).chmod('.env.production', 0o600); } catch { /* POSIX mode bits are not used on Windows. */ }
console.log('Created ignored .env.production. Save this Basic Auth password in a password manager; it is not stored in the env file.');
console.log(`Username: owner\nPassword: ${password}`);
