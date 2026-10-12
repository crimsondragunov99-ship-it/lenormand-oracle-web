import { build } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'gas-prototype/generated');
await build({ configFile: resolve(root, 'vite.gas.config.js') });
const files = await readdir(output);
const jsFile = files.find(name => name.endsWith('.js'));
const cssFile = files.find(name => name.endsWith('.css'));
if (!jsFile || !cssFile) throw new Error('Vite did not emit the GAS JavaScript and CSS bundles.');
const bundle = (await readFile(resolve(output, jsFile), 'utf8')).replace(/<\/script/gi, '<\\/script');
const styles = await readFile(resolve(output, cssFile), 'utf8');
await writeFile(resolve(root, 'gas-prototype/AppBundle.html'), bundle, 'utf8');
await writeFile(resolve(root, 'gas-prototype/AppStyles.html'), styles, 'utf8');
console.log(`Prepared GAS bundle: ${bundle.length} JS chars, ${styles.length} CSS chars.`);
