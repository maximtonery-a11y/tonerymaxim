import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageRoot = path.join(root, '.ai-sales-assistant-v2');

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

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

const sourceSrc = path.join(packageRoot, 'src');
const targetSrc = path.join(root, 'src');

if (!(await exists(sourceSrc))) {
  console.error('Chýba priečinok .ai-sales-assistant-v2/src. Rozbaľte ZIP do koreňa projektu.');
  process.exit(1);
}

const filesToBackup = [
  'src/components/FloatingAdvisor.astro',
  'src/lib/aiSalesAssistant.ts',
  'src/pages/api/ai-sales-assistant.ts',
  'src/scripts/ai-sales-assistant.js',
  'src/styles/ai-sales-assistant.css',
];

const stamp = Date.now();
for (const rel of filesToBackup) {
  const file = path.join(root, rel);
  if (await exists(file)) {
    const backup = path.join(root, `${rel}.backup-${stamp}`);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.copyFile(file, backup);
    console.log(`Záloha: ${path.relative(root, backup)}`);
  }
}

await copyDir(sourceSrc, targetSrc);

console.log('AI Sales Assistant v2 bol nainštalovaný.');
console.log('Opravené: FAQ bez náhodných produktov, presnejšie produktové vyhľadávanie, skupiny kompatibilné/originálne/renovované a neodskakovanie na koniec odpovede.');
console.log('Spustite: npm run build');
