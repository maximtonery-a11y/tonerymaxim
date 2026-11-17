<?php
/**
 * Plugin Name: ToneryMAXIM Reklamácie
 * Description: Vlastný reklamačný systém pre ToneryMAXIM.sk s REST API pre Astro e-shop.
 * Version: 1.1.5
 * Author: ToneryMAXIM
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Tonerymaxim_Reklamacie_Plugin {
    const POST_TYPE = 'tm_reclamation';
    const REST_NS = 'tonerymaxim/v1';

    public static function init(): void {
        add_filter('woocommerce_rest_is_request_to_rest_api', [__CLASS__, 'include_claims_in_wc_auth']);
        add_action('init', [__CLASS__, 'register_post_type']);
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
        add_action('add_meta_boxes', [__CLASS__, 'add_meta_boxes']);
        add_action('admin_init', [__CLASS__, 'disable_gutenberg_editor']);
        add_action('admin_head', [__CLASS__, 'admin_styles']);
        add_action('save_post_' . self::POST_TYPE, [__CLASS__, 'save_meta_box'], 10, 2);
        add_filter('manage_' . self::POST_TYPE . '_posts_columns', [__CLASS__, 'columns']);
        add_action('manage_' . self::POST_TYPE . '_posts_custom_column', [__CLASS__, 'column_content'], 10, 2);
    }


    public static function disable_gutenberg_editor(): void {
        remove_post_type_support(self::POST_TYPE, 'editor');
        remove_post_type_support(self::POST_TYPE, 'comments');
        remove_post_type_support(self::POST_TYPE, 'revisions');
    }

    public static function admin_styles(): void {
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if (!$screen || $screen->post_type !== self::POST_TYPE) return;
        echo '<style>
            body.post-type-tm_reclamation #postdivrich,
            body.post-type-tm_reclamation #commentstatusdiv,
            body.post-type-tm_reclamation #commentsdiv,
            body.post-type-tm_reclamation #slugdiv { display:none!important; }
            body.post-type-tm_reclamation .tm-reklamacia-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px}
            body.post-type-tm_reclamation .tm-reklamacia-card{background:#fff;border:1px solid #dcdcde;border-radius:10px;padding:16px}
            body.post-type-tm_reclamation .tm-reklamacia-card h3{margin:0 0 12px;font-size:16px}
            body.post-type-tm_reclamation .tm-status-row{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 18px}
            body.post-type-tm_reclamation .tm-status-row label{border:1px solid #dcdcde;border-radius:999px;padding:8px 12px;background:#fff;cursor:pointer;font-weight:600}
            body.post-type-tm_reclamation .tm-status-row input{margin-right:6px}
            body.post-type-tm_reclamation .tm-detail-table th{width:170px;text-align:left}
            body.post-type-tm_reclamation .tm-admin-note{width:100%;min-height:120px}
            @media(max-width:900px){body.post-type-tm_reclamation .tm-reklamacia-grid{grid-template-columns:1fr}}
        </style>';
    }

    public static function register_post_type(): void {
        register_post_type(self::POST_TYPE, [
            'labels' => [
                'name' => 'TM Reklamácie',
                'singular_name' => 'TM Reklamácia',
                'menu_name' => 'TM Reklamácie',
                'add_new' => 'Pridať reklamáciu',
                'add_new_item' => 'Pridať novú reklamáciu',
                'edit_item' => 'Upraviť reklamáciu',
                'new_item' => 'Nová reklamácia',
                'view_item' => 'Zobraziť reklamáciu',
                'search_items' => 'Hľadať reklamácie',
                'not_found' => 'Žiadne reklamácie',
            ],
            'public' => false,
            'show_ui' => true,
            'show_in_menu' => true,
            'menu_icon' => 'dashicons-clipboard',
            'supports' => ['title'],
            'capability_type' => 'post',
            'capabilities' => array_fill_keys([
                'edit_post', 'read_post', 'delete_post', 'edit_posts', 'edit_others_posts',
                'publish_posts', 'read_private_posts', 'delete_posts', 'delete_private_posts',
                'delete_published_posts', 'delete_others_posts', 'edit_private_posts',
                'edit_published_posts', 'create_posts',
            ], 'manage_woocommerce'),
            'map_meta_cap' => false,
            'show_in_rest' => false,
            'rewrite' => false,
        ]);
    }

    public static function register_routes(): void {
        register_rest_route(self::REST_NS, '/reklamacie', [
            [
                'methods' => WP_REST_Server::READABLE,
                'callback' => [__CLASS__, 'rest_list'],
                'permission_callback' => [__CLASS__, 'rest_permissions'],
            ],
            [
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => [__CLASS__, 'rest_create'],
                'permission_callback' => [__CLASS__, 'rest_permissions'],
            ],
        ]);

        register_rest_route(self::REST_NS, '/reklamacie/(?P<id>\d+)', [
            [
                'methods' => WP_REST_Server::EDITABLE,
                'callback' => [__CLASS__, 'rest_update'],
                'permission_callback' => [__CLASS__, 'rest_permissions'],
            ],
        ]);
    }

    // Extend Woo key authentication only to these exact claims routes. No other
    // WordPress route or Woo shipping/payment authentication is changed.
    public static function include_claims_in_wc_auth($is_wc): bool {
        if ($is_wc) return true;
        // Authentication can run before a user is resolved. URL filters may ask
        // for that same user, so never call rest_url/home_url here. Authenticate
        // only the exact route WordPress has already resolved for REST dispatch.
        global $wp;
        $route = isset($wp->query_vars['rest_route']) ? $wp->query_vars['rest_route'] : null;
        return defined('REST_REQUEST') && REST_REQUEST && is_string($route)
            && (bool) preg_match('#^/?' . preg_quote(self::REST_NS . '/reklamacie', '#') . '(?:/[0-9]+)?/?$#D', $route);
    }

    public static function rest_permissions() {
        if (current_user_can('manage_woocommerce')) return true;
        return new WP_Error('tm_claims_forbidden', 'Prístup k reklamáciám vyžaduje oprávnenie správcu obchodu.', [
            'status' => get_current_user_id() ? 403 : 401,
        ]);
    }

    private static function sanitize_text($value): string {
        // JSON parameters from WP_REST_Request are already unslashed.
        return sanitize_text_field((string) $value);
    }

    private static function status_label(string $status): string {
        $labels = [
            'received' => 'Prijatá',
            'checking' => 'Kontrolujeme',
            'approved' => 'Schválená',
            'rejected' => 'Neschválená',
            'resolved' => 'Vybavená',
        ];
        return $labels[$status] ?? 'Prijatá';
    }

    private static function normalize_status($status): string {
        $status = sanitize_key((string) $status);
        return in_array($status, ['received', 'checking', 'approved', 'rejected', 'resolved'], true) ? $status : 'received';
    }

    private static function normalize_decision($decision, string $status = ''): string {
        $decision = sanitize_key((string) $decision);
        if (in_array($decision, ['approved', 'rejected'], true)) {
            return $decision;
        }
        if (in_array($status, ['approved', 'rejected'], true)) {
            return $status;
        }
        return '';
    }

    private static function make_claim_number(): string {
        return 'R' . wp_date('Ymd') . '-' . wp_rand(1000, 9999);
    }

    private static function post_to_claim(WP_Post $post): array {
        $status = self::normalize_status(get_post_meta($post->ID, 'tm_claim_status', true));
        return [
            'wp_id' => $post->ID,
            'id' => (string) get_post_meta($post->ID, 'tm_claim_number', true),
            'customer_id' => (int) get_post_meta($post->ID, 'tm_customer_id', true),
            'customer_email' => (string) get_post_meta($post->ID, 'tm_customer_email', true),
            'order_id' => (int) get_post_meta($post->ID, 'tm_order_id', true),
            'order_number' => (string) get_post_meta($post->ID, 'tm_order_number', true),
            'product_id' => (int) get_post_meta($post->ID, 'tm_product_id', true),
            'product_name' => (string) get_post_meta($post->ID, 'tm_product_name', true),
            'product_sku' => (string) get_post_meta($post->ID, 'tm_product_sku', true),
            'reason' => (string) get_post_meta($post->ID, 'tm_claim_reason', true),
            'message' => (string) (get_post_meta($post->ID, 'tm_customer_message', true) ?: wp_strip_all_tags($post->post_content)),
            'admin_comment' => (string) get_post_meta($post->ID, 'tm_admin_comment', true),
            'decision' => self::normalize_decision(get_post_meta($post->ID, 'tm_claim_decision', true), $status),
            'admin_notes' => self::read_notes($post->ID),
            'status' => $status,
            'status_label' => self::status_label($status),
            'created_at' => get_post_time('c', true, $post),
            'updated_at' => get_post_modified_time('c', true, $post),
        ];
    }

    private static function read_notes(int $post_id): array {
        $raw = get_post_meta($post_id, 'tm_admin_notes', true);
        $notes = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
        if (!is_array($notes)) {
            return [];
        }
        return array_values(array_filter(array_map(function ($note) {
            if (!is_array($note)) return null;
            return [
                'created_at' => sanitize_text_field((string) ($note['created_at'] ?? '')),
                'author' => sanitize_text_field((string) ($note['author'] ?? 'ToneryMAXIM.sk')),
                'message' => sanitize_textarea_field((string) ($note['message'] ?? '')),
            ];
        }, $notes), function ($note) {
            return is_array($note) && $note['message'] !== '';
        }));
    }

    private static function add_note(int $post_id, string $message): void {
        $message = trim(sanitize_textarea_field($message));
        if ($message === '') return;
        $user = wp_get_current_user();
        $notes = self::read_notes($post_id);
        array_unshift($notes, [
            'created_at' => current_time('c'),
            'author' => $user && $user->display_name ? $user->display_name : 'ToneryMAXIM.sk',
            'message' => $message,
        ]);
        $notes = array_slice($notes, 0, 50);
        update_post_meta($post_id, 'tm_admin_comment', $message);
        update_post_meta($post_id, 'tm_admin_notes', wp_json_encode($notes, JSON_UNESCAPED_UNICODE));
    }

    private static function mail_headers(): array {
        $from_name = 'ToneryMAXIM.sk';
        $from_email = 'info@tonerymaxim.sk';
        return [
            'From: ' . $from_name . ' <' . $from_email . '>',
            'Reply-To: ' . $from_name . ' <' . $from_email . '>',
            'Content-Type: text/plain; charset=UTF-8',
        ];
    }

    private static function maybe_notify_customer(int $post_id, string $old_status, string $new_status, string $note): void {
        $email = sanitize_email((string) get_post_meta($post_id, 'tm_customer_email', true));
        if (!$email) return;
        if ($old_status === $new_status && trim($note) === '') return;
        $claim_number = (string) get_post_meta($post_id, 'tm_claim_number', true);
        $order_number = (string) get_post_meta($post_id, 'tm_order_number', true);
        $product_name = (string) get_post_meta($post_id, 'tm_product_name', true);
        $subject = sprintf('Aktualizácia reklamácie %s | ToneryMAXIM.sk', $claim_number);
        $body = "Dobrý deň,\n\nstav vašej reklamácie bol aktualizovaný.\n\n";
        $body .= "Reklamácia: {$claim_number}\nObjednávka: {$order_number}\nProdukt: {$product_name}\nStav: " . self::status_label($new_status) . "\n";
        if (trim($note) !== '') {
            $body .= "\nKomentár:\n" . trim($note) . "\n";
        }
        $body .= "\nToneryMAXIM.sk";
        wp_mail($email, $subject, $body, self::mail_headers());
    }

    public static function rest_list(WP_REST_Request $request): WP_REST_Response {
        $customer_id = (int) $request->get_param('customer_id');
        $customer_email = sanitize_email((string) $request->get_param('customer_email'));

        $meta_query = ['relation' => 'AND'];
        if ($customer_id > 0) {
            $meta_query[] = [
                'key' => 'tm_customer_id',
                'value' => $customer_id,
                'compare' => '=',
                'type' => 'NUMERIC',
            ];
        }
        if ($customer_email !== '') {
            $meta_query[] = [
                'key' => 'tm_customer_email',
                'value' => $customer_email,
                'compare' => '=',
            ];
        }
        $claim_number = self::sanitize_text($request->get_param('claim_number') ?? '');
        if ($claim_number !== '') {
            $meta_query[] = ['key' => 'tm_claim_number', 'value' => $claim_number, 'compare' => '='];
        }

        $query_args = [
            'post_type' => self::POST_TYPE,
            'post_status' => ['publish', 'private'],
            'posts_per_page' => 100,
            'orderby' => 'date',
            'order' => 'DESC',
        ];
        if (count($meta_query) > 1) {
            $query_args['meta_query'] = $meta_query;
        }

        $posts = get_posts($query_args);
        return new WP_REST_Response([
            'ok' => true,
            'claims' => array_map([__CLASS__, 'post_to_claim'], $posts),
        ], 200);
    }

    public static function rest_create(WP_REST_Request $request): WP_REST_Response {
        $data = $request->get_json_params();
        if (!is_array($data)) {
            $data = [];
        }

        $claim_number = self::sanitize_text($data['claim_number'] ?? '') ?: self::make_claim_number();
        $customer_id = (int) ($data['customer_id'] ?? 0);
        $customer_email = sanitize_email((string) ($data['customer_email'] ?? ''));
        $order_id = (int) ($data['order_id'] ?? 0);
        $order_number = self::sanitize_text($data['order_number'] ?? '');
        $product_id = (int) ($data['product_id'] ?? 0);
        $product_name = self::sanitize_text($data['product_name'] ?? '');
        $product_sku = self::sanitize_text($data['product_sku'] ?? '');
        $reason = self::sanitize_text($data['reason'] ?? '');
        $message = trim((string) ($data['message'] ?? ''));
        $status = self::normalize_status($data['status'] ?? 'received');

        if ($customer_id < 0 || !$customer_email || $order_id <= 0 || !$order_number || $product_id <= 0 || !$product_name || !$reason || mb_strlen($message) < 8) {
            return new WP_REST_Response([
                'ok' => false,
                'error' => 'Chýbajú povinné údaje reklamácie.',
            ], 400);
        }

        // A guest has customer_id=0. Verify the real purchase instead of inventing
        // an account or accepting an arbitrary combination of email and order.
        $order = function_exists('wc_get_order') ? wc_get_order($order_id) : false;
        if (!$order || (int) $order->get_customer_id() !== $customer_id) {
            return new WP_REST_Response(['ok' => false, 'error' => 'Objednávka nepatrí k uvedenému zákazníkovi.'], 403);
        }
        $allowed_emails = [strtolower($order->get_billing_email())];
        if ($customer_id > 0) {
            $customer = get_userdata($customer_id);
            if ($customer) $allowed_emails[] = strtolower((string) $customer->user_email);
        }
        $numbers = array_map('strval', [$order->get_id(), $order->get_order_number(), $order->get_meta('tm_order_number'), $order->get_meta('gopay_order_number')]);
        if (!in_array(strtolower($customer_email), $allowed_emails, true) || !in_array($order_number, $numbers, true)) {
            return new WP_REST_Response(['ok' => false, 'error' => 'Číslo objednávky alebo e-mail nesúhlasí.'], 403);
        }
        $matched = false;
        foreach ($order->get_items() as $item) {
            if ($product_id !== (int) $item->get_product_id() && $product_id !== (int) $item->get_variation_id()) continue;
            $product = $item->get_product();
            $sku = $product ? (string) $product->get_sku() : '';
            if ($product_name === $item->get_name() && $product_sku === $sku) { $matched = true; break; }
        }
        if (!$matched) return new WP_REST_Response(['ok' => false, 'error' => 'Produkt nepatrí k vybranej objednávke.'], 400);

        // A connection-scoped advisory lock is released by MySQL if PHP exits.
        // It does not lock any order, stock or payment table.
        global $wpdb;
        $lock = 'tm_claim_' . substr(hash('sha256', $wpdb->prefix . ':' . $claim_number), 0, 48);
        if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 5)', $lock)) !== 1) {
            return new WP_REST_Response(['ok' => false, 'error' => 'Podanie sa práve spracováva. Zopakujte rovnaký pokus.'], 503);
        }
        try {
            $existing = get_posts(['post_type' => self::POST_TYPE, 'post_status' => ['publish', 'private', 'trash'],
                'posts_per_page' => 1, 'meta_key' => 'tm_claim_number', 'meta_value' => $claim_number]);
            if ($existing) {
                $claim = self::post_to_claim($existing[0]);
                foreach (compact('customer_id', 'customer_email', 'order_id', 'order_number', 'product_id', 'product_name', 'product_sku', 'reason', 'message') as $key => $value) {
                    if ($claim[$key] !== $value) return new WP_REST_Response(['ok' => false, 'error' => 'Číslo podania už patrí inej reklamácii.'], 409);
                }
                if ($existing[0]->post_status === 'trash') return new WP_REST_Response(['ok' => false, 'error' => 'Toto podanie bolo archivované.'], 409);
                return new WP_REST_Response(['ok' => true, 'claim' => $claim], 200);
            }

            $post_id = wp_insert_post([
                'post_type' => self::POST_TYPE,
                'post_status' => 'publish',
                'post_title' => wp_slash($claim_number . ' – ' . $product_name),
                'post_content' => wp_slash(sanitize_textarea_field($message)),
            ], true);

            if (is_wp_error($post_id)) {
                return new WP_REST_Response([
                    'ok' => false,
                    'error' => $post_id->get_error_message(),
                ], 500);
            }

            $meta = [
                'tm_claim_number' => $claim_number,
                'tm_claim_status' => $status,
                'tm_customer_id' => $customer_id,
                'tm_customer_email' => $customer_email,
                'tm_order_id' => $order_id,
                'tm_order_number' => $order_number,
                'tm_product_id' => $product_id,
                'tm_product_name' => $product_name,
                'tm_product_sku' => $product_sku,
                'tm_claim_reason' => $reason,
                'tm_customer_message' => $message,
            ];
            foreach ($meta as $key => $value) {
                update_post_meta($post_id, $key, is_string($value) ? wp_slash($value) : $value);
            }

            $post = get_post($post_id);
            return new WP_REST_Response([
                'ok' => true,
                'claim' => self::post_to_claim($post),
            ], 201);
        } finally {
            $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
        }
    }

    public static function rest_update(WP_REST_Request $request): WP_REST_Response {
        $post_id = (int) $request['id'];
        $post = get_post($post_id);
        if (!$post || $post->post_type !== self::POST_TYPE) {
            return new WP_REST_Response(['ok' => false, 'error' => 'Reklamácia neexistuje.'], 404);
        }

        $data = $request->get_json_params();
        $old_status = self::normalize_status(get_post_meta($post_id, 'tm_claim_status', true));
        $new_status = $old_status;
        if (isset($data['status'])) {
            $new_status = self::normalize_status($data['status']);
            update_post_meta($post_id, 'tm_claim_status', $new_status);
            if (in_array($new_status, ['approved', 'rejected'], true)) {
                update_post_meta($post_id, 'tm_claim_decision', $new_status);
            }
        }
        $admin_comment = isset($data['admin_comment']) ? sanitize_textarea_field((string) $data['admin_comment']) : '';
        if (trim($admin_comment) !== '') {
            self::add_note($post_id, $admin_comment);
        }
        self::maybe_notify_customer($post_id, $old_status, $new_status, $admin_comment);
        if (isset($data['message'])) {
            update_post_meta($post_id, 'tm_customer_message', wp_slash(trim((string) $data['message'])));
            wp_update_post([
                'ID' => $post_id,
                'post_content' => wp_slash(sanitize_textarea_field((string) $data['message'])),
            ]);
        }

        return new WP_REST_Response(['ok' => true, 'claim' => self::post_to_claim(get_post($post_id))], 200);
    }

    public static function add_meta_boxes(): void {
        add_meta_box('tm_reclamation_details', 'Detail reklamácie', [__CLASS__, 'meta_box'], self::POST_TYPE, 'normal', 'high');
    }

    public static function meta_box(WP_Post $post): void {
        wp_nonce_field('tm_reclamation_save', 'tm_reclamation_nonce');
        $status = self::normalize_status(get_post_meta($post->ID, 'tm_claim_status', true));
        $status_options = [
            'received' => 'Prijatá',
            'checking' => 'Kontrolujeme',
            'approved' => 'Schválená',
            'rejected' => 'Neschválená',
            'resolved' => 'Vybavená',
        ];
        $fields = [
            'tm_claim_number' => 'Číslo reklamácie',
            'tm_customer_email' => 'Zákazník e-mail',
            'tm_order_number' => 'Objednávka',
            'tm_product_name' => 'Produkt',
            'tm_product_sku' => 'SKU',
            'tm_claim_reason' => 'Dôvod',
        ];
        echo '<div class="tm-reklamacia-grid">';
        echo '<div class="tm-reklamacia-card">';
        echo '<h3>Stav reklamácie</h3>';
        echo '<div class="tm-status-row">';
        foreach ($status_options as $key => $label) {
            printf('<label><input type="radio" name="tm_claim_status" value="%s" %s> %s</label>', esc_attr($key), checked($status, $key, false), esc_html($label));
        }
        echo '</div>';
        echo '<h3>Údaje reklamácie</h3>';
        echo '<table class="widefat striped tm-detail-table"><tbody>';
        foreach ($fields as $key => $label) {
            printf('<tr><th>%s</th><td>%s</td></tr>', esc_html($label), esc_html((string) get_post_meta($post->ID, $key, true)));
        }
        echo '</tbody></table>';
        echo '</div>';

        echo '<div class="tm-reklamacia-card">';
        echo '<h3>Popis od zákazníka</h3>';
        echo '<p style="white-space:pre-wrap;background:#f6f7f7;border:1px solid #dcdcde;border-radius:8px;padding:12px;margin-top:0">' . esc_html((string) (get_post_meta($post->ID, 'tm_customer_message', true) ?: $post->post_content)) . '</p>';
        echo '<h3>Komentár / odpoveď zákazníkovi</h3>';
        echo '<textarea class="tm-admin-note" name="tm_admin_new_comment" placeholder="Napíšte komentár pre zákazníka. Po uložení sa zobrazí v zákazníckej zóne a môže sa odoslať e-mailom."></textarea>';
        echo '<p><label><input type="checkbox" name="tm_notify_customer" value="1" checked> Odoslať zákazníkovi e-mail o zmene</label></p>';
        echo '<p><strong>Uloženie:</strong> zmeňte stav alebo napíšte komentár a kliknite vpravo hore na <strong>Aktualizovať / Uložiť</strong>.</p>';
        echo '</div>';
        echo '</div>';

        $notes = self::read_notes($post->ID);
        echo '<div class="tm-reklamacia-card" style="margin-top:16px">';
        echo '<h3>História komentárov</h3>';
        if ($notes) {
            echo '<table class="widefat striped"><tbody>';
            foreach ($notes as $note) {
                printf('<tr><th style="width:220px">%s<br><small>%s</small></th><td>%s</td></tr>', esc_html($note['author']), esc_html($note['created_at']), nl2br(esc_html($note['message'])));
            }
            echo '</tbody></table>';
        } else {
            echo '<p>Zatiaľ bez komentárov.</p>';
        }
        echo '</div>';
    }

    public static function save_meta_box(int $post_id, WP_Post $post): void {
        if (!isset($_POST['tm_reclamation_nonce']) || !wp_verify_nonce((string) $_POST['tm_reclamation_nonce'], 'tm_reclamation_save')) {
            return;
        }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        if (!current_user_can('edit_post', $post_id)) {
            return;
        }
        $old_status = self::normalize_status(get_post_meta($post_id, 'tm_claim_status', true));
        $new_status = $old_status;
        if (isset($_POST['tm_claim_status'])) {
            $new_status = self::normalize_status($_POST['tm_claim_status']);
            update_post_meta($post_id, 'tm_claim_status', $new_status);
            if (in_array($new_status, ['approved', 'rejected'], true)) {
                update_post_meta($post_id, 'tm_claim_decision', $new_status);
            }
        }
        $note = isset($_POST['tm_admin_new_comment']) ? sanitize_textarea_field((string) wp_unslash($_POST['tm_admin_new_comment'])) : '';
        if (trim($note) !== '') {
            self::add_note($post_id, $note);
        }
        if (isset($_POST['tm_notify_customer'])) {
            self::maybe_notify_customer($post_id, $old_status, $new_status, $note);
        }
    }

    public static function columns(array $columns): array {
        return [
            'cb' => $columns['cb'] ?? '',
            'title' => 'Reklamácia',
            'tm_claim_number' => 'Číslo',
            'tm_customer' => 'Zákazník',
            'tm_order' => 'Objednávka',
            'tm_product' => 'Produkt',
            'tm_status' => 'Stav',
            'date' => 'Dátum',
        ];
    }

    public static function column_content(string $column, int $post_id): void {
        if ($column === 'tm_claim_number') echo esc_html((string) get_post_meta($post_id, 'tm_claim_number', true));
        if ($column === 'tm_customer') echo esc_html((string) get_post_meta($post_id, 'tm_customer_email', true));
        if ($column === 'tm_order') echo esc_html((string) get_post_meta($post_id, 'tm_order_number', true));
        if ($column === 'tm_product') echo esc_html((string) get_post_meta($post_id, 'tm_product_name', true));
        if ($column === 'tm_status') echo esc_html(self::status_label(self::normalize_status(get_post_meta($post_id, 'tm_claim_status', true))));
    }
}

Tonerymaxim_Reklamacie_Plugin::init();
