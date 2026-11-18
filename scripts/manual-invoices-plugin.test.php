<?php
// Real invoice module, real AES-GCM and real isolated files; no network/order writes/mail.
define('ABSPATH', __DIR__ . '/');
class WP_Error { public function __construct(public string $code, public string $message, public array $data = []) {} }
class WP_REST_Request { public function __construct(public array $params = []) {} public function get_param($key) { return $this->params[$key] ?? null; } }
class WP_REST_Response { public function __construct(public array $data, public int $status = 200, public array $headers = []) {} }
class WP_REST_Server { const READABLE = 'GET'; }
class WP_Post { public function __construct(public int $ID, public string $post_type, public string $post_status, public string $post_content, public string $post_title) {} }
class WP_Query {
    public array $posts; public int $max_num_pages;
    public function __construct($args) {
        $all = fixture_posts($args); $per_page = $args['posts_per_page'] ?? 20;
        $this->max_num_pages = (int) ceil(count($all) / $per_page);
        $this->posts = array_slice($all, (($args['paged'] ?? 1) - 1) * $per_page, $per_page);
    }
}
class WC_Order {
    public function __construct(public int $ID, public int $customer_id, public string $source = 'tonerymaxim') {}
    public array $payment_shipping = ['payment_method'=>'gopay','state'=>'PAID','shipping'=>'dpd_box','total'=>'29.90'];
    public function get_id() { return $this->ID; }
    public function get_customer_id() { return $this->customer_id; }
    public function get_meta($key, $single = true) {
        $value = $key === 'source' ? $this->source : ($key === 'tm_order_number' ? '301092' : '');
        return $single ? $value : ($value === '' ? [] : [(object)['value' => $value]]);
    }
    public function get_created_via() { return $this->source; }
    public function get_order_number() { return (string) $this->ID; }
    public function get_formatted_billing_full_name() { return 'Fixture zákazník'; }
    public function get_billing_email() { return 'fixture@example.invalid'; }
    public function save() { throw new RuntimeException('Invoice documents must never save an order'); }
    public function update_meta_data(...$args) { throw new RuntimeException('Invoice documents must never change an order'); }
}
class FixtureDatabase {
    public string $prefix = 'wp_'; public array $queries = [];
    public function prepare($query, $value) { return str_replace('%s', "'" . $value . "'", $query); }
    public function get_var($query) {
        $this->queries[] = $query;
        if (str_contains($query, 'GET_LOCK')) return $GLOBALS['lock_available'] ? 1 : 0;
        if (str_contains($query, 'RELEASE_LOCK')) return 1;
        throw new RuntimeException('Unexpected database write');
    }
}
$allowed = true; $user_id = 1; $posts = []; $meta = []; $options = []; $hooks = []; $routes = [];
$lock_available = true; $insert_failure = false; $uuid = 0; $checks = 0;
$wpdb = new FixtureDatabase();
$orders = [101=>new WC_Order(101, 7), 102=>new WC_Order(102, 0), 103=>new WC_Order(103, 7, 'other-shop')];
$original_orders = serialize($orders);
$temporary = __DIR__ . '/../.tm-cache/invoices-php-' . bin2hex(random_bytes(5));
mkdir($temporary, 0700, true);
function check($condition, $message) { $GLOBALS['checks']++; if (!$condition) throw new RuntimeException('FAIL: ' . $message); echo 'PASS: ' . $message . "\n"; }
function expect_error($callback, $pattern) { try { $callback(); } catch (RuntimeException $error) { check((bool) preg_match($pattern, $error->getMessage()), 'Refused: ' . $pattern); return; } throw new RuntimeException('Expected failure ' . $pattern); }
function add_action(...$args) { $GLOBALS['hooks'][] = $args; }
function add_filter(...$args) { $GLOBALS['hooks'][] = $args; }
function register_rest_route($ns, $route, $options) { $GLOBALS['routes'][$route] = $options; }
function register_post_type($type, $options) { $GLOBALS['post_type'] = $options; }
function current_user_can($cap) { return $GLOBALS['allowed']; }
function get_current_user_id() { return $GLOBALS['user_id']; }
function get_user_by($field, $id) { return in_array((int)$id, [1,7,8], true) ? (object)['ID'=>(int)$id] : false; }
function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function add_option($key, $value, $deprecated = '', $autoload = false) { if (isset($GLOBALS['options'][$key])) return false; check($autoload === false, 'The archive encryption key is not autoloaded'); $GLOBALS['options'][$key] = $value; return true; }
function wp_upload_dir(...$args) { return ['basedir'=>$GLOBALS['temporary'], 'error'=>false]; }
function wp_mkdir_p($path) { return is_dir($path) || mkdir($path, 0700, true); }
function sanitize_text_field($value) { return trim(strip_tags((string) $value)); }
function sanitize_file_name($value) { return preg_replace('/[^a-zA-Z0-9_.-]/', '', $value); }
function remove_accents($value) { return $value; }
function wp_json_encode($value) { return json_encode($value); }
function wp_slash($value) { return addslashes($value); }
function wp_unslash($value) { return is_array($value) ? array_map('wp_unslash', $value) : stripslashes($value); }
function wp_generate_uuid4() { return 'b871932e-5bb4-4d77-a0f6-' . str_pad(dechex(++$GLOBALS['uuid']), 12, '0', STR_PAD_LEFT); }
function current_time($format) { return $format === 'Y-m-d' ? '2026-11-17' : '2026-11-17T14:00:00+01:00'; }
function wc_get_order($id) { return $GLOBALS['orders'][(int) $id] ?? false; }
function get_post($id) { return $GLOBALS['posts'][$id] ?? null; }
function get_post_meta($id, $key, $single = true) { return (string) ($GLOBALS['meta'][$id][$key] ?? ''); }
function update_post_meta($id, $key, $value) { if (!isset($GLOBALS['posts'][$id])) throw new RuntimeException('Unrelated metadata write'); $GLOBALS['meta'][$id][$key] = $value; return 1; }
function wp_insert_post($input, $errors = false) {
    if ($GLOBALS['insert_failure']) return new WP_Error('fixture_failure', 'private internal database error');
    check($input['post_type'] === 'tm_invoice_document' && $input['post_status'] === 'private', 'Only a private invoice archive record is created');
    $id = 70000 + count($GLOBALS['posts']);
    $GLOBALS['posts'][$id] = new WP_Post($id, $input['post_type'], $input['post_status'], stripslashes($input['post_content']), stripslashes($input['post_title']));
    $GLOBALS['meta'][$id] = $input['meta_input'];
    return $id;
}
function is_wp_error($value) { return $value instanceof WP_Error; }
function fixture_posts($args) {
    $found = [];
    foreach ($GLOBALS['posts'] as $id=>$post) {
        if ($post->post_type !== $args['post_type'] || $post->post_status !== $args['post_status'] || in_array($id, $args['post__not_in'] ?? [], true)) continue;
        if (isset($args['meta_key']) && get_post_meta($id, $args['meta_key']) !== (string) $args['meta_value']) continue;
        foreach ($args['meta_query'] ?? [] as $rule) if (is_array($rule) && get_post_meta($id, $rule['key']) !== (string) $rule['value']) continue 2;
        $found[] = $id;
    }
    if (($args['order'] ?? '') === 'DESC') rsort($found);
    return $found;
}
function get_posts($args) { return array_slice(fixture_posts($args), 0, $args['posts_per_page'] ?? 100); }
function wp_mail(...$args) { throw new RuntimeException('Manual invoice upload must not send emails'); }
function wp_die($message, $title = '', $args = []) { throw new RuntimeException((string) ($args['response'] ?? 500) . ': ' . $message); }
function check_admin_referer($nonce) { if (($_POST['_wpnonce'] ?? '') !== 'valid-fixture') throw new RuntimeException('Invalid CSRF nonce'); return true; }
function absint($value) { return abs((int) $value); }
function admin_url($path) { return 'https://woo.example.invalid/wp-admin/' . $path; }
function add_query_arg($args, $url) { return $url . '?' . http_build_query($args); }
function wp_nonce_url($url, $action) { return $url . '&_wpnonce=fixture'; }
function wp_nonce_field($action) { echo '<input name="_wpnonce" value="fixture">'; }
function esc_html($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
function esc_attr($value) { return esc_html($value); }
function esc_url($value) { return esc_attr($value); }
require __DIR__ . '/../wordpress-plugin/tonerymaxim-customer-administration/manual-invoices.php';

$pdf = "%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n";
$xml = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>2026-001</ID></Invoice>';
$fields = ['number'=>'2026-001', 'date'=>'2026-11-17', 'type'=>'invoice'];
function file_request($id, $customer = 7, $format = 'pdf') { return new WP_REST_Request(['document_id'=>$id, 'customer_id'=>$customer, 'format'=>$format]); }
try {
    TM_Manual_Invoices::init(); TM_Manual_Invoices::register_post_type(); TM_Manual_Invoices::register_routes();
    check(!$post_type['public'] && !$post_type['show_in_rest'] && !$post_type['show_ui'], 'Documents are not public WordPress posts or media');
    foreach ($routes as $route) check($route['permission_callback'] === ['TM_Manual_Invoices', 'permissions'] && $route['methods'] === 'GET', 'Every invoice REST route requires shop permission and is read-only');
    $allowed = false; $user_id = 0;
    check(TM_Manual_Invoices::permissions()->data['status'] === 401, 'Anonymous REST requests are refused');
    $user_id = 8; check(TM_Manual_Invoices::permissions()->data['status'] === 403, 'Non-manager accounts are refused');
    expect_error(fn()=>TM_Manual_Invoices::create_document(101, $fields, ['pdf'=>$pdf]), '/Prístup/');
    expect_error(fn()=>TM_Manual_Invoices::handle_upload(), '/403/');
    $allowed = true; $user_id = 1;
    $_SERVER['REQUEST_METHOD'] = 'POST'; $_POST = ['order_id'=>101, '_wpnonce'=>'invalid'];
    expect_error(fn()=>TM_Manual_Invoices::handle_upload(), '/CSRF/');
    $wp = (object) ['query_vars'=>['rest_route'=>'/tonerymaxim/v1/invoices']];
    check(!TM_Manual_Invoices::include_in_wc_auth(false), 'Woo authentication waits until actual REST dispatch');
    define('REST_REQUEST', true);
    check(TM_Manual_Invoices::include_in_wc_auth(false), 'Only invoice endpoints gain existing Woo authentication');
    foreach (['/wp/v2/users', '/tonerymaxim/v1/invoices-other', '/wp-admin/admin.php'] as $route) {
        $wp->query_vars['rest_route'] = $route;
        check(!TM_Manual_Invoices::include_in_wc_auth(false) && TM_Manual_Invoices::include_in_wc_auth(true), 'Unrelated REST and existing Woo authentication decisions are preserved');
    }
    $record = TM_Manual_Invoices::create_document(101, $fields, ['pdf'=>$pdf, 'xml'=>$xml]);
    check($record['active'] && $record['customer_id'] === 7, 'A document is linked to the real Woo order owner');
    check(count($posts) === 1 && strlen($options[TM_Manual_Invoices::KEY_OPTION]) === 64, 'Archive metadata and one persistent encryption key are saved');
    $cipher_path = $temporary . '/tm-private-invoices/' . $record['id'] . '.pdf.enc';
    $cipher = file_get_contents($cipher_path);
    check(str_starts_with($cipher, 'TMINV1') && !str_contains($cipher, '%PDF') && !str_contains($posts[$record['post_id']]->post_content, base64_encode($pdf)), 'PDF bytes are encrypted on disk and are not stored as public attachment content');
    $again = TM_Manual_Invoices::create_document(101, $fields, ['pdf'=>$pdf, 'xml'=>$xml]);
    check($again['id'] === $record['id'] && count($posts) === 1, 'A repeated identical upload creates no duplicate');
    expect_error(fn()=>TM_Manual_Invoices::create_document(101, $fields, ['pdf'=>str_replace('1 0', '2 0', $pdf)]), '/už existuje/');
    $list = TM_Manual_Invoices::rest_list(new WP_REST_Request(['customer_id'=>7]));
    check(count($list->data['documents']) === 1 && $list->data['documents'][0]['number'] === '2026-001', 'The owner receives the uploaded invoice metadata');
    check(!str_contains(json_encode($list->data), 'storage_key') && !str_contains(json_encode($list->data), '.enc'), 'Customer metadata contains no encryption key or storage location');
    check(count(TM_Manual_Invoices::rest_list(new WP_REST_Request(['customer_id'=>8]))->data['documents']) === 0, 'Another customer receives no invoice metadata');
    check(TM_Manual_Invoices::rest_list(new WP_REST_Request(['customer_id'=>0]))->status === 400, 'Guest customer IDs cannot list account invoices');
    $download = TM_Manual_Invoices::rest_file(file_request($record['id']));
    check($download->status === 200 && base64_decode($download->data['file']['content_base64']) === $pdf, 'Authenticated PDF download decrypts the exact original file');
    check($download->headers['Cache-Control'] === 'private, no-store', 'The WordPress file response cannot be publicly cached');
    $xml_file = TM_Manual_Invoices::rest_file(file_request($record['id'], 7, 'xml'));
    check(base64_decode($xml_file->data['file']['content_base64']) === $xml, 'XML returns the original bytes');
    check(TM_Manual_Invoices::rest_file(file_request($record['id'], 8))->status === 404, 'Other accounts cannot download a guessed document ID');
    check(TM_Manual_Invoices::rest_file(file_request('../secret'))->status === 404, 'Traversal attempts cannot select a file');
    check(TM_Manual_Invoices::rest_file(file_request($record['id'], 7, 'php'))->status === 404, 'Executable formats cannot be downloaded');
    $orders[101]->customer_id = 8;
    check(TM_Manual_Invoices::rest_file(file_request($record['id']))->status === 404, 'Ownership is rechecked against the current Woo order on every download');
    $orders[101]->customer_id = 7;
    TM_Manual_Invoices::set_visibility($record['id'], false);
    check(TM_Manual_Invoices::rest_file(file_request($record['id']))->status === 404 && is_file($cipher_path), 'Hiding revokes access while preserving the original archive file');
    TM_Manual_Invoices::set_visibility($record['id'], true);
    check(TM_Manual_Invoices::rest_file(file_request($record['id']))->status === 200, 'Hidden documents can be restored');
    file_put_contents($cipher_path, substr($cipher, 0, -1) . chr(ord(substr($cipher, -1)) ^ 1));
    check(TM_Manual_Invoices::rest_file(file_request($record['id']))->status === 503, 'Corrupted ciphertext is refused without leaking plaintext');
    file_put_contents($cipher_path, $cipher);
    expect_error(fn()=>TM_Manual_Invoices::create_document(999, $fields, ['pdf'=>$pdf]), '/nebola nájdená/');
    expect_error(fn()=>TM_Manual_Invoices::create_document(103, $fields, ['pdf'=>$pdf]), '/nebola nájdená/');
    expect_error(fn()=>TM_Manual_Invoices::create_document(101, $fields, []), '/Priložte PDF/');
    expect_error(fn()=>TM_Manual_Invoices::create_document(101, $fields + [], ['pdf'=>'not a pdf']), '/skutočný PDF/');
    expect_error(fn()=>TM_Manual_Invoices::create_document(101, array_merge($fields, ['date'=>'2026-02-30']), ['pdf'=>$pdf]), '/správny dátum/');
    expect_error(fn()=>TM_Manual_Invoices::validate_file(str_repeat('a', 8388609), 'pdf'), '/najviac/');
    foreach (['<broken>', '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>', '<OBERON><Invoice/></OBERON>', '<?php echo "script"; ?>'] as $bad_xml) expect_error(fn()=>TM_Manual_Invoices::validate_file($bad_xml, 'xml'), '/XML/');
    $before_files = glob($temporary . '/tm-private-invoices/*.enc');
    $insert_failure = true;
    expect_error(fn()=>TM_Manual_Invoices::create_document(101, array_merge($fields, ['number'=>'FAIL']), ['pdf'=>$pdf]), '/zaevidovať/');
    check(glob($temporary . '/tm-private-invoices/*.enc') === $before_files && str_contains(end($wpdb->queries), 'RELEASE_LOCK'), 'Failed database creation cleans only uncommitted files and releases its lock');
    $insert_failure = false; $lock_available = false;
    expect_error(fn()=>TM_Manual_Invoices::create_document(101, array_merge($fields, ['number'=>'BUSY']), ['pdf'=>$pdf]), '/práve spracováva/');
    $lock_available = true;
    expect_error(fn()=>TM_Manual_Invoices::create_document(102, array_merge($fields, ['number'=>'GUEST']), ['pdf'=>$pdf]), '/iba k objednávke registrovaného/');
    $_GET=['order_id'=>102]; ob_start(); TM_Manual_Invoices::admin_page(); $guest_html=ob_get_clean();
    check(!str_contains($guest_html, 'name="pdf"') && str_contains($guest_html, 'nenahrávajte'), 'Guest order UI has no upload form, even through a direct URL');
    $orders[101]->customer_id=999;
    check(!TM_Customer_Accounts::registered($orders[101]), 'A missing/deleted Woo user is not a registered customer');
    expect_error(fn()=>TM_Manual_Invoices::create_document(101, array_merge($fields, ['number'=>'DELETED']), ['pdf'=>$pdf]), '/registrovaného/');
    $orders[101]->customer_id=7;
    TM_Manual_Invoices::set_visibility($record['id'], false);
    $revision = TM_Manual_Invoices::create_document(101, $fields, ['pdf'=>str_replace('1 0', '2 0', $pdf)]);
    expect_error(fn()=>TM_Manual_Invoices::set_visibility($record['id'], true), '/inú verziu/');
    check(TM_Manual_Invoices::rest_file(file_request($revision['id']))->status === 200 && is_file($cipher_path), 'A replacement preserves the hidden original and exposes only the new version');
    $_GET = ['order_id'=>101];
    ob_start(); TM_Manual_Invoices::admin_page(); $html = ob_get_clean();
    check(str_contains($html, 'enctype="multipart/form-data"') && str_contains($html, 'name="pdf"') && str_contains($html, 'name="xml"') && str_contains($html, 'Skryť zákazníkovi'), 'The real Woo upload form and reversible visibility controls render');
    check(serialize($orders) === $original_orders, 'All invoice operations leave payments, shipping, totals and order state unchanged');
    echo 'Invoice plugin checks: ' . $checks . "; failures: 0\n";
} finally {
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($temporary, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($iterator as $file) { if ($file->isDir()) rmdir($file->getPathname()); else unlink($file->getPathname()); }
    rmdir($temporary);
}
