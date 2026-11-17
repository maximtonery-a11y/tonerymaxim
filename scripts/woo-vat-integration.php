<?php
/** Execute actual Woo REST order creation only in a disposable, offline WordPress fixture. */
$root = rtrim((string) getenv('TM_WOO_INTEGRATION_ROOT'), '/');
if (!$root || !is_file($root . '/tm-vat-fixture-marker') || trim(file_get_contents($root . '/tm-vat-fixture-marker')) !== 'isolated-vat-test-only') {
    fwrite(STDERR, "A marked disposable WordPress fixture is required.\n"); exit(2);
}
$_SERVER['HTTP_HOST'] = 'vat.example.invalid'; $_SERVER['REQUEST_URI'] = '/';
require $root . '/wp-load.php';
if (!defined('TM_VAT_FIXTURE') || TM_VAT_FIXTURE !== true || wp_get_environment_type() !== 'local' || get_option('siteurl') !== 'http://vat.example.invalid') {
    throw new RuntimeException('Refusing a non-fixture WordPress installation.');
}
if (!defined('WC_VERSION') || WC_VERSION !== '11.2.1' || !class_exists('TM_Checkout_Pricing')) throw new RuntimeException('Incorrect Woo/checkout fixture version.');
if (!WC_Tax::find_rates(['country' => 'SK', 'state' => '', 'postcode' => '', 'city' => '', 'tax_class' => ''])) {
    WC_Tax::_insert_tax_rate(['tax_rate_country' => 'SK', 'tax_rate_state' => '', 'tax_rate' => '23.0000', 'tax_rate_name' => 'DPH 23%',
        'tax_rate_priority' => 1, 'tax_rate_compound' => 0, 'tax_rate_shipping' => 1, 'tax_rate_order' => 0, 'tax_rate_class' => '']);
}
$admin = get_user_by('login', 'vat_fixture');
$buyer = get_user_by('login', 'vat_buyer');
if (!$buyer) {
    $buyer_id = wp_insert_user(['user_login' => 'vat_buyer', 'user_pass' => wp_generate_password(32), 'user_email' => 'buyer@example.invalid', 'role' => 'customer']);
    if (is_wp_error($buyer_id)) throw new RuntimeException($buyer_id->get_error_message());
    $buyer = get_user_by('id', $buyer_id);
}
$cases = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
if (!is_array($cases) || count($cases) > 1000) throw new RuntimeException('Invalid fixture cases.');
$results = []; $products = [];
foreach ($cases as $case) {
    if (($case['operation'] ?? '') === 'tax_grid') {
        $limit = min(100000, max(0, (int) ($case['limit'] ?? 100000)));
        $parts = new ReflectionMethod('TM_Checkout_Pricing', 'parts');
        $rates = WC_Tax::find_rates(['country' => 'SK', 'state' => '', 'postcode' => '', 'city' => '', 'tax_class' => '']);
        $digest = hash_init('sha256');
        for ($gross = -$limit; $gross <= $limit; $gross++) {
            $row = $parts->invoke(null, $gross, $rates); $tax = (int) round(array_sum($row['taxes']) * 100); $net = (int) round((float) $row['net'] * 100);
            hash_update($digest, "$gross:$net:$tax;");
        }
        $results[] = ['status' => 200, 'data' => ['digest' => hash_final($digest), 'count' => $limit * 2 + 1], 'created_orders' => 0];
        continue;
    }
    $body = $case['body'] ?? []; $method = $case['method'] ?? 'POST'; $path = $case['path'] ?? '/wc/v3/orders';
    if (!preg_match('~^/wc/v3/(orders(?:/\d+)?|tm-pricing-context)$~D', $path)) throw new RuntimeException('Unexpected fixture route.');
    wp_set_current_user(($case['user'] ?? '') === 'anonymous' ? 0 : (($case['user'] ?? '') === 'customer' ? $buyer->ID : $admin->ID));
    $options = [];
    foreach ($case['options'] ?? [] as $key => $value) {
        if (!in_array($key, ['woocommerce_prices_include_tax', 'woocommerce_tax_round_at_subtotal', 'woocommerce_currency', 'woocommerce_price_num_decimals', 'woocommerce_calc_taxes'], true)) throw new RuntimeException('Unexpected fixture option.');
        $options[$key] = get_option($key); update_option($key, $value);
    }
    foreach ($body['line_items'] ?? [] as $index => $line) {
        if (empty($line['product_id']) && empty($line['sku'])) continue;
        $sku = empty($line['product_id']) ? (string) $line['sku'] : '';
        $key = ($sku ? 'sku:' . $sku : (string) $line['product_id']) . ':' . ($case['product_tax_status'] ?? 'taxable') . ':' . ($case['product_tax_class'] ?? '');
        if (!isset($products[$key])) {
            if ($sku && wc_get_product_id_by_sku($sku)) { $products[$key] = wc_get_product_id_by_sku($sku); continue; }
            $product = new WC_Product_Simple(); $product->set_name('Isolated VAT fixture product'); $product->set_status('publish');
            if ($sku) $product->set_sku($sku);
            $product->set_regular_price('10.00'); $product->set_tax_status($case['product_tax_status'] ?? 'taxable');
            $product->set_tax_class($case['product_tax_class'] ?? ''); $product->set_manage_stock(false); $product->set_stock_status('instock');
            $products[$key] = $product->save();
        }
        if (!$sku) $body['line_items'][$index]['product_id'] = $products[$key];
    }
    if (!empty($body['customer_id'])) $body['customer_id'] = $buyer->ID;
    if ($method === 'POST') {
        $body['billing'] = ['first_name' => 'Fixture', 'last_name' => 'Buyer', 'email' => 'buyer@example.invalid', 'country' => 'SK'];
        $body['shipping'] = ['first_name' => 'Fixture', 'last_name' => 'Buyer', 'country' => $body['shipping']['country'] ?? 'SK'];
    }
    $request = new WP_REST_Request($method, $path);
    $request->set_header('content-type', 'application/json');
    foreach ($case['headers'] ?? ['x-tonerymaxim-origin' => 'astro'] as $key => $value) $request->set_header($key, $value);
    $request->set_body_params($body);
    global $wpdb;
    $before = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type='shop_order'");
    $response = rest_do_request($request); $data = $response->get_data();
    $after = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type='shop_order'");
    $results[] = ['status' => $response->get_status(), 'data' => $data, 'created_orders' => $after - $before];
    foreach ($options as $key => $value) update_option($key, $value);
}
echo wp_json_encode(['woocommerce' => WC_VERSION, 'php' => PHP_VERSION, 'results' => $results, 'intercepted_emails' => $GLOBALS['tm_vat_intercepted_emails'] ?? 0], JSON_THROW_ON_ERROR);
