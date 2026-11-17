// Disposable, offline-after-download WordPress/Woo integration fixture. Never points at production.
import { mkdtemp, mkdir, writeFile, symlink, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
const php = process.env.TM_PHP_BIN || 'php';
const root = await mkdtemp(join(tmpdir(), 'tm-vat-wordpress-'));
const wp = join(root, 'wordpress');
const project = resolve(new URL('..', import.meta.url).pathname);
const run = (command, args, options = {}) => new Promise((yes, no) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  child.once('error', no); child.once('exit', code => code === 0 ? yes() : no(new Error(`${command} exited ${code}`)));
});
let success = false;
try {
  await run(php, ['-r', "if(!extension_loaded('pdo_sqlite')){fwrite(STDERR,'pdo_sqlite is required for the disposable VAT fixture.\\n');exit(1);}"]);
  for (const [name, url] of [
    ['wordpress', 'https://wordpress.org/wordpress-7.1.4.zip'],
    ['woocommerce', 'https://downloads.wordpress.org/plugin/woocommerce.11.2.1.zip'],
    ['sqlite', 'https://downloads.wordpress.org/plugin/sqlite-database-integration.3.1.3.zip'],
  ]) {
    const file = join(root, name + '.zip');
    await run('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '120', '--output', file, url]);
    await run('unzip', ['-q', file, '-d', root]);
  }
  const plugins = join(wp, 'wp-content/plugins');
  for (const name of ['woocommerce', 'sqlite-database-integration']) await symlink(join(root, name), join(plugins, name), 'dir');
  await copyFile(join(root, 'sqlite-database-integration/db.copy'), join(wp, 'wp-content/db.php'));
  await writeFile(join(wp, 'tm-vat-fixture-marker'), 'isolated-vat-test-only');
  await writeFile(join(wp, 'wp-config.php'), `<?php
define('TM_VAT_FIXTURE',true);define('DB_NAME','fixture');define('DB_USER','fixture');define('DB_PASSWORD','fixture');define('DB_HOST','localhost');define('DB_CHARSET','utf8mb4');define('DB_COLLATE','');
define('WP_HOME','http://vat.example.invalid');define('WP_SITEURL','http://vat.example.invalid');
define('AUTH_KEY','vat-fixture-only');define('SECURE_AUTH_KEY','vat-fixture-secure');define('LOGGED_IN_KEY','vat-fixture-loggedin');define('NONCE_KEY','vat-fixture-nonce');
define('DISABLE_WP_CRON',true);define('WP_HTTP_BLOCK_EXTERNAL',true);define('AUTOMATIC_UPDATER_DISABLED',true);define('WP_ENVIRONMENT_TYPE','local');define('WP_DEBUG',false);
$table_prefix='vat_';if(!defined('ABSPATH'))define('ABSPATH',__DIR__.'/');require_once ABSPATH.'wp-settings.php';
`);
  await mkdir(join(wp, 'wp-content/mu-plugins'), { recursive: true });
  await writeFile(join(wp, 'wp-content/mu-plugins/vat-fixture.php'), `<?php
add_filter('pre_http_request',static function(){return new WP_Error('blocked','VAT fixture blocks external HTTP');});
add_filter('pre_wp_mail',static function(){$GLOBALS['tm_vat_intercepted_emails']=($GLOBALS['tm_vat_intercepted_emails']??0)+1;return true;});
require ${JSON.stringify(join(project, 'wordpress-plugin/tonerymaxim-customer-administration/checkout-pricing.php'))};
`);
  const installer = join(root, 'install.php');
  await writeFile(installer, `<?php
define('WP_INSTALLING',true);$_SERVER['HTTP_HOST']='vat.example.invalid';$_SERVER['REQUEST_URI']='/';
require ${JSON.stringify(join(wp, 'wp-load.php'))};require_once ABSPATH.'wp-admin/includes/upgrade.php';
wp_install('Isolated VAT test','vat_fixture','fixture@example.invalid',true,'',wp_generate_password(40));
require_once ABSPATH.'wp-admin/includes/plugin.php';$result=activate_plugin('woocommerce/woocommerce.php');if(is_wp_error($result))throw new RuntimeException($result->get_error_message());
foreach(['woocommerce_calc_taxes'=>'yes','woocommerce_prices_include_tax'=>'yes','woocommerce_tax_round_at_subtotal'=>'no','woocommerce_default_country'=>'SK','woocommerce_currency'=>'EUR','woocommerce_price_num_decimals'=>'2','woocommerce_custom_orders_table_enabled'=>'no'] as $key=>$value)update_option($key,$value);
echo "Disposable WordPress 7.1.4 and Woo 11.2.1 installed; HTTP and email are blocked.\\n";
`);
  await run(php, [installer]);
  const env = { ...process.env, TM_PHP_BIN: php, TM_WOO_REFERENCE_DIR: join(root, 'woocommerce/includes'), TM_WOO_INTEGRATION_ROOT: wp };
  if (process.argv.includes('--run')) {
    await run(process.execPath, ['--experimental-strip-types', '--test', 'scripts/vat-price-integrity.test.ts'], { cwd: project, env });
  } else {
    await mkdir(join(project, '.tm-cache'), { recursive: true });
    await writeFile(join(project, '.tm-cache/vat-fixture-path.txt'), wp);
    console.log(`Fixture ready: ${wp}`);
  }
  success = true;
} finally {
  if (process.argv.includes('--run') && success && !process.argv.includes('--keep')) await rm(root, { recursive: true, force: true });
  else console.log(`Disposable fixture retained for inspection: ${root}`);
}
