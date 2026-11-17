<?php
// Execute the real claims plugin with isolated WordPress/Woo adapters. No HTTP or mail.
define('ABSPATH', __DIR__);
class WP_Error {
    public function __construct(public string $code, public string $message, public array $data = []) {}
    public function get_error_message() { return $this->message; }
}
class WP_Post {
    public int $ID; public string $post_type; public string $post_status; public string $post_title; public string $post_content;
    public function __construct(array $data) { foreach ($data as $key => $value) $this->$key = $value; }
}
class WP_REST_Response {
    public function __construct(public array $data, public int $status = 200) {}
    public function get_data() { return $this->data; }
    public function get_status() { return $this->status; }
}
class WP_REST_Request implements ArrayAccess {
    public function __construct(public array $params = []) {}
    public function get_param($key) { return $this->params[$key] ?? null; }
    public function get_json_params() { return $this->params; }
    public function offsetExists(mixed $offset): bool { return isset($this->params[$offset]); }
    public function offsetGet(mixed $offset): mixed { return $this->get_param($offset); }
    public function offsetSet(mixed $offset, mixed $value): void { $this->params[$offset] = $value; }
    public function offsetUnset(mixed $offset): void { unset($this->params[$offset]); }
}
class WP_REST_Server { const READABLE = 'GET'; const CREATABLE = 'POST'; const EDITABLE = 'POST,PUT,PATCH'; }
class FixtureDatabase {
    public string $prefix = 'wp_'; public array $queries = [];
    public function prepare($query, $value) { return str_replace('%s', "'" . $value . "'", $query); }
    public function get_var($query) {
        $this->queries[] = $query;
        if (str_contains($query, 'GET_LOCK')) return $GLOBALS['lock_available'] ? 1 : 0;
        if (str_contains($query, 'RELEASE_LOCK')) return 1;
        throw new Exception('Claims must not issue arbitrary database statements');
    }
}
class FixtureItem {
    public function get_product_id() { return 201; }
    public function get_variation_id() { return 0; }
    public function get_name() { return 'Canon CRG-731 čierny kompatibilný toner'; }
    public function get_product() { return new class { public function get_sku() { return 'C731BK'; } }; }
}
class FixtureOrder {
    public function __construct(public int $customer_id = 0) {}
    public function get_customer_id() { return $this->customer_id; }
    public function get_billing_email() { return 'customer@example.invalid'; }
    public function get_id() { return 101; }
    public function get_order_number() { return '101'; }
    public function get_meta($key) { return $key === 'tm_order_number' ? '301092' : ''; }
    public function get_items() { return [new FixtureItem()]; }
}
$posts = []; $meta = []; $routes = []; $hooks = []; $sent = [];
$current_id = 7; $manager = true; $lock_available = true; $insert_failure = false; $wpdb = new FixtureDatabase(); $order = new FixtureOrder();
function add_action(...$args) { $GLOBALS['hooks'][] = $args; }
function add_filter(...$args) { $GLOBALS['hooks'][] = $args; }
function register_rest_route($namespace, $route, $options) { $GLOBALS['routes'][$route] = $options; }
function register_post_type($name, $options) { $GLOBALS['post_type_options'] = $options; }
function current_user_can($cap, ...$args) { return $cap === 'edit_posts' || $GLOBALS['manager']; }
function get_current_user_id() { return $GLOBALS['current_id']; }
function rest_url($path = '') { return 'https://woo.example.invalid/wp-json/' . $path; }
function wp_parse_url($url, $component = -1) { return parse_url($url, $component); }
function wp_unslash($value) { return stripslashes($value); }
function wp_slash($value) { return addslashes($value); }
function sanitize_text_field($value) { return trim(preg_replace('/\s+/', ' ', strip_tags((string) $value))); }
function sanitize_textarea_field($value) { return trim(strip_tags((string) $value)); }
function sanitize_email($value) { return filter_var($value, FILTER_VALIDATE_EMAIL) ? $value : ''; }
function sanitize_key($value) { return strtolower(preg_replace('/[^a-zA-Z0-9_-]/', '', $value)); }
function wp_strip_all_tags($value) { return trim(strip_tags($value)); }
if (!function_exists('mb_strlen')) { function mb_strlen($value) { return preg_match_all('/./us', $value); } }
function wp_date($format) { return gmdate($format); }
function wp_rand($min, $max) { return random_int($min, $max); }
function is_wp_error($value) { return $value instanceof WP_Error; }
function wc_get_order($id) { return $id === 101 ? $GLOBALS['order'] : false; }
function get_userdata($id) { return $id === 7 ? (object) ['user_email' => 'updated@example.invalid'] : false; }
function wp_insert_post($input, $error = false) {
    if ($GLOBALS['insert_failure']) return new WP_Error('fixture_insert_failure', 'Simulated database failure');
    if ($input['post_type'] !== 'tm_reclamation') throw new Exception('Unrelated post creation is prohibited');
    $id = 1000 + count($GLOBALS['posts']);
    $input['ID'] = $id;
    foreach (['post_title', 'post_content'] as $key) $input[$key] = stripslashes($input[$key]);
    $GLOBALS['posts'][$id] = new WP_Post($input);
    return $id;
}
function update_post_meta($id, $key, $value) {
    if (!isset($GLOBALS['posts'][$id])) throw new Exception('Unrelated post mutation is prohibited');
    $GLOBALS['meta'][$id][$key] = is_string($value) ? stripslashes($value) : $value;
    return 1;
}
function get_post_meta($id, $key, $single = true) { return $GLOBALS['meta'][$id][$key] ?? ''; }
function get_post($id) { return $GLOBALS['posts'][$id] ?? null; }
function get_post_time(...$args) { return '2026-11-17T10:00:00+00:00'; }
function get_post_modified_time(...$args) { return '2026-11-17T10:00:00+00:00'; }
function get_posts($args) {
    return array_values(array_filter($GLOBALS['posts'], function ($post) use ($args) {
        if ($post->post_type !== $args['post_type'] || !in_array($post->post_status, (array) $args['post_status'], true)) return false;
        if (isset($args['meta_key']) && get_post_meta($post->ID, $args['meta_key']) !== $args['meta_value']) return false;
        foreach ($args['meta_query'] ?? [] as $rule) {
            if (!is_array($rule)) continue;
            if ((string) get_post_meta($post->ID, $rule['key']) !== (string) $rule['value']) return false;
        }
        return true;
    }));
}
function wp_mail(...$args) { $GLOBALS['sent'][] = $args; return true; }
function wp_get_current_user() { return (object) ['display_name' => 'Fixture administrator']; }
function current_time($format) { return '2026-11-17T11:00:00+01:00'; }
function wp_json_encode($data, $flags = 0) { return json_encode($data, $flags); }
require __DIR__ . '/../wordpress-plugin/tonerymaxim-reklamacie/tonerymaxim-reklamacie.php';

$checks = 0;
function check($condition, string $message): void {
    $GLOBALS['checks']++;
    if (!$condition) { fwrite(STDERR, "FAIL: $message\n"); exit(1); }
    echo "PASS: $message\n";
}
function body(array $patch = []): array {
    return array_merge(['claim_number' => 'RFIXTURE0001', 'customer_id' => 0, 'customer_email' => 'customer@example.invalid',
        'order_id' => 101, 'order_number' => '301092', 'product_id' => 201,
        'product_name' => 'Canon CRG-731 čierny kompatibilný toner', 'product_sku' => 'C731BK',
        'reason' => 'Produkt netlačí správne', 'message' => 'Na výtlačku vznikajú čierne pásy.', 'status' => 'received'], $patch);
}

Tonerymaxim_Reklamacie_Plugin::register_routes();
foreach ($routes as $route) foreach ($route as $endpoint) check($endpoint['permission_callback'] === ['Tonerymaxim_Reklamacie_Plugin', 'rest_permissions'], 'Every claims endpoint requires a real permission check');
$manager = false; $current_id = 0;
check(Tonerymaxim_Reklamacie_Plugin::rest_permissions()->data['status'] === 401, 'Anonymous access is denied');
$current_id = 8;
check(Tonerymaxim_Reklamacie_Plugin::rest_permissions()->data['status'] === 403, 'An editor without shop management permission is denied');
$manager = true; $current_id = 7;
check(Tonerymaxim_Reklamacie_Plugin::rest_permissions() === true, 'Shop manager access is preserved');
Tonerymaxim_Reklamacie_Plugin::register_post_type();
check(count(array_unique($post_type_options['capabilities'])) === 1 && $post_type_options['capabilities']['read_post'] === 'manage_woocommerce', 'Claim administration is restricted to shop managers');
foreach (['/wp-json/tonerymaxim/v1/reklamacie', '/wp-json/tonerymaxim/v1/reklamacie/123'] as $path) {
    $_SERVER['REQUEST_URI'] = $path;
    check(Tonerymaxim_Reklamacie_Plugin::include_claims_in_wc_auth(false), 'Woo authentication is enabled for the exact claims route');
}
foreach (['/wp-json/wp/v2/users', '/wp-json/tonerymaxim/v1/customers', '/wp-admin/plugins.php', '/wp-json/tonerymaxim/v1/reklamacie-other', '/wp-json/tonerymaxim/v1/reklamacie/1/other'] as $path) {
    $_SERVER['REQUEST_URI'] = $path;
    check(!Tonerymaxim_Reklamacie_Plugin::include_claims_in_wc_auth(false), 'Unrelated routes do not gain Woo key access');
    check(Tonerymaxim_Reklamacie_Plugin::include_claims_in_wc_auth(true), 'Existing Woo authentication decisions are preserved');
}
$before = serialize($order);
$first = Tonerymaxim_Reklamacie_Plugin::rest_create(new WP_REST_Request(body()));
check($first->status === 201 && $first->data['claim']['customer_id'] === 0, 'A verified guest order creates a real claim');
check($first->data['claim']['wp_id'] > 0 && $first->data['claim']['id'] === 'RFIXTURE0001', 'Returned identifiers match the Astro contract');
check(serialize($order) === $before && !$sent, 'Creation changes no Woo order and sends no duplicate WordPress confirmation');
$again = Tonerymaxim_Reklamacie_Plugin::rest_create(new WP_REST_Request(body()));
check($again->status === 200 && count($posts) === 1, 'Repeated submission returns the existing claim');
$conflict = Tonerymaxim_Reklamacie_Plugin::rest_create(new WP_REST_Request(body(['message' => 'Different description of the problem.'])));
check($conflict->status === 409 && count($posts) === 1, 'Changed content cannot overwrite an existing receipt');
$found = Tonerymaxim_Reklamacie_Plugin::rest_list(new WP_REST_Request(['customer_email' => 'customer@example.invalid', 'claim_number' => 'RFIXTURE0001']));
check(count($found->data['claims']) === 1, 'Exact case lookup supports reliable read-back and retries');
check(count(Tonerymaxim_Reklamacie_Plugin::rest_list(new WP_REST_Request(['customer_email' => 'other@example.invalid']))->data['claims']) === 0, 'Customer email filtering is retained');
foreach ([['customer_id' => 7], ['order_id' => 999], ['customer_email' => 'other@example.invalid'], ['order_number' => '999'], ['product_id' => 999], ['product_sku' => 'FORGED'], ['product_name' => 'FORGED']] as $patch) {
    $invalid = Tonerymaxim_Reklamacie_Plugin::rest_create(new WP_REST_Request(body(array_merge(['claim_number' => 'RINVALID'], $patch))));
    check(in_array($invalid->status, [400, 403], true) && count($posts) === 1, 'Unverified owner, order or product cannot create a claim');
}
$order->customer_id = 7;
$registered = Tonerymaxim_Reklamacie_Plugin::rest_create(new WP_REST_Request(body(['claim_number' => 'RREGISTERED', 'customer_id' => 7, 'customer_email' => 'updated@example.invalid'])));
check($registered->status === 201 && $registered->data['claim']['customer_id'] === 7, 'Registered claims support the current customer email');
$literal = 'Nefunguje "O\'Reilly" C:\\temp\\toner a slovenský výtlačok.';
$preserved = Tonerymaxim_Reklamacie_Plugin::rest_create(new WP_REST_Request(body(['claim_number' => 'RLITERAL', 'customer_id' => 7, 'message' => $literal])));
check($preserved->status === 201 && $preserved->data['claim']['message'] === $literal, 'Quotes, backslashes and Slovak text survive WordPress unslashing');
$plain_text = 'Čierna plocha <5 %, text <test> a odkaz C:\\toner ostávajú presné.';
$plain = Tonerymaxim_Reklamacie_Plugin::rest_create(new WP_REST_Request(body(['claim_number' => 'RPLAINTEXT', 'customer_id' => 7, 'message' => $plain_text])));
check($plain->status === 201 && $plain->data['claim']['message'] === $plain_text, 'Customer descriptions remain exact plain text even when HTML-like');
$lock_available = false; $count = count($posts);
$busy = Tonerymaxim_Reklamacie_Plugin::rest_create(new WP_REST_Request(body(['claim_number' => 'RBUSY', 'customer_id' => 7])));
check($busy->status === 503 && count($posts) === $count, 'A busy creation lock fails safely without a new record');
$lock_available = true; $insert_failure = true;
$failed = Tonerymaxim_Reklamacie_Plugin::rest_create(new WP_REST_Request(body(['claim_number' => 'RFAILURE', 'customer_id' => 7])));
check($failed->status === 500 && str_contains(end($wpdb->queries), 'RELEASE_LOCK'), 'Database insertion failure releases the advisory lock');
check(!$sent, 'All backend tests send zero external emails');
echo "Claims plugin checks: {$checks}; failures: 0\n";
