import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import vm from 'node:vm';

const componentPath = new URL('../src/components/DesktopPrinterFinder.astro', import.meta.url);
const component = await readFile(componentPath, 'utf8');
const match = component.match(/<script is:inline>\s*([\s\S]*?)\s*<\/script>/);
assert.ok(match?.[1], 'DesktopPrinterFinder.astro: inline script sa nenašiel.');
new vm.Script(match[1], { filename: 'DesktopPrinterFinder.inline.js' });

const helper = await readFile(new URL('../tools/printer-finder-windows/ToneryMaximPrinterFinder.ps1', import.meta.url), 'utf8');
const installer = await readFile(new URL('../tools/printer-finder-windows/Install.ps1', import.meta.url), 'utf8');
const verifier = await readFile(new URL('./verify-printer-helper.ps1', import.meta.url), 'utf8');
const installCmd = await readFile(new URL('../tools/printer-finder-windows/INSTALOVAT.cmd', import.meta.url));
const uninstallCmd = await readFile(new URL('../tools/printer-finder-windows/ODINSTALOVAT.cmd', import.meta.url));
assert.match(helper, /\$Version\s*=\s*"4\.6\.0"/);
assert.match(helper, /\/api\/printer-detect-submit/);
assert.doesNotMatch(helper, /tm-printer-result|printer-finder-return/);
assert.match(helper, /\[switch\]\$SelfTest/);
assert.match(helper, /if \(\$SelfTest\.IsPresent\)/);
assert.doesNotMatch(helper, /ProtocolUrl -eq ["']--self-test["']/);
assert.match(installer, /-File \$stageFile -SelfTest -OutputPath \$testFile/);
assert.doesNotMatch(installer, /["']--self-test["']/);
assert.match(verifier, /-File \$helperScript -SelfTest -OutputPath \$selfTestFile/);
assert.doesNotMatch(verifier, /["']--self-test["']/);
assert.equal(installCmd.subarray(0, 3).toString('hex'), '406563', 'INSTALOVAT.cmd nesmie mať UTF-8 BOM');
assert.equal(uninstallCmd.subarray(0, 3).toString('hex'), '406563', 'ODINSTALOVAT.cmd nesmie mať UTF-8 BOM');
assert.match(installer, /tm_printer_finder_installed=1/);

for (const obsolete of [
  new URL('../src/pages/printer-finder-return.astro', import.meta.url),
  new URL('../src/pages/api/printer-detect-match.ts', import.meta.url),
]) {
  try {
    await access(obsolete);
    throw new Error(`Zostal zastaraný V3 súbor: ${obsolete.pathname}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

console.log('OK: JS syntax, V4.6 self-test CLI, helper a odstránenie V3 návratovej cesty.');
