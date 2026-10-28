<?php
// Offline integration check using the real plugin and isolated WP/Woo adapters.
// No production orders, database, HTTP or SMTP.
define('ABSPATH', __DIR__ . '/');
$saved_templates = [
    'tm-mail-c30ad366' => ['label'=>'predpokladaný termín expedície', 'subject'=>'Objednávka {order_number}', 'message'=>'Expedícia v piatok 30. 10. 2026.'],
    'tm-mail-aabbccdd' => ['label'=>'Termín <výroby>', 'subject'=>'Informácia', 'message'=>'Text'],
    'tm-mail-11223344' => ['label'=>'Prázdna šablóna', 'subject'=>'', 'message'=>''],
    'tm-mail-not-a-valid-id' => ['label'=>'Neplatný identifikátor', 'subject'=>'Text', 'message'=>'Text'],
];
$allowed = true;
$nonce_checks = 0;
$order = null;
$hooks = [];
$registered_statuses = [];
$uuid_counter = 0;

function add_action($name, $callback, $priority = 10, $accepted_args = 1) { global $hooks; $hooks[$name][$priority][] = [$callback, $accepted_args]; }
function add_filter(...$args) { add_action(...$args); }
function do_action($name, ...$args) { global $hooks; $priorities = $hooks[$name] ?? []; ksort($priorities); foreach ($priorities as $callbacks) foreach ($callbacks as [$callback, $accepted]) call_user_func_array($callback, array_slice($args, 0, $accepted)); }
function apply_filters($name, $value) { global $hooks; $priorities = $hooks[$name] ?? []; ksort($priorities); foreach ($priorities as $callbacks) foreach ($callbacks as [$callback]) $value = $callback($value); return $value; }
function get_option($key, $default = false) { global $saved_templates; return $key === 'tm_customer_admin_email_templates' ? $saved_templates : $default; }
function update_option($key, $value, $autoload = null) { global $saved_templates; check($key === 'tm_customer_admin_email_templates', 'Unexpected option write'); $saved_templates = $value; }
function wc_get_order_statuses() { return apply_filters('wc_order_statuses', ['wc-pending'=>'Čaká na platbu', 'wc-processing'=>'Spracováva sa', 'wc-on-hold'=>'Čaká na úhradu']); }
function register_post_status($slug, $options) { global $registered_statuses; $registered_statuses[$slug] = $options; }
function _n_noop($singular, $plural) { return ['singular'=>$singular, 'plural'=>$plural]; }
function esc_attr($value) { return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8'); }
function esc_html($value) { return esc_attr($value); }
function selected($a, $b, $echo = true) { $result = $a === $b ? 'selected="selected"' : ''; if ($echo) echo $result; return $result; }
function current_user_can($capability) { global $allowed; return $allowed; }
function wp_die($message) { throw new RuntimeException((string)$message); }
function check_admin_referer($name) { global $nonce_checks; if (($_POST['_wpnonce'] ?? '') !== 'valid-fixture') throw new RuntimeException('Bad nonce'); $nonce_checks++; }
function absint($value) { return abs((int)$value); }
function wp_unslash($value) { return $value; }
function sanitize_key($value) { return preg_replace('/[^a-z0-9_-]/', '', strtolower((string)$value)); }
function sanitize_text_field($value) { return trim(strip_tags($value)); }
function sanitize_textarea_field($value) { return trim(strip_tags($value)); }
if (!function_exists('mb_substr')) { function mb_substr($value, $start, $length) { return substr($value, $start, $length); } }
function wc_get_order($id) { global $order; return $id === 100 ? $order : null; }
function wp_generate_uuid4() { global $uuid_counter; return 'd49747ed-b93a-4bfc-9c50-' . str_pad(dechex(++$uuid_counter), 12, '0', STR_PAD_LEFT); }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
function admin_url($path) { return 'https://example.invalid/wp-admin/' . $path; }
function add_query_arg($args, $url) { return $url . '?' . http_build_query($args); }
class TestRedirect extends RuntimeException {}
function wp_safe_redirect($url) { throw new TestRedirect($url); }
class WC_Order {
    public array $meta = ['source'=>'tonerymaxim'];
    public string $status = 'processing';
    public int $saves = 0;
    private ?string $previous = null;
    public function get_id() { return 100; }
    public function get_status() { return $this->status; }
    public function get_meta($key, $single = true) { return $this->meta[$key] ?? ''; }
    public function get_created_via() { return $this->meta['source']; }
    public function update_meta_data($key, $value) { $this->meta[$key] = $value; }
    public function delete_meta_data($key) { unset($this->meta[$key]); }
    public function set_date_modified($date) { $this->meta['modified-fixture'] = $date; }
    public function save() {
        $this->saves++;
        check($this->saves < 50, 'Recursive order saves');
        $from = $this->previous; $this->previous = null;
        do_action('woocommerce_after_order_object_save', $this, null);
        if ($from !== null) do_action('woocommerce_order_status_changed', 100, $from, $this->status, $this);
    }
    public function set_status($status, $note = '', $manual = false) { if ($status !== $this->status) { $this->previous = $this->status; $this->status = $status; } }
    public function update_status($status, $note = '', $manual = false) { $this->set_status($status, $note, $manual); $this->save(); }
}
require __DIR__ . '/../wordpress-plugin/tonerymaxim-customer-administration/tonerymaxim-customer-administration.php';
do_action('plugins_loaded');
do_action('init');

function check($condition, $message) { if (!$condition) throw new RuntimeException($message); }
function select_action($value) {
    $_POST = ['_wpnonce'=>'valid-fixture', 'order_id'=>100, 'order_status'=>$value];
    try { TM_Customer_Administration_V1::update_order_status(); }
    catch (TestRedirect $redirect) { return $redirect->getMessage(); }
    throw new RuntimeException('Expected redirect');
}
function active_request($order) { return json_decode($order->get_meta('_tm_email_template_request'), true); }

$statuses = wc_get_order_statuses();
check(($registered_statuses['wc-tm-mail-c30ad366']['label'] ?? '') === 'predpokladaný termín expedície', 'Template must register a real Woo order status');
check(isset($statuses['wc-tm-mail-aabbccdd']), 'Custom status missing from Woo editor/filter choices');
check(isset($statuses['wc-tm-mail-11223344']), 'A status already used on orders must remain registered even if its template is incomplete');
check(!isset($statuses['wc-tm-mail-not-a-valid-id']), 'Malformed status ID must be rejected');
check(strlen('wc-tm-mail-c30ad366') <= 20, 'Status must fit WordPress post_status');
check(isset(TM_Customer_Administration_V1::add_tm_order_statuses(['wc-processing'=>'Processing'])['wc-tm-mail-c30ad366']), 'Custom statuses must survive a missing on-hold anchor');
$render = new ReflectionMethod(TM_Customer_Administration_V1::class, 'render_status_email_options');
$render->setAccessible(true);
ob_start(); $render->invoke(null, 'tm-mail-c30ad366'); $html = ob_get_clean();
check(str_contains($html, 'value="tm-mail-c30ad366" selected="selected"'), 'Saved custom status must stay selected');
check(substr_count($html, 'value="tm-mail-c30ad366"') === 1, 'Custom status must appear exactly once');
check(str_contains($html, 'Termín &lt;výroby&gt;'), 'Status label must be escaped');
check(!str_contains($html, 'E-mail: ') && !str_contains($html, 'bez zmeny stavu'), 'Status selector must contain real status labels');
echo "PASS: templates are real registered Woo statuses in all status choices\n";

$order = new WC_Order();
$redirect = select_action('tm-mail-c30ad366');
$request = active_request($order);
check($order->status === 'tm-mail-c30ad366', 'Selecting a template status must actually change the order status');
check(($request['template_slug'] ?? '') === 'tm-mail-c30ad366', 'Status change must queue the matching email');
check(($request['message'] ?? '') === 'Expedícia v piatok 30. 10. 2026.', 'Email must retain the saved template content');
check(str_contains($redirect, 'tm_notice=') && $nonce_checks === 1, 'Status action must verify nonce and report success');
select_action('tm-mail-c30ad366');
check(active_request($order)['id'] === $request['id'], 'Saving an unchanged status must not enqueue a duplicate email');
echo "PASS: status/email action changes status and queues its email once\n";

// Simulates native Woo, full editor, bulk/API calls rather than only the TM form.
$order = new WC_Order();
$order->update_status('tm-mail-aabbccdd', 'Native Woo change', true);
check(active_request($order)['template_slug'] === 'tm-mail-aabbccdd', 'Native status changes must send the matching template too');
$first = active_request($order);
$order->update_status('tm-mail-c30ad366');
$order->update_status('tm-mail-aabbccdd');
check(active_request($order)['id'] === $first['id'], 'A pending email must not be overwritten by a subsequent status');
$backlog = json_decode($order->get_meta('_tm_email_template_backlog'), true);
check(count($backlog) === 2, 'Rapid state changes must retain both later email requests');
$order->update_meta_data('_tm_email_template_sent_id', $first['id']); $order->save();
check(active_request($order)['id'] === $backlog[0]['id'], 'SMTP acknowledgement must advance the next email');
$order->update_meta_data('_tm_email_template_sent_id', $backlog[0]['id']); $order->save();
check(active_request($order)['id'] === $backlog[1]['id'], 'Email requests must advance in order');
check($order->get_meta('_tm_email_template_backlog') === '', 'Delivered backlog must be cleared');
check($order->status === 'tm-mail-aabbccdd', 'Email acknowledgement must not change the actual order status');
echo "PASS: native status changes queue emails and rapid transitions cannot lose pending messages\n";

$order = new WC_Order();
select_action('tm-shipped');
check($order->status === 'tm-shipped', 'Existing status action must still work');
check($order->get_meta('_tm_email_template_request') === '', 'Existing statuses must not gain a duplicate template request');
check(str_contains($order->get_meta('_tm_email_subject'), 'expedovaná'), 'Original status template must remain intact');
$order->update_status('processing');
check($order->get_meta('_tm_email_subject') === '' && $order->get_meta('_tm_email_message') === '', 'Unrelated status must not reuse stale template text');
$order = new WC_Order(); $order->meta['source'] = 'coloriq';
$order->update_status('tm-mail-c30ad366');
check($order->get_meta('_tm_email_template_request') === '', 'Non-TM orders must not receive TM template requests');
echo "PASS: builtin status emails and non-TM orders retain their behavior\n";

// Creating and renaming a template must also create/rename its reusable state.
$_POST = ['_wpnonce'=>'valid-fixture', 'template_label'=>'Čakáme na dodávateľa', 'template_subject'=>'Informácia', 'template_message'=>'Čakáme.'];
try { TM_Customer_Administration_V1::add_email_template(); } catch (TestRedirect $redirect) {}
$new = array_key_last($saved_templates);
check((wc_get_order_statuses()['wc-'.$new] ?? '') === 'Čakáme na dodávateľa', 'New template must automatically become a status');
$_POST = ['_wpnonce'=>'valid-fixture', 'templates'=>[$new=>['label'=>'Čakáme na potvrdenie', 'subject'=>'Nový predmet', 'message'=>'Nový text']]];
try { TM_Customer_Administration_V1::save_email_templates(); } catch (TestRedirect $redirect) {}
check((wc_get_order_statuses()['wc-'.$new] ?? '') === 'Čakáme na potvrdenie', 'Renaming must update the status label without changing its ID');
$_POST['templates'][$new]['message'] = '';
try { TM_Customer_Administration_V1::save_email_templates(); } catch (TestRedirect $redirect) { check(str_contains($redirect->getMessage(), 'tm_error='), 'Incomplete custom template must report an error'); }
check($saved_templates[$new]['message'] === 'Nový text', 'Incomplete edit must preserve the previous usable template');
echo "PASS: template creation and editing maintain matching order statuses\n";

$order = new WC_Order(); $allowed = false;
try { select_action('tm-mail-c30ad366'); throw new RuntimeException('Expected permission rejection'); }
catch (RuntimeException $error) { check($error->getMessage() === 'Nemáte oprávnenie.', 'Unexpected permission result'); }
check($order->saves === 0, 'Unauthorized action must not change the order');
$allowed = true; $_POST = ['order_id'=>100, 'order_status'=>'tm-mail-c30ad366', '_wpnonce'=>'invalid'];
try { TM_Customer_Administration_V1::update_order_status(); throw new RuntimeException('Expected nonce rejection'); }
catch (RuntimeException $error) { check($error->getMessage() === 'Bad nonce', 'Unexpected nonce result'); }
check($order->saves === 0, 'Invalid nonce must not change the order');
$redirect = select_action('tm-mail-not-a-valid-id');
check(str_contains($redirect, 'tm_error=') && $order->saves === 0, 'An unregistered status must be rejected');
echo "PASS: capabilities, nonce and registered status validation are required\n";
