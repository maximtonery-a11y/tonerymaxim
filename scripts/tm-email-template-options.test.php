<?php
// Offline integration check. No WordPress database, HTTP, orders or SMTP.
define('ABSPATH', __DIR__ . '/');
$saved_templates = [
    'tm-mail-c30ad366' => ['label'=>'predpokladaný termín expedície', 'subject'=>'Objednávka {order_number}', 'message'=>'Expedícia v piatok 30. 10. 2026.'],
    'tm-mail-aabbccdd' => ['label'=>'Termín <výroby>', 'subject'=>'Informácia', 'message'=>'Text'],
    'tm-mail-11223344' => ['label'=>'Prázdna šablóna', 'subject'=>'', 'message'=>''],
];
$allowed = true;
$nonce_checks = 0;
$order = null;

function add_action(...$args) {}
function get_option($key, $default = false) { global $saved_templates; return $key === 'tm_customer_admin_email_templates' ? $saved_templates : $default; }
function wc_get_order_statuses() { return ['wc-pending'=>'Čaká na platbu', 'wc-processing'=>'Spracováva sa', 'wc-tm-shipped'=>'Expedovaná']; }
function esc_attr($value) { return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8'); }
function esc_html($value) { return esc_attr($value); }
function selected($a, $b, $echo = true) { $result = $a === $b ? 'selected="selected"' : ''; if ($echo) echo $result; return $result; }
function current_user_can($capability) { global $allowed; return $allowed; }
function wp_die($message) { throw new RuntimeException((string)$message); }
function check_admin_referer($name) { global $nonce_checks; if (($_POST['_wpnonce'] ?? '') !== 'valid-fixture') throw new RuntimeException('Bad nonce'); $nonce_checks++; }
function absint($value) { return abs((int)$value); }
function wp_unslash($value) { return $value; }
function sanitize_key($value) { return preg_replace('/[^a-z0-9_-]/', '', strtolower((string)$value)); }
function wc_get_order($id) { global $order; return $id === 100 ? $order : null; }
function is_email($value) { return filter_var($value, FILTER_VALIDATE_EMAIL) !== false; }
function wp_generate_uuid4() { return 'd49747ed-b93a-4bfc-9c50-d2f1a8995071'; }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
function admin_url($path) { return 'https://example.invalid/wp-admin/' . $path; }
function add_query_arg($args, $url) { return $url . '?' . http_build_query($args); }
class TestRedirect extends RuntimeException {}
function wp_safe_redirect($url) { throw new TestRedirect($url); }
class WC_Order {
    public array $meta = ['source'=>'tonerymaxim'];
    public string $status = 'processing';
    public int $saves = 0;
    public function get_meta($key, $single = true) { return $this->meta[$key] ?? ''; }
    public function get_created_via() { return 'tonerymaxim'; }
    public function get_billing_email() { return 'customer@example.invalid'; }
    public function update_meta_data($key, $value) { $this->meta[$key] = $value; }
    public function delete_meta_data($key) { unset($this->meta[$key]); }
    public function set_date_modified($date) { $this->meta['modified-fixture'] = $date; }
    public function save() { $this->saves++; }
    public function update_status($status, $note, $manual) { $this->status = $status; }
}
require __DIR__ . '/../wordpress-plugin/tonerymaxim-customer-administration/tonerymaxim-customer-administration.php';

function check($condition, $message) { if (!$condition) throw new RuntimeException($message); }
function select_action($value) {
    $_POST = ['_wpnonce'=>'valid-fixture', 'order_id'=>100, 'order_status'=>$value];
    try { TM_Customer_Administration_V1::update_order_status(); }
    catch (TestRedirect $redirect) { return $redirect->getMessage(); }
    throw new RuntimeException('Expected redirect');
}

$render = new ReflectionMethod(TM_Customer_Administration_V1::class, 'render_status_email_options');
$render->setAccessible(true);
ob_start(); $render->invoke(null, 'processing'); $html = ob_get_clean();
check(str_contains($html, 'value="tm-mail-c30ad366"'), 'Custom template missing from status/email selector');
check(str_contains($html, 'E-mail: predpokladaný termín expedície'), 'Custom label missing');
check(str_contains($html, 'Termín &lt;výroby&gt;'), 'Template label must be escaped');
check(!str_contains($html, 'tm-mail-11223344'), 'An empty template must not be offered');
check(str_contains($html, 'value="processing" selected="selected"'), 'Current order status must remain selected');
echo "PASS: custom and original choices render safely\n";

$order = new WC_Order();
$redirect = select_action('tm-mail-c30ad366');
$request = json_decode($order->meta['_tm_email_template_request'] ?? '', true);
check(($request['template_slug'] ?? '') === 'tm-mail-c30ad366', 'Selecting a custom template must queue that template');
check(($request['message'] ?? '') === 'Expedícia v piatok 30. 10. 2026.', 'Queued message differs from the saved template');
check($order->status === 'processing', 'Custom template must preserve the order status');
check($order->saves === 1 && str_contains($redirect, 'tm_notice='), 'Request must be saved successfully');
check($nonce_checks === 1, 'The normal status/email form must verify its nonce');
echo "PASS: status/email selection queues a reusable template without changing status\n";

$pending = $order->meta['_tm_email_template_request'];
$redirect = select_action('tm-mail-aabbccdd');
check(str_contains($redirect, 'tm_error='), 'A second pending message must be rejected');
check($order->meta['_tm_email_template_request'] === $pending, 'Pending message must not be overwritten');
echo "PASS: pending message cannot be overwritten\n";

$order = new WC_Order();
$redirect = select_action('tm-shipped');
check($order->status === 'tm-shipped' && str_contains($redirect, 'tm_notice='), 'Original order status action must still work');
check(!isset($order->meta['_tm_email_template_request']), 'Original status must not also queue a separate duplicate message');
echo "PASS: existing status changes retain their original behavior\n";

$order = new WC_Order(); $allowed = false;
try { select_action('tm-mail-c30ad366'); throw new RuntimeException('Expected permission rejection'); }
catch (RuntimeException $error) { check($error->getMessage() === 'Nemáte oprávnenie.', 'Unexpected permission result'); }
check($order->saves === 0, 'Unauthorized action must not change the order');
echo "PASS: authorization is required\n";
