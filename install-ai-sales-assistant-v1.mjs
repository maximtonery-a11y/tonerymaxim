import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'src');

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

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }

async function patchAstro(file, importPath, marker = '<AISalesAssistant />') {
  let content = await fs.readFile(file, 'utf8');
  if (!content.includes('AISalesAssistant')) {
    if (content.trimStart().startsWith('---')) content = content.replace(/^---\n/, `---\nimport AISalesAssistant from '${importPath}';\n`);
    else content = `---\nimport AISalesAssistant from '${importPath}';\n---\n` + content;
  }
  if (content.includes(marker)) return false;
  if (content.includes('</header>')) content = content.replace('</header>', `</header>\n${marker}`);
  else if (content.includes('</body>')) content = content.replace('</body>', `  ${marker}\n</body>`);
  else content += `\n${marker}\n`;
  await fs.writeFile(file, content, 'utf8');
  return true;
}

await copyDir(sourceRoot, path.join(root, 'src'));

const header = path.join(root, 'src/components/Header.astro');
const layout = path.join(root, 'src/layouts/Layout.astro');
let patched = false;
if (await exists(header)) patched = await patchAstro(header, './AISalesAssistant.astro');
else if (await exists(layout)) patched = await patchAstro(layout, '../components/AISalesAssistant.astro');

console.log('AI Sales Assistant v1 súbory boli skopírované.');
console.log(patched ? 'Komponent bol vložený do Header.astro/Layout.astro.' : 'Komponent už bol vložený alebo ho vložte ručne podľa INSTALL.md.');
