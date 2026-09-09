import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowed = new Set(['--repository', '--check']);
for (const argument of process.argv.slice(2)) if (!allowed.has(argument)) throw new TypeError(`Unknown argument ${argument}; use [--repository] [--check]`);
const here = dirname(fileURLToPath(import.meta.url));
const authority = await readFile(resolve(here, 'identity-normalization.mjs'));
if (!process.argv.includes('--repository')) {
  // A standalone identity skill already contains the authority. It has no local
  // generated copies and must not read or create a sibling pixel installation.
  console.log('Standalone identity authority available; no generated copies in this skill. Use --repository to manage the pixel bundle.');
} else {
  const pixelRoot = resolve(here, '../../first-party-pixel');
  if (!(await stat(pixelRoot).catch(() => null))?.isDirectory()) throw new Error('--repository requires the sibling first-party-pixel skill');
  const target = resolve(pixelRoot, 'assets/collector/identity-normalization.mjs');
  if (process.argv.includes('--check')) {
    const existing = await readFile(target).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!existing || !existing.equals(authority)) {
      console.error(`Generated identity artifact is ${existing ? 'stale' : 'missing'}: ${relative(process.cwd(), target)}`);
      process.exitCode = 1;
    } else console.log(`Identity artifact is current: ${relative(process.cwd(), target)}`);
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, authority);
    console.log(`Wrote ${relative(process.cwd(), target)}`);
  }
}
