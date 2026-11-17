<?php
// Manual document archive. Never saves a Woo order or sends customer emails.
if (!defined('ABSPATH')) exit;
require_once __DIR__ . '/customer-accounts.php';

final class TM_Manual_Invoices {
    const POST_TYPE = 'tm_invoice_document';
    const REST_NS = 'tonerymaxim/v1';
    const PAGE = 'tm-customers-invoices';
    const PDF_MAX = 8388608;
    const XML_MAX = 2097152;
    const KEY_OPTION = 'tm_invoice_storage_key_v1';
    const UUID = '/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D';

    public static function init(): void {
        add_action('init', [__CLASS__, 'register_post_type']);
        add_action('admin_menu', [__CLASS__, 'admin_menu'], 20);
        add_action('tm_customer_admin_order_documents', [__CLASS__, 'order_card']);
        add_action('woocommerce_admin_order_data_after_order_details', [__CLASS__, 'order_card']);
        add_action('admin_post_tm_invoice_upload', [__CLASS__, 'handle_upload']);
        add_action('admin_post_tm_invoice_visibility', [__CLASS__, 'handle_visibility']);
        add_action('admin_post_tm_invoice_download', [__CLASS__, 'admin_download']);
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
        add_filter('woocommerce_rest_is_request_to_rest_api', [__CLASS__, 'include_in_wc_auth']);
    }

    public static function register_post_type(): void {
        register_post_type(self::POST_TYPE, [
            'public' => false, 'show_ui' => false, 'show_in_rest' => false,
            'rewrite' => false, 'supports' => [],
            'capabilities' => array_fill_keys(['edit_post', 'read_post', 'delete_post', 'edit_posts',
                'edit_others_posts', 'publish_posts', 'read_private_posts', 'delete_posts',
                'delete_private_posts', 'delete_published_posts', 'delete_others_posts',
                'edit_private_posts', 'edit_published_posts', 'create_posts'], 'manage_woocommerce'),
            'map_meta_cap' => false,
        ]);
    }

    public static function include_in_wc_auth($is_wc): bool {
        if ($is_wc) return true;
        global $wp;
        $route = $wp->query_vars['rest_route'] ?? null;
        // No URL/user filters while authentication is resolving the current user.
        return defined('REST_REQUEST') && REST_REQUEST && is_string($route)
            && (bool) preg_match('#^/?tonerymaxim/v1/invoices(?:/[a-f0-9-]{36}/file)?/?$#D', $route);
    }

    public static function permissions() {
        return current_user_can('manage_woocommerce') ? true
            : new WP_Error('tm_invoices_forbidden', 'Prístup nie je povolený.', ['status' => get_current_user_id() ? 403 : 401]);
    }

    public static function register_routes(): void {
        register_rest_route(self::REST_NS, '/invoices', [
            'methods' => WP_REST_Server::READABLE, 'callback' => [__CLASS__, 'rest_list'],
            'permission_callback' => [__CLASS__, 'permissions'],
        ]);
        register_rest_route(self::REST_NS, '/invoices/(?P<document_id>[a-f0-9-]{36})/file', [
            'methods' => WP_REST_Server::READABLE, 'callback' => [__CLASS__, 'rest_file'],
            'permission_callback' => [__CLASS__, 'permissions'],
        ]);
    }

    private static function response(array $body, int $status = 200): WP_REST_Response {
        return new WP_REST_Response($body, $status, ['Cache-Control' => 'private, no-store',
            'Pragma' => 'no-cache', 'X-Robots-Tag' => 'noindex, nofollow, noarchive',
            'X-Content-Type-Options' => 'nosniff']);
    }

    private static function tm_order($order): bool {
        if (!$order || !is_a($order, 'WC_Order')) return false;
        foreach ([$order->get_meta('source'), $order->get_meta('sales_channel'),
            $order->get_meta('created_via'), $order->get_created_via(), $order->get_meta('tm_order_number')] as $value) {
            if (str_contains(strtolower((string) $value), 'tonerymaxim') || str_starts_with((string) $value, 'TM-')) return true;
        }
        return false;
    }

    private static function order_number($order): string {
        return (string) ($order->get_meta('tm_order_number') ?: $order->get_order_number());
    }

    private static function key(): string {
        $hex = get_option(self::KEY_OPTION, '');
        if (!$hex) {
            add_option(self::KEY_OPTION, bin2hex(random_bytes(32)), '', false);
            $hex = get_option(self::KEY_OPTION, '');
        }
        if (!is_string($hex) || !preg_match('/^[a-f0-9]{64}$/D', $hex)) throw new RuntimeException('Archív dokumentov nie je dostupný.');
        return hex2bin($hex);
    }

    private static function directory(): string {
        $uploads = wp_upload_dir(null, false);
        if (!empty($uploads['error']) || empty($uploads['basedir'])) throw new RuntimeException('Úložisko dokumentov nie je dostupné.');
        $dir = rtrim($uploads['basedir'], '/\\') . '/tm-private-invoices';
        if (!is_dir($dir) && !wp_mkdir_p($dir)) throw new RuntimeException('Úložisko dokumentov nie je dostupné.');
        if (is_link($dir)) throw new RuntimeException('Úložisko dokumentov nie je dostupné.');
        // Encryption is required even on hosts which ignore .htaccess.
        if (!is_file($dir . '/index.php')) @file_put_contents($dir . '/index.php', "<?php\nhttp_response_code(404);\nexit;\n", LOCK_EX);
        if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n", LOCK_EX);
        return $dir;
    }

    private static function file_path(string $id, string $format): string {
        if (!preg_match(self::UUID, $id) || !in_array($format, ['pdf', 'xml'], true)) throw new RuntimeException('Neplatný dokument.');
        return self::directory() . '/' . $id . '.' . $format . '.enc';
    }

    public static function validate_file(string $bytes, string $format): array {
        $size = strlen($bytes);
        $limit = $format === 'pdf' ? self::PDF_MAX : self::XML_MAX;
        if (!in_array($format, ['pdf', 'xml'], true) || !$size || $size > $limit) throw new RuntimeException('PDF môže mať najviac 8 MB a XML najviac 2 MB.');
        if ($format === 'pdf') {
            if (!str_starts_with($bytes, '%PDF-') || !str_contains(substr($bytes, -4096), '%%EOF')
                || (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes) !== 'application/pdf') {
                throw new RuntimeException('Vyberte skutočný PDF súbor faktúry.');
            }
        } else {
            if (preg_match('/<!DOCTYPE|<!ENTITY/i', $bytes)) throw new RuntimeException('XML nesmie obsahovať DTD ani externé entity.');
            $previous = libxml_use_internal_errors(true);
            try {
                $xml = new DOMDocument();
                $xml->resolveExternals = false; $xml->substituteEntities = false;
                if (!$xml->loadXML($bytes, LIBXML_NONET) || $xml->doctype || !$xml->documentElement) throw new RuntimeException('XML dokument nie je platný.');
                $root = $xml->documentElement;
                $allowed = [
                    'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2' => 'Invoice',
                    'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2' => 'CreditNote',
                    'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100' => 'CrossIndustryInvoice',
                ];
                if (($allowed[(string) $root->namespaceURI] ?? '') !== $root->localName) throw new RuntimeException('Vyberte XML e-faktúry UBL alebo CII, nie bežný export údajov.');
            } finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
        }
        return ['size' => $size, 'sha256' => hash('sha256', $bytes), 'mime' => $format === 'pdf' ? 'application/pdf' : 'application/xml'];
    }

    private static function encrypt_file(string $id, string $format, string $bytes): void {
        $iv = random_bytes(12); $tag = '';
        $cipher = openssl_encrypt($bytes, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag, $id . ':' . $format);
        if ($cipher === false || strlen($tag) !== 16) throw new RuntimeException('Dokument sa nepodarilo zabezpečiť.');
        $path = self::file_path($id, $format);
        $blob = 'TMINV1' . $iv . $tag . $cipher;
        if (file_put_contents($path, $blob, LOCK_EX) !== strlen($blob)) throw new RuntimeException('Dokument sa nepodarilo uložiť.');
        @chmod($path, 0600);
    }

    private static function load_document(string $id): ?array {
        if (!preg_match(self::UUID, $id)) return null;
        $ids = get_posts(['post_type' => self::POST_TYPE, 'post_status' => 'private', 'fields' => 'ids',
            'posts_per_page' => 1, 'meta_key' => 'tm_invoice_document_id', 'meta_value' => $id]);
        return $ids ? self::load_post((int) $ids[0]) : null;
    }

    private static function load_post(int $post_id): ?array {
        $post = get_post($post_id);
        if (!$post || $post->post_type !== self::POST_TYPE || $post->post_status !== 'private') return null;
        $record = json_decode($post->post_content, true);
        if (!is_array($record) || !preg_match(self::UUID, (string) ($record['id'] ?? ''))
            || (int) ($record['order_id'] ?? 0) < 1 || !isset($record['files']['pdf'])) return null;
        $record['post_id'] = $post_id;
        $record['active'] = get_post_meta($post_id, 'tm_invoice_active', true) === '1';
        return $record;
    }

    public static function create_document(int $order_id, array $fields, array $files): array {
        if (!current_user_can('manage_woocommerce')) throw new RuntimeException('Prístup nie je povolený.');
        $order = wc_get_order($order_id);
        if (!self::tm_order($order)) throw new RuntimeException('TM objednávka nebola nájdená.');
        if (!TM_Customer_Accounts::registered($order)) throw new RuntimeException('Faktúru do účtu možno priložiť iba k objednávke registrovaného zákazníka.');
        if (!is_string($fields['number'] ?? null) || !is_string($fields['date'] ?? null)
            || (isset($fields['type']) && !is_string($fields['type']))) throw new RuntimeException('Vyplňte číslo, správny dátum a typ dokladu.');
        $number = sanitize_text_field($fields['number']);
        $date = $fields['date'];
        $type = $fields['type'] ?? 'invoice';
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date)) throw new RuntimeException('Vyplňte číslo, správny dátum a typ dokladu.');
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if ($number === '' || strlen($number) > 100 || !$parsed || $parsed->format('Y-m-d') !== $date
            || !in_array($type, ['invoice', 'credit_note'], true)) throw new RuntimeException('Vyplňte číslo, správny dátum a typ dokladu.');
        if (!isset($files['pdf']) || !is_string($files['pdf'])) throw new RuntimeException('Priložte PDF faktúru.');
        $manifest = [];
        foreach (['pdf', 'xml'] as $format) if (isset($files[$format])) $manifest[$format] = self::validate_file($files[$format], $format);
        $reference = hash('sha256', wp_json_encode([$order_id, $type, $number]));
        $fingerprint = hash('sha256', wp_json_encode([$date, $manifest]));
        global $wpdb;
        $lock = 'tm_invoice_' . substr(hash('sha256', $wpdb->prefix . $reference), 0, 48);
        if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 5)', $lock)) !== 1) throw new RuntimeException('Doklad sa práve spracováva. Skúste to o chvíľu.');
        $id = ''; $committed = false;
        try {
            $existing = get_posts(['post_type' => self::POST_TYPE, 'post_status' => 'private', 'fields' => 'ids',
                'posts_per_page' => 1, 'meta_query' => [
                    ['key' => 'tm_invoice_reference', 'value' => $reference],
                    ['key' => 'tm_invoice_active', 'value' => '1'],
                ]]);
            if ($existing) {
                $record = self::load_post((int) $existing[0]);
                if ($record && $record['fingerprint'] === $fingerprint) return $record;
                throw new RuntimeException('Doklad s týmto číslom už existuje. Pri oprave najskôr skryte pôvodný doklad.');
            }
            $id = strtolower(wp_generate_uuid4());
            foreach ($manifest as $format => $_) self::encrypt_file($id, $format, $files[$format]);
            $record = ['id' => $id, 'order_id' => $order_id, 'customer_id' => (int) $order->get_customer_id(),
                'number' => $number, 'date' => $date, 'type' => $type, 'files' => $manifest,
                'fingerprint' => $fingerprint, 'created_at' => current_time('c'), 'uploaded_by' => get_current_user_id()];
            $post_id = wp_insert_post(['post_type' => self::POST_TYPE, 'post_status' => 'private',
                'post_title' => wp_slash($number), 'post_content' => wp_slash(wp_json_encode($record)),
                'meta_input' => ['tm_invoice_document_id' => $id, 'tm_invoice_order_id' => $order_id,
                    'tm_invoice_customer_id' => $record['customer_id'], 'tm_invoice_reference' => $reference, 'tm_invoice_active' => '1'],
            ], true);
            if (is_wp_error($post_id) || !$post_id) throw new RuntimeException('Doklad sa nepodarilo zaevidovať.');
            // Preserve files even if a later verification fails: they already belong to an archived record.
            $committed = true;
            $saved = self::load_document($id);
            if (!$saved || !$saved['active'] || $saved['fingerprint'] !== $fingerprint) throw new RuntimeException('Uloženie dokladu sa nepodarilo overiť.');
            return $saved;
        } finally {
            if ($id && !$committed) foreach (array_keys($manifest) as $format) @unlink(self::file_path($id, $format));
            $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
        }
    }

    private static function customer_owns(array $record, int $customer_id): bool {
        $order = wc_get_order((int) $record['order_id']);
        return $record['active'] && $customer_id > 0 && (int) $record['customer_id'] === $customer_id
            && self::tm_order($order) && TM_Customer_Accounts::registered($order) && (int) $order->get_customer_id() === $customer_id;
    }

    private static function summary(array $record): array {
        $order = wc_get_order((int) $record['order_id']);
        return ['id' => $record['id'], 'order_id' => (int) $record['order_id'],
            'customer_id' => (int) $record['customer_id'], 'order_number' => self::order_number($order),
            'number' => $record['number'], 'date' => $record['date'], 'type' => $record['type'],
            'pdf' => true, 'xml' => isset($record['files']['xml'])];
    }

    public static function rest_list(WP_REST_Request $request): WP_REST_Response {
        $customer_id = (int) $request->get_param('customer_id');
        $page = max(1, min(10000, (int) ($request->get_param('page') ?: 1)));
        if ($customer_id < 1) return self::response(['ok' => false, 'error' => 'Neplatný zákazník.'], 400);
        $meta = [['key' => 'tm_invoice_customer_id', 'value' => $customer_id, 'type' => 'NUMERIC'],
            ['key' => 'tm_invoice_active', 'value' => '1']];
        $order_id = (int) $request->get_param('order_id');
        if ($order_id > 0) $meta[] = ['key' => 'tm_invoice_order_id', 'value' => $order_id, 'type' => 'NUMERIC'];
        $query = new WP_Query(['post_type' => self::POST_TYPE, 'post_status' => 'private', 'fields' => 'ids',
            'posts_per_page' => 20, 'paged' => $page, 'orderby' => 'ID', 'order' => 'DESC', 'meta_query' => $meta]);
        $documents = [];
        foreach ($query->posts as $post_id) {
            $record = self::load_post((int) $post_id);
            if ($record && self::customer_owns($record, $customer_id)) $documents[] = self::summary($record);
        }
        return self::response(['ok' => true, 'documents' => $documents, 'page' => $page,
            'has_more' => $page < (int) $query->max_num_pages], 200);
    }

    private static function read_file(array $record, string $format): array {
        if (!isset($record['files'][$format])) throw new RuntimeException('Dokument nebol nájdený.');
        $path = self::file_path($record['id'], $format);
        $max = ($format === 'pdf' ? self::PDF_MAX : self::XML_MAX) + 34;
        if (!is_file($path) || filesize($path) > $max) throw new RuntimeException('Dokument nie je dostupný.');
        $blob = file_get_contents($path);
        if ($blob === false || strlen($blob) < 34 || substr($blob, 0, 6) !== 'TMINV1') throw new RuntimeException('Dokument nie je dostupný.');
        $bytes = openssl_decrypt(substr($blob, 34), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA,
            substr($blob, 6, 12), substr($blob, 18, 16), $record['id'] . ':' . $format);
        $info = $record['files'][$format];
        if ($bytes === false || strlen($bytes) !== $info['size'] || !hash_equals($info['sha256'], hash('sha256', $bytes))) throw new RuntimeException('Dokument nie je dostupný.');
        $name = sanitize_file_name(remove_accents($record['number']));
        return ['filename' => ($record['type'] === 'credit_note' ? 'dobropis-' : 'faktura-') . ($name ?: 'doklad') . '.' . $format,
            'mime' => $info['mime'], 'size' => $info['size'], 'sha256' => $info['sha256'], 'bytes' => $bytes];
    }

    public static function rest_file(WP_REST_Request $request): WP_REST_Response {
        $record = self::load_document((string) $request->get_param('document_id'));
        $format = (string) $request->get_param('format');
        if (!$record || !in_array($format, ['pdf', 'xml'], true) || !self::customer_owns($record, (int) $request->get_param('customer_id'))) {
            return self::response(['ok' => false, 'error' => 'Dokument nebol nájdený.'], 404);
        }
        try {
            $file = self::read_file($record, $format);
            $file['content_base64'] = base64_encode($file['bytes']); unset($file['bytes']);
            return self::response(['ok' => true, 'document_id' => $record['id'], 'customer_id' => (int) $record['customer_id'], 'file' => $file], 200);
        } catch (RuntimeException $error) {
            return self::response(['ok' => false, 'error' => 'Dokument nie je dostupný.'], 503);
        }
    }

    public static function admin_menu(): void {
        add_submenu_page('tm-customers', 'Faktúry', 'Faktúry', 'manage_woocommerce', self::PAGE, [__CLASS__, 'admin_page']);
    }

    private static function page_url(int $order_id = 0): string {
        return add_query_arg(['page' => self::PAGE, 'order_id' => $order_id], admin_url('admin.php'));
    }

    public static function order_card($order): void {
        if (!current_user_can('manage_woocommerce') || !self::tm_order($order)) return;
        if (!TM_Customer_Accounts::registered($order)) {
            echo '<div class="tm-card tm-span-12"><h2>Faktúry do zákazníckeho účtu</h2>' . TM_Customer_Accounts::badge($order) . '<p>Zákazník nakúpil bez priradeného účtu. Nahrávanie faktúr do účtu nie je dostupné.</p></div>';
            return;
        }
        echo '<div class="tm-card tm-span-12"><h2>Faktúry a dokumenty</h2><p>Priložte PDF faktúru a voliteľne XML e-faktúru k tejto objednávke.</p><a class="button button-primary" href="' . esc_url(self::page_url($order->get_id())) . '">Spravovať faktúry</a></div>';
    }

    private static function guard_post(string $nonce): void {
        if (!current_user_can('manage_woocommerce')) wp_die('Prístup nie je povolený.', '', ['response' => 403]);
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') wp_die('Použite formulár.', '', ['response' => 405]);
        check_admin_referer($nonce);
    }

    private static function upload_bytes(string $format): ?string {
        $upload = $_FILES[$format] ?? null;
        if (!$upload || ($upload['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) return null;
        if (!is_array($upload) || ($upload['error'] ?? -1) !== UPLOAD_ERR_OK || !is_string($upload['tmp_name'] ?? null)
            || !is_uploaded_file($upload['tmp_name'])) throw new RuntimeException('Nahranie súboru zlyhalo. Skontrolujte veľkosť súboru.');
        $max = $format === 'pdf' ? self::PDF_MAX : self::XML_MAX;
        $size = filesize($upload['tmp_name']);
        if (!$size || $size > $max) throw new RuntimeException('PDF môže mať najviac 8 MB a XML najviac 2 MB.');
        $bytes = file_get_contents($upload['tmp_name']);
        if ($bytes === false || strlen($bytes) !== $size) throw new RuntimeException('Súbor sa nepodarilo načítať.');
        return $bytes;
    }

    public static function handle_upload(): void {
        $order_id = absint($_POST['order_id'] ?? 0);
        self::guard_post('tm_invoice_upload_' . $order_id);
        try {
            $files = []; foreach (['pdf', 'xml'] as $format) { $bytes = self::upload_bytes($format); if ($bytes !== null) $files[$format] = $bytes; }
            self::create_document($order_id, wp_unslash($_POST), $files);
            wp_safe_redirect(add_query_arg(['saved' => '1'], self::page_url($order_id)));
        } catch (RuntimeException $error) {
            wp_safe_redirect(add_query_arg(['invoice_error' => $error->getMessage()], self::page_url($order_id)));
        }
        exit;
    }

    public static function set_visibility(string $id, bool $active): void {
        if (!current_user_can('manage_woocommerce')) throw new RuntimeException('Prístup nie je povolený.');
        $record = self::load_document($id);
        if (!$record) throw new RuntimeException('Doklad nebol nájdený.');
        $reference = (string) get_post_meta($record['post_id'], 'tm_invoice_reference', true);
        global $wpdb;
        $lock = 'tm_invoice_' . substr(hash('sha256', $wpdb->prefix . $reference), 0, 48);
        if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 5)', $lock)) !== 1) throw new RuntimeException('Doklad sa práve spracováva. Skúste to o chvíľu.');
        try {
            if ($active) {
                $others = get_posts(['post_type' => self::POST_TYPE, 'post_status' => 'private', 'fields' => 'ids',
                    'posts_per_page' => 1, 'post__not_in' => [$record['post_id']], 'meta_query' => [
                        ['key' => 'tm_invoice_reference', 'value' => $reference], ['key' => 'tm_invoice_active', 'value' => '1'],
                    ]]);
                if ($others) throw new RuntimeException('Doklad s týmto číslom je už zobrazený. Najskôr skryte jeho inú verziu.');
            }
            update_post_meta($record['post_id'], 'tm_invoice_active', $active ? '1' : '0');
            if (get_post_meta($record['post_id'], 'tm_invoice_active', true) !== ($active ? '1' : '0')) throw new RuntimeException('Zmenu dostupnosti sa nepodarilo uložiť.');
        } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); }
    }

    public static function handle_visibility(): void {
        $id = sanitize_text_field(wp_unslash($_POST['document_id'] ?? ''));
        self::guard_post('tm_invoice_visibility_' . $id);
        $record = self::load_document($id);
        if (!$record) wp_die('Doklad nebol nájdený.', '', ['response' => 404]);
        try {
            self::set_visibility($id, ($_POST['active'] ?? '') === '1');
            wp_safe_redirect(self::page_url((int) $record['order_id']));
        } catch (RuntimeException $error) {
            wp_safe_redirect(add_query_arg(['invoice_error' => $error->getMessage()], self::page_url((int) $record['order_id'])));
        }
        exit;
    }

    public static function admin_download(): void {
        if (!current_user_can('manage_woocommerce')) wp_die('Prístup nie je povolený.', '', ['response' => 403]);
        $id = sanitize_text_field(wp_unslash($_GET['document_id'] ?? ''));
        $format = sanitize_key($_GET['format'] ?? '');
        check_admin_referer('tm_invoice_download_' . $id . '_' . $format);
        $record = self::load_document($id);
        if (!$record || !in_array($format, ['pdf', 'xml'], true)) wp_die('Doklad nebol nájdený.', '', ['response' => 404]);
        try { $file = self::read_file($record, $format); }
        catch (RuntimeException $error) { wp_die('Doklad nie je dostupný.', '', ['response' => 503]); }
        nocache_headers(); header('X-Content-Type-Options: nosniff');
        header('Content-Type: ' . $file['mime']);
        header('Content-Disposition: attachment; filename="' . str_replace(['"', "\r", "\n"], '', $file['filename']) . '"');
        header('Content-Length: ' . $file['size']); echo $file['bytes']; exit;
    }

    private static function download_url(string $id, string $format): string {
        return wp_nonce_url(add_query_arg(['action' => 'tm_invoice_download', 'document_id' => $id, 'format' => $format], admin_url('admin-post.php')), 'tm_invoice_download_' . $id . '_' . $format);
    }

    public static function admin_page(): void {
        if (!current_user_can('manage_woocommerce')) wp_die('Prístup nie je povolený.', '', ['response' => 403]);
        $order_id = absint($_GET['order_id'] ?? 0);
        $order = $order_id ? wc_get_order($order_id) : null;
        if ($order_id && !self::tm_order($order)) wp_die('TM objednávka nebola nájdená.', '', ['response' => 404]);
        echo '<div class="wrap tm-wrap"><h1>Faktúry</h1>';
        if (!empty($_GET['saved'])) echo '<div class="notice notice-success"><p>Faktúra bola uložená k objednávke.</p></div>';
        if (!empty($_GET['invoice_error'])) echo '<div class="notice notice-error"><p>' . esc_html(sanitize_text_field(wp_unslash($_GET['invoice_error']))) . '</p></div>';
        if (!$order) {
            $search = sanitize_text_field(wp_unslash($_GET['invoice_search'] ?? ''));
            echo '<p>Faktúry do účtu prikladáte iba registrovaným zákazníkom. Vyberte objednávku s priradeným účtom.</p><form method="get" class="tm-search"><input type="hidden" name="page" value="' . self::PAGE . '"><input name="invoice_search" type="search" value="' . esc_attr($search) . '" placeholder="TM číslo objednávky, Woo ID alebo e-mail" aria-label="Vyhľadať objednávku"><button class="button">Hľadať objednávku</button></form>';
            $args = ['limit' => 30, 'orderby' => 'date', 'order' => 'DESC'];
            $orders = [];
            if ($search === '') $orders = wc_get_orders($args);
            elseif (is_email($search)) $orders = wc_get_orders($args + ['billing_email' => $search]);
            else {
                if (ctype_digit($search)) { $direct = wc_get_order((int) $search); if ($direct) $orders[] = $direct; }
                $matched = wc_get_orders($args + ['meta_query' => ['relation' => 'OR',
                    ['key' => 'tm_order_number', 'value' => $search], ['key' => 'gopay_order_number', 'value' => $search]]]);
                $orders = array_merge($orders, $matched);
            }
            $seen = [];
            echo '<table class="widefat striped" style="margin-top:20px"><thead><tr><th>Objednávka</th><th>Zákazník</th><th>Faktúry</th></tr></thead><tbody>';
            foreach ($orders as $item) {
                if (!self::tm_order($item) || isset($seen[$item->get_id()])) continue;
                if ($search === '' && !TM_Customer_Accounts::registered($item)) continue;
                $seen[$item->get_id()] = true;
                echo '<tr><td>' . esc_html(self::order_number($item)) . '<br><small>Woo ID ' . (int) $item->get_id() . '</small></td><td>' . esc_html($item->get_formatted_billing_full_name()) . '<br>' . esc_html($item->get_billing_email()) . '<p>' . TM_Customer_Accounts::badge($item) . '</p></td><td>' . (TM_Customer_Accounts::registered($item) ? '<a class="button" href="' . esc_url(self::page_url($item->get_id())) . '">Spravovať faktúry</a>' : 'Bez zákazníckeho účtu – nahrávanie nie je dostupné') . '</td></tr>';
            }
            if (!$seen) echo '<tr><td colspan="3">Objednávka nebola nájdená. Skúste celé číslo objednávky alebo e-mail.</td></tr>';
            echo '</tbody></table></div>'; return;
        }
        echo '<p><a href="' . esc_url(self::page_url()) . '">← Vybrať inú objednávku</a></p><div class="tm-card"><h2>Objednávka ' . esc_html(self::order_number($order)) . '</h2><p>' . esc_html($order->get_formatted_billing_full_name()) . ' — ' . esc_html($order->get_billing_email()) . '</p>';
        echo TM_Customer_Accounts::badge($order);
        if (!TM_Customer_Accounts::registered($order)) {
            echo '<p>Táto objednávka nemá priradený existujúci zákaznícky účet. Faktúru sem nenahrávajte. Samotná zhoda e-mailu s registráciou nestačí.</p></div></div>';
            return;
        }
        echo '<p>Doklad bude prístupný registrovanému zákazníkovi tejto objednávky.</p>';
        echo '<form method="post" enctype="multipart/form-data" action="' . esc_url(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="tm_invoice_upload"><input type="hidden" name="order_id" value="' . (int) $order_id . '">';
        wp_nonce_field('tm_invoice_upload_' . $order_id);
        echo '<p><label>Číslo faktúry <input name="number" type="text" required maxlength="100"></label></p><p><label>Dátum vystavenia <input name="date" type="date" value="' . esc_attr(current_time('Y-m-d')) . '" required></label></p><p><label>Typ dokladu <select name="type"><option value="invoice">Faktúra</option><option value="credit_note">Dobropis</option></select></label></p><p><label>PDF faktúra (povinné, najviac 8 MB) <input name="pdf" type="file" accept=".pdf,application/pdf" required></label></p><p><label>XML e-faktúra (voliteľné, najviac 2 MB) <input name="xml" type="file" accept=".xml,application/xml,text/xml"></label></p><p class="description">XML môže byť doklad UBL alebo CII. Uloženie do účtu neodosiela e-faktúru cez Peppol.</p><p><button class="button button-primary">Uložiť faktúru k objednávke</button></p></form></div>';
        $ids = get_posts(['post_type' => self::POST_TYPE, 'post_status' => 'private', 'fields' => 'ids', 'posts_per_page' => 100,
            'meta_key' => 'tm_invoice_order_id', 'meta_value' => $order_id, 'orderby' => 'ID', 'order' => 'DESC']);
        echo '<h2>Priložené doklady</h2><table class="widefat striped"><thead><tr><th>Doklad</th><th>Dátum</th><th>Súbory</th><th>Dostupnosť</th></tr></thead><tbody>';
        foreach ($ids as $post_id) {
            $record = self::load_post((int) $post_id); if (!$record) continue;
            echo '<tr><td>' . esc_html(($record['type'] === 'credit_note' ? 'Dobropis ' : 'Faktúra ') . $record['number']) . '</td><td>' . esc_html($record['date']) . '</td><td>';
            foreach (array_keys($record['files']) as $format) echo '<a class="button" href="' . esc_url(self::download_url($record['id'], $format)) . '">' . esc_html(strtoupper($format)) . '</a> ';
            echo '</td><td><p>' . ($record['active'] ? 'Zobrazený zákazníkovi' : 'Skrytý zákazníkovi') . '</p><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="tm_invoice_visibility"><input type="hidden" name="document_id" value="' . esc_attr($record['id']) . '"><input type="hidden" name="active" value="' . ($record['active'] ? '0' : '1') . '">';
            wp_nonce_field('tm_invoice_visibility_' . $record['id']);
            echo '<button class="button">' . ($record['active'] ? 'Skryť zákazníkovi' : 'Zobraziť zákazníkovi') . '</button></form></td></tr>';
        }
        if (!$ids) echo '<tr><td colspan="4">K objednávke zatiaľ nebola pridaná faktúra.</td></tr>';
        echo '</tbody></table></div>';
    }
}

add_action('plugins_loaded', ['TM_Manual_Invoices', 'init'], 20);
