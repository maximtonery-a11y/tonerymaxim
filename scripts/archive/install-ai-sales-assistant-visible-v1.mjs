import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageRoot = path.join(root, '.ai-sales-assistant-v1');

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest);
    else await fs.copyFile(src, dest);
  }
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

const sourceSrc = path.join(packageRoot, 'src');
const targetSrc = path.join(root, 'src');

if (!(await exists(sourceSrc))) {
  console.error('Chýba priečinok .ai-sales-assistant-v1/src. Rozbaľte ZIP do koreňa projektu.');
  process.exit(1);
}

const floatingAdvisor = path.join(root, 'src/components/FloatingAdvisor.astro');
if (await exists(floatingAdvisor)) {
  const backup = path.join(root, `src/components/FloatingAdvisor.backup-${Date.now()}.astro`);
  await fs.copyFile(floatingAdvisor, backup);
  console.log(`Záloha pôvodného FloatingAdvisor: ${path.relative(root, backup)}`);
}

await copyDir(sourceSrc, targetSrc);

console.log('AI Sales Assistant v1 bol nainštalovaný.');
console.log('Existujúci poradca vpravo dole bol nahradený AI poradcom.');
console.log('Spustite: npm run build');
