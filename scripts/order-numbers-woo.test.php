<?php
/** Real Woo reads and rendered screens in the disposable offline checkout fixture. */
use Automattic\WooCommerce\Internal\DataStores\Orders\DataSynchronizer;
use Automattic\WooCommerce\Utilities\OrderUtil;

$root = (string) getenv('TM_WOO_INTEGRATION_ROOT');
if (!is_file($root . '/tm-vat-fixture-marker') || trim(file_get_contents($root . '/tm-vat-fixture-marker')) !== 'isolated-vat-test-only') exit(2);
$_SERVER['HTTP_HOST'] = 'vat.example.invalid';
$_SERVER['REQUEST_URI'] = '/';
require $root . '/wp-load.php';
if (!defined('TM_VAT_FIXTURE') || !TM_VAT_FIXTURE || wp_get_environment_type() !== 'local' ||
    get_option('siteurl') !== 'http://vat.example.invalid' || !WP_HTTP_BLOCK_EXTERNAL) throw new RuntimeException('Offline fixture required');
$mode = $argv[1] ?? '';
if ($mode === 'enable-hpos') {
    wc_get_container()->get(DataSynchronizer::class)->create_database_tables();
    update_option('woocommerce_custom_orders_table_enabled', 'yes');
    exit;
}
function check_number($ok, $message) { if (!$ok) throw new RuntimeException($message); }
check_number(in_array($mode, ['classic', 'hpos'], true) && OrderUtil::custom_orders_table_usage_is_enabled() === ($mode === 'hpos'), 'Wrong Woo storage mode');
$plugins = dirname(__DIR__) . '/wordpress-plugin';
require $plugins . '/tonerymaxim-customer-administration/tonerymaxim-customer-administration.php';
require $plugins . '/tonerymaxim-reklamacie/tonerymaxim-reklamacie.php';
TM_Customer_Administration_V1::init();
wp_set_current_user(get_user_by('login', 'vat_fixture')->ID);
$public = $mode === 'classic' ? '300936' : '300937';
$legacy = 'TM-2025/' . $public;
$buyer = wp_create_user('num_' . $mode, wp_generate_password(32), $mode . '@example.invalid');
check_number(is_int($buyer), 'Create test buyer');
function fixture_order(int $buyer, array $entries, string $source = 'tonerymaxim'): WC_Order {
    $order = wc_create_order(['customer_id' => $buyer]);
    $order->set_billing_email('buyer@example.invalid');
    $order->set_payment_method('gopay');
    $order->set_total('37.68');
    $order->update_meta_data('source', $source);
    $order->update_meta_data('gopay_payment_id', '89123456');
    $order->update_meta_data('dpd_pickup_point_id', 'FIXTURE-BOX');
    foreach ($entries as [$key, $value]) $order->add_meta_data($key, $value);
    $order->save();
    return wc_get_order($order->get_id());
}
function screen_html(callable $screen, array $query): string {
    $_GET = $query;
    ob_start();
    try { $screen(); return (string) ob_get_contents(); }
    finally { ob_end_clean(); $_GET = []; }
}
$order = fixture_order($buyer, [['tm_order_number', '<bad>'], ['tm_order_number', $public], ['gopay_order_number', '999998']]);
$gateway = fixture_order($buyer, [['gopay_order_number', '000' . $public]]);
$snapshot = fixture_order($buyer, [['tm_order_snapshot', wp_json_encode(['orderNumber' => $legacy])]]);
$array = fixture_order($buyer, [['tm_order_snapshot', ['orderNumber' => 'TM-' . $public]]]);
$missing = fixture_order($buyer, [['tm_order_snapshot', '{']]);
$foreign = fixture_order(0, [], 'other-shop');
$id = $order->get_id();
foreach ([[$order, $public], [$gateway, '000' . $public], [$snapshot, $legacy], [$array, 'TM-' . $public], [$missing, '']] as [$fixture, $expected]) {
    check_number(TM_Order_Numbers::number($fixture) === $expected, 'Source precedence or legacy format');
    check_number($fixture->get_order_number() === (string)$fixture->get_id(), 'Woo reference outside the order screen');
    if ($expected !== '') check_number(in_array($fixture->get_id(), array_map(fn($o) => $o->get_id(), TM_Order_Numbers::find($expected)), true), 'Exact lookup ' . $expected);
}
check_number(TM_Order_Numbers::find('999998') === [], 'Stale secondary reference must not match');
$before = wc_get_order($id)->get_data();
// Make the snapshot match fall on the next query page among unrelated references.
for ($i = 0; $i < 51; $i++) fixture_order(0, [['tm_order_snapshot', wp_json_encode(['orderNumber' => '999991', 'note' => $public])]]);
check_number(TM_Order_Numbers::find($legacy)[0]->get_id() === $snapshot->get_id(), 'Snapshot search beyond first page');
$recent = static function ($args) { if (($args['limit'] ?? null) === 500) $args['limit'] = 2; return $args; };
add_filter('woocommerce_order_query_args', $recent);
$list = screen_html([TM_Customer_Administration_V1::class, 'render_orders_page'], ['s' => '#' . $public]);
remove_filter('woocommerce_order_query_args', $recent);
check_number(str_contains($list, '>#' . $public . '</a>') && !str_contains($list, '>#' . $id . '</a>'), 'TM order list');
check_number(str_contains($list, 'order_id=' . $id) && str_contains($list, 'name="order_id" value="' . $id . '"'), 'Detail links and status forms use Woo ID');
foreach ([false, true] as $editing) {
    $html = screen_html([TM_Customer_Administration_V1::class, 'render_orders_page'], ['order_id' => $id, 'tm_edit' => $editing]);
    check_number(str_contains($html, '#' . $public . '</h1>') && !str_contains($html, 'Interné Woo ID'), 'Detail and editor labels');
}
$missing_html = screen_html([TM_Customer_Administration_V1::class, 'render_orders_page'], ['order_id' => $missing->get_id()]);
check_number(str_contains($missing_html, 'TM objednávka</h1>'), 'Neutral label when metadata is absent');
$profile = screen_html([TM_Customer_Administration_V1::class, 'render_page'], ['customer_id' => $buyer, 'tab' => 'orders']);
check_number(str_contains($profile, '>#' . $legacy . '</a>') && str_contains($profile, '>Objednávka</a>'), 'Registered buyer order history');
update_user_meta($buyer, 'tm_loyalty_history', wp_json_encode([['title' => 'Použitá zľava pri objednávke #' . $id, 'orderId' => $id, 'points' => -20]], JSON_UNESCAPED_UNICODE));
$loyalty = screen_html([TM_Customer_Administration_V1::class, 'render_page'], ['customer_id' => $buyer, 'tab' => 'loyalty']);
check_number(str_contains($loyalty, '>' . $public . '</td>') && !str_contains($loyalty, 'objednávke #' . $id), 'Existing point history');
$invoices = screen_html([TM_Manual_Invoices::class, 'admin_page'], ['invoice_search' => '#' . $legacy]);
check_number(str_contains($invoices, '>#' . $legacy . '</td>') && str_contains($invoices, 'order_id=' . $snapshot->get_id()), 'Invoice search and association');
$claim = wp_insert_post(['post_type' => 'tm_reclamation', 'post_status' => 'publish', 'post_title' => 'Fixture claim']);
update_post_meta($claim, 'tm_order_id', $id);
update_post_meta($claim, 'tm_order_number', (string)$id);
update_post_meta($claim, 'tm_customer_email', 'buyer@example.invalid');
$messages = [];
add_filter('pre_wp_mail', static function ($result, $mail) use (&$messages) { $messages[] = $mail; return true; }, 99, 2);
$notify = new ReflectionMethod(Tonerymaxim_Reklamacie_Plugin::class, 'maybe_notify_customer');
$notify->invoke(null, $claim, 'received', 'checking', '');
check_number(count($messages) === 1 && str_contains($messages[0]['message'], 'Objednávka: ' . $public . "\n"), 'Historical claim status email');
check_number(wp_json_encode(wc_get_order($id)->get_data()) === wp_json_encode($before), 'Display changed stored order data');
$preview = apply_filters('woocommerce_admin_order_preview_get_order_details', ['order_number' => (string)$id, 'data' => ['id' => $id]], $order);
check_number($preview['order_number'] === $public && $preview['data']['id'] === $id, 'Native quick preview');
remove_all_actions('admin_head');
$_SERVER['REQUEST_METHOD'] = 'POST';
TM_Customer_Administration_V1::native_order_screen((object)['id' => 'woocommerce_page_wc-orders']);
check_number($order->get_order_number() === (string)$id, 'Native Woo writes keep internal numbering');
$_SERVER['REQUEST_METHOD'] = 'GET';
TM_Customer_Administration_V1::native_order_screen((object)['id' => 'dashboard']);
check_number($order->get_order_number() === (string)$id, 'Unrelated screens preserve Woo numbers');
TM_Customer_Administration_V1::native_order_screen((object)['id' => $mode === 'classic' ? 'edit-shop_order' : 'woocommerce_page_wc-orders']);
check_number($order->get_order_number() === (string)$id, 'Before rendering, Woo handlers keep the stored reference');
do_action('admin_head');
check_number($order->get_order_number() === $public && $order->get_id() === $id && $missing->get_order_number() === '—', 'Native Woo screen display');
check_number($foreign->get_order_number() === (string)$foreign->get_id(), 'Other shop keeps native number');
echo "PASS $mode: Woo reads, admin search, detail, editor, loyalty, invoices and claim mail; stored order data identical.\n";
