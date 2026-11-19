import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, '.scanner-guards-src');
const outDir = join(root, '.scanner-guards-out');
const dest = join(root, 'dist', 'elar-usul', 'browser', 'scanner-guards');

rmSync(srcDir, { recursive: true, force: true });
rmSync(outDir, { recursive: true, force: true });

execSync(
  'git clone --depth 1 --branch scanner-guards https://github.com/elarusul/ElarUsul.git .scanner-guards-src',
  { cwd: root, stdio: 'inherit' },
);
execSync('npm ci', { cwd: srcDir, stdio: 'inherit' });
execSync('npx ng build --base-href /scanner-guards/ --output-path ../.scanner-guards-out', {
  cwd: srcDir,
  stdio: 'inherit',
});

const built = existsSync(join(outDir, 'browser')) ? join(outDir, 'browser') : outDir;
rmSync(dest, { recursive: true, force: true });
cpSync(built, dest, { recursive: true });
rmSync(srcDir, { recursive: true, force: true });
rmSync(outDir, { recursive: true, force: true });
