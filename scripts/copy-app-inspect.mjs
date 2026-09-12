import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'node_modules', '@h-t-m', 'app-inspect', 'dist');
const target = path.join(root, 'public', 'vendor', 'app-inspect');

try {
  const info = await stat(source);
  if (!info.isDirectory()) throw new Error('app-inspect dist is not a directory');
} catch (error) {
  throw new Error(`Cannot vendor @h-t-m/app-inspect browser runtime from ${source}: ${error instanceof Error ? error.message : String(error)}`);
}

await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });

console.log(`Vendored @h-t-m/app-inspect browser runtime to ${path.relative(root, target)}`);
