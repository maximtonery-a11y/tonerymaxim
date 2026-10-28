<?php
/**
 * Plugin Name: ToneryMaxim – Customer Administration
 * Description: Produkčná administrácia zákazníkov a TM objednávok: úplná editácia položiek, dopravy, platby, adries, výdajných miest, stavov, vernostných bodov, kupónov a reklamácií.
 * Version: 6.1.2
 * Author: ToneryMaxim.sk
 * Requires Plugins: woocommerce
 * Requires PHP: 8.0
 */

if (!defined('ABSPATH')) exit;

final class TM_Customer_Administration_V1 {
    const VERSION = '6.1.2';
    const MENU_SLUG = 'tm-customers';
    const NONCE = 'tm_customer_admin_nonce';

    const META_SOURCE = 'source';
    const META_CHANNEL = 'sales_channel';
    const META_POINTS = 'tm_loyalty_points';
    const META_HISTORY = 'tm_loyalty_history';
    const META_COUPONS = 'tm_coupon_wallet';
    const META_PRINTERS = 'tm_saved_printers';
    const META_REWARDS = 'tm_rewards';
    const META_NOTES = 'tm_admin_notes';

    public static function init(): void {
        add_action('admin_menu', [__CLASS__, 'admin_menu']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'assets']);
        add_action('admin_post_tm_customer_save_profile', [__CLASS__, 'save_profile']);
        add_action('admin_post_tm_customer_adjust_points', [__CLASS__, 'adjust_points']);
        add_action('admin_post_tm_customer_add_coupon', [__CLASS__, 'add_coupon']);
        add_action('admin_post_tm_customer_coupon_status', [__CLASS__, 'coupon_status']);
        add_action('admin_post_tm_customer_save_notes', [__CLASS__, 'save_notes']);
        add_action('admin_post_tm_customer_delete_printer', [__CLASS__, 'delete_printer']);
        add_action('admin_post_tm_order_update_status', [__CLASS__, 'update_order_status']);
        add_action('admin_post_tm_order_save_full', [__CLASS__, 'save_full_order']);
        add_action('admin_notices', [__CLASS__, 'woocommerce_notice']);
        add_action('admin_menu', [__CLASS__, 'connect_reklamacie_menu'], 999);
        add_action('init', [__CLASS__, 'register_tm_order_statuses'], 20);
        add_filter('wc_order_statuses', [__CLASS__, 'add_tm_order_statuses']);
        add_action('admin_post_tm_save_email_templates', [__CLASS__, 'save_email_templates']);
        add_action('admin_post_tm_add_email_template', [__CLASS__, 'add_email_template']);
        add_action('woocommerce_order_status_changed', [__CLASS__, 'order_status_changed'], 20, 4);
        add_action('woocommerce_after_order_object_save', [__CLASS__, 'advance_status_email_queue'], 20, 2);

        // ToneryMaxim zákaznícke e-maily odosiela Astro cez info@tonerymaxim.sk.
        // Woo/WordPress e-maily pre TM účty a TM objednávky sa vypnú, aby nevznikali duplicity z coloriq.store.
        add_filter('woocommerce_email_enabled_customer_new_account', [__CLASS__, 'disable_tm_customer_account_email'], 100, 3);
        add_filter('woocommerce_email_enabled_customer_reset_password', [__CLASS__, 'disable_tm_customer_account_email'], 100, 3);
        add_filter('wp_send_new_user_notification_to_user', [__CLASS__, 'disable_tm_wp_user_email'], 100, 2);
        foreach ([
            'new_order','cancelled_order','failed_order','customer_on_hold_order','customer_processing_order',
            'customer_completed_order','customer_refunded_order','customer_invoice','customer_note'
        ] as $email_id) {
            add_filter('woocommerce_email_enabled_' . $email_id, [__CLASS__, 'disable_tm_order_email'], 100, 3);
        }
    }

    public static function woocommerce_notice(): void {
        if (!current_user_can('manage_woocommerce') || class_exists('WooCommerce')) return;
        echo '<div class="notice notice-error"><p><strong>ToneryMaxim Customer Administration:</strong> WooCommerce nie je aktívny.</p></div>';
    }

    public static function admin_menu(): void {
        add_menu_page(
            'ToneryMaxim zákazníci',
            'TM zákazníci',
            'manage_woocommerce',
            self::MENU_SLUG,
            [__CLASS__, 'render_page'],
            'dashicons-groups',
            56
        );
        add_submenu_page(self::MENU_SLUG, 'Zákazníci', 'Zákazníci', 'manage_woocommerce', self::MENU_SLUG, [__CLASS__, 'render_page']);
        add_submenu_page(self::MENU_SLUG, 'TM objednávky', 'TM objednávky', 'manage_woocommerce', self::MENU_SLUG . '-orders', [__CLASS__, 'render_orders_page']);
        add_submenu_page(self::MENU_SLUG, 'Vernostné body', 'Vernostné body', 'manage_woocommerce', self::MENU_SLUG . '-loyalty', [__CLASS__, 'render_loyalty_page']);
        add_submenu_page(self::MENU_SLUG, 'Kupóny', 'Kupóny', 'manage_woocommerce', self::MENU_SLUG . '-coupons', [__CLASS__, 'render_coupons_page']);
        add_submenu_page(self::MENU_SLUG, 'TM reklamácie', 'TM reklamácie', 'manage_woocommerce', self::MENU_SLUG . '-reklamacie', [__CLASS__, 'render_reklamacie_bridge']);
        add_submenu_page(self::MENU_SLUG, 'E-mailové šablóny', 'E-mailové šablóny', 'manage_woocommerce', self::MENU_SLUG . '-emails', [__CLASS__, 'render_email_templates']);
    }

    public static function assets(string $hook): void {
        if (strpos($hook, 'tm-customers') === false && strpos($hook, 'tm-reklam') === false) return;
        wp_register_style('tm-customer-admin', false, [], self::VERSION);
        wp_enqueue_style('tm-customer-admin');
        wp_add_inline_style('tm-customer-admin', self::css());
    }

    private static function css(): string {
        return <<<'CSS'
.tm-wrap{max-width:1500px;margin:24px 20px 40px 0;color:#10213d}.tm-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:20px}.tm-head h1{font-size:30px;line-height:1.15;margin:0}.tm-muted{color:#68758a}.tm-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px}.tm-card{background:#fff;border:1px solid #dce5f1;border-radius:16px;padding:20px;box-shadow:0 8px 30px rgba(15,42,79,.06)}.tm-card h2,.tm-card h3{margin-top:0}.tm-span-3{grid-column:span 3}.tm-span-4{grid-column:span 4}.tm-span-5{grid-column:span 5}.tm-span-6{grid-column:span 6}.tm-span-7{grid-column:span 7}.tm-span-8{grid-column:span 8}.tm-span-12{grid-column:span 12}.tm-stat strong{display:block;font-size:27px;margin-top:8px}.tm-table{width:100%;border-collapse:collapse}.tm-table th,.tm-table td{padding:12px 10px;border-bottom:1px solid #e7edf5;text-align:left;vertical-align:top}.tm-table th{font-size:12px;text-transform:uppercase;color:#68758a}.tm-table tr:last-child td{border-bottom:0}.tm-badge{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:700;background:#edf4ff;color:#1264d5}.tm-badge.green{background:#e7f8ef;color:#087f42}.tm-badge.red{background:#fff0f0;color:#b42318}.tm-badge.gray{background:#eef1f5;color:#475467}.tm-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.tm-field label{display:block;font-weight:700;margin-bottom:5px}.tm-field input,.tm-field select,.tm-field textarea{width:100%;max-width:none}.tm-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.tm-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}.tm-tabs a{padding:9px 13px;border-radius:10px;text-decoration:none;background:#fff;border:1px solid #dce5f1;font-weight:700}.tm-tabs a.active{background:#102a4f;color:#fff;border-color:#102a4f}.tm-customer-name{font-weight:800;font-size:15px}.tm-empty{padding:30px;text-align:center;color:#68758a}.tm-search{display:flex;gap:8px}.tm-search input{min-width:300px}.tm-danger{color:#b42318}.tm-success{color:#087f42}.tm-json{font-family:monospace;white-space:pre-wrap;font-size:12px;background:#f7f9fc;border-radius:10px;padding:10px}.tm-order-link{text-decoration:none;font-weight:700}.tm-note{padding:11px 13px;background:#f5f8fc;border-radius:10px;margin-bottom:8px}.tm-avatar{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:#102a4f;color:white;font-size:18px;font-weight:800}.tm-profile-head{display:flex;gap:15px;align-items:center}.tm-kpi{font-size:13px;color:#68758a}.tm-kpi strong{display:block;color:#10213d;font-size:24px;margin-top:5px}@media(max-width:1100px){.tm-span-3,.tm-span-4,.tm-span-5,.tm-span-6,.tm-span-7,.tm-span-8{grid-column:span 12}}@media(max-width:700px){.tm-form-grid{grid-template-columns:1fr}.tm-head{align-items:flex-start;flex-direction:column}.tm-search{width:100%}.tm-search input{min-width:0;flex:1}.tm-wrap{margin-right:10px}.tm-table{display:block;overflow:auto}}
CSS;
    }

    public static function render_page(): void {
        self::guard();
        $customer_id = isset($_GET['customer_id']) ? absint($_GET['customer_id']) : 0;
        if ($customer_id) self::render_customer_detail($customer_id);
        else self::render_customer_list();
    }

    public static function render_orders_page(): void {
        self::guard();
        $detail_id = isset($_GET['order_id']) ? absint($_GET['order_id']) : 0;
        if ($detail_id) { self::render_tm_order_detail($detail_id); return; }
        $status = sanitize_key(wp_unslash($_GET['status'] ?? ''));
        $search = sanitize_text_field(wp_unslash($_GET['s'] ?? ''));
        $page = max(1, absint($_GET['paged'] ?? 1));
        $per_page = 30;

        $orders = self::tm_orders(500);
        if ($status !== '') $orders = array_values(array_filter($orders, fn($order) => $order->get_status() === $status));
        if ($search !== '') {
            $needle = mb_strtolower($search);
            $orders = array_values(array_filter($orders, function($order) use ($needle) {
                $haystack = implode(' ', [
                    $order->get_order_number(), $order->get_billing_first_name(), $order->get_billing_last_name(),
                    $order->get_billing_email(), $order->get_billing_phone(), $order->get_meta('tm_order_number')
                ]);
                return str_contains(mb_strtolower($haystack), $needle);
            }));
        }
        $total = count($orders);
        $orders = array_slice($orders, ($page - 1) * $per_page, $per_page);
        $pages = max(1, (int)ceil($total / $per_page));
        ?>
        <div class="wrap tm-wrap">
            <div class="tm-head">
                <div><h1>TM objednávky</h1><p class="tm-muted">Iba objednávky vytvorené cez ToneryMaxim.sk / tonerymaxim.info.</p></div>
                <form class="tm-search" method="get"><input type="hidden" name="page" value="<?php echo esc_attr(self::MENU_SLUG . '-orders'); ?>"><input type="search" name="s" value="<?php echo esc_attr($search); ?>" placeholder="Číslo, meno, e-mail…"><button class="button button-primary">Hľadať</button></form>
            </div>
            <?php self::notice(); ?>
            <div class="tm-card">
                <form method="get" class="tm-actions" style="margin-bottom:14px"><input type="hidden" name="page" value="<?php echo esc_attr(self::MENU_SLUG . '-orders'); ?>"><select name="status"><option value="">Všetky stavy</option><?php foreach (wc_get_order_statuses() as $key => $label): $value = str_replace('wc-', '', $key); ?><option value="<?php echo esc_attr($value); ?>" <?php selected($status, $value); ?>><?php echo esc_html($label); ?></option><?php endforeach; ?></select><button class="button">Filtrovať</button></form>
                <table class="tm-table"><thead><tr><th>Objednávka</th><th>Zákazník</th><th>Dátum</th><th>Platba / doprava</th><th>Celkom</th><th>Stav</th><th></th></tr></thead><tbody>
                <?php if (!$orders): ?><tr><td colspan="7" class="tm-empty">Nenašli sa žiadne TM objednávky.</td></tr><?php endif; ?>
                <?php foreach ($orders as $order): $edit = add_query_arg(['page'=>self::MENU_SLUG.'-orders','order_id'=>$order->get_id()], admin_url('admin.php')); ?>
                    <tr>
                        <td><a class="tm-order-link" href="<?php echo esc_url($edit); ?>">#<?php echo esc_html($order->get_order_number()); ?></a><br><span class="tm-muted"><?php echo esc_html((string)$order->get_meta('tm_order_number')); ?></span></td>
                        <td><strong><?php echo esc_html(trim($order->get_formatted_billing_full_name()) ?: 'Neregistrovaný'); ?></strong><br><a href="mailto:<?php echo esc_attr($order->get_billing_email()); ?>"><?php echo esc_html($order->get_billing_email()); ?></a></td>
                        <td><?php echo esc_html($order->get_date_created() ? wc_format_datetime($order->get_date_created()) : '—'); ?></td>
                        <td><?php echo esc_html($order->get_payment_method_title() ?: '—'); ?><br><span class="tm-muted"><?php echo esc_html($order->get_shipping_method() ?: '—'); ?></span></td>
                        <td><?php echo wp_kses_post(self::formatted_gross_order_total($order)); ?></td>
                        <td>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="tm-actions">
                                <input type="hidden" name="action" value="tm_order_update_status"><input type="hidden" name="order_id" value="<?php echo (int)$order->get_id(); ?>"><?php wp_nonce_field(self::NONCE); ?>
                                <select name="order_status" aria-label="Stav objednávky"><?php self::render_status_email_options($order->get_status()); ?></select>
                                <button class="button">Uložiť</button>
                            </form>
                        </td>
                        <td><a class="button" href="<?php echo esc_url($edit); ?>">Detail</a></td>
                    </tr>
                <?php endforeach; ?>
                </tbody></table>
                <?php if ($pages > 1): ?><div class="tablenav"><div class="tablenav-pages"><?php echo wp_kses_post(paginate_links(['base'=>add_query_arg('paged','%#%'),'format'=>'','current'=>$page,'total'=>$pages])); ?></div></div><?php endif; ?>
            </div>
        </div><?php
    }

    public static function update_order_status(): void {
        self::verify();
        $order_id = absint($_POST['order_id'] ?? 0);
        $status = sanitize_key(wp_unslash($_POST['order_status'] ?? ''));
        $order = wc_get_order($order_id);
        if (!$order || !self::is_tm_order($order) || !array_key_exists('wc-' . $status, wc_get_order_statuses())) {
            wp_safe_redirect(add_query_arg(['page'=>self::MENU_SLUG.'-orders','tm_error'=>'Objednávku alebo stav sa nepodarilo overiť.'], admin_url('admin.php'))); exit;
        }
        $templates = self::email_templates();
        $template = $templates[$status] ?? ['subject'=>'','message'=>''];
        $order->update_meta_data('_tm_email_subject', (string)($template['subject'] ?? ''));
        $order->update_meta_data('_tm_email_message', (string)($template['message'] ?? ''));
        $order->update_status($status, 'Stav zmenený v TM Customer Administration.', true);
        wp_safe_redirect(add_query_arg(['page'=>self::MENU_SLUG.'-orders','order_id'=>$order_id,'tm_notice'=>'Stav objednávky bol zmenený. Astro e-mailová fronta odošle zákazníkovi správu z ToneryMaxim.sk.'], admin_url('admin.php'))); exit;
    }

    private static function tm_orders(int $limit = 500): array {
        if (!function_exists('wc_get_orders')) return [];
        $orders = wc_get_orders(['limit'=>$limit,'orderby'=>'date','order'=>'DESC','return'=>'objects']);
        return array_values(array_filter($orders, fn($order) => self::is_tm_order($order)));
    }

    private static function is_tm_order($order): bool {
        if (!$order || !is_a($order, 'WC_Order')) return false;
        $values = [
            $order->get_meta('source'), $order->get_meta('sales_channel'), $order->get_meta('created_via'),
            method_exists($order, 'get_created_via') ? $order->get_created_via() : '', $order->get_meta('tm_order_number')
        ];
        foreach ($values as $value) if (str_contains(strtolower((string)$value), 'tonerymaxim') || str_starts_with((string)$value, 'TM-')) return true;
        return false;
    }

    public static function disable_tm_order_email($enabled, $object = null, $email = null) {
        $order = $object instanceof WC_Order ? $object : (is_numeric($object) ? wc_get_order((int)$object) : null);
        return $order && self::is_tm_order($order) ? false : $enabled;
    }

    public static function disable_tm_customer_account_email($enabled, $object = null, $email = null) {
        $user_id = 0;
        if ($object instanceof WP_User) $user_id = (int)$object->ID;
        elseif (is_object($object) && isset($object->ID)) $user_id = (int)$object->ID;
        elseif (is_numeric($object)) $user_id = (int)$object;
        if (($user_id && self::is_tm_customer($user_id)) || self::current_request_is_tm()) return false;
        return $enabled;
    }

    public static function disable_tm_wp_user_email($send, $user) {
        $user_id = $user instanceof WP_User ? (int)$user->ID : 0;
        return (($user_id && self::is_tm_customer($user_id)) || self::current_request_is_tm()) ? false : $send;
    }

    private static function current_request_is_tm(): bool {
        $uri = strtolower((string)($_SERVER['REQUEST_URI'] ?? ''));
        if (!str_contains($uri, '/wp-json/wc/') || !str_contains($uri, '/customers')) return false;
        $raw = file_get_contents('php://input');
        return is_string($raw) && (str_contains(strtolower($raw), 'tonerymaxim') || str_contains($raw, 'tm_welcome_discount_percent'));
    }

    public static function connect_reklamacie_menu(): void {
        global $menu, $submenu;
        if (!is_array($menu)) return;
        $target = '';
        $label = 'TM reklamácie';
        foreach ($menu as $index => $item) {
            $text = strtolower(wp_strip_all_tags((string)($item[0] ?? '')));
            $slug = (string)($item[2] ?? '');
            if ($slug === self::MENU_SLUG || !str_contains($text, 'reklam')) continue;
            $target = $slug;
            $label = wp_strip_all_tags((string)($item[0] ?? $label));
            unset($menu[$index]);
            break;
        }
        if ($target !== '') {
            $submenu[self::MENU_SLUG][] = [$label, 'manage_woocommerce', $target];
            update_option('tm_customer_admin_reklamacie_target', $target, false);
        }
    }

    public static function render_reklamacie_bridge(): void {
        self::guard();
        $target = (string)get_option('tm_customer_admin_reklamacie_target', '');
        ?>
        <div class="wrap tm-wrap"><div class="tm-head"><div><h1>TM reklamácie</h1><p class="tm-muted">Reklamačný systém je pripojený k jednotnej administrácii.</p></div></div><div class="tm-card">
        <?php if ($target): ?><p><a class="button button-primary button-large" href="<?php echo esc_url(str_contains($target, '.php') ? admin_url($target) : admin_url('admin.php?page='.$target)); ?>">Otvoriť TM reklamácie</a></p>
        <?php else: ?><div class="notice notice-warning inline"><p>Plugin TM Reklamácie nebol rozpoznaný. Nechajte ho aktívny a obnovte túto stránku.</p></div><?php endif; ?>
        <p class="tm-muted">Existujúci plugin TM Reklamácie zostáva aktívny ako dátový a procesný modul; jeho administrácia je dostupná z tohto menu.</p></div></div><?php
    }


    public static function register_tm_order_statuses(): void {
        $statuses = self::tm_status_labels();
        foreach ($statuses as $slug => $label) {
            register_post_status('wc-' . $slug, [
                'label' => $label,
                'public' => true,
                'exclude_from_search' => false,
                'show_in_admin_all_list' => true,
                'show_in_admin_status_list' => true,
                'label_count' => _n_noop($label . ' <span class="count">(%s)</span>', $label . ' <span class="count">(%s)</span>'),
            ]);
        }
    }

    public static function add_tm_order_statuses(array $statuses): array {
        $result = [];
        foreach ($statuses as $key => $label) {
            $result[$key] = $label;
            if ($key === 'wc-on-hold') {
                foreach (self::tm_status_labels() as $slug => $tm_label) $result['wc-'.$slug] = $tm_label;
            }
        }
        // Zachová vlastné stavy aj v prípade, že iný plugin odstráni on-hold.
        foreach (self::tm_status_labels() as $slug => $label) $result['wc-'.$slug] = $label;
        return $result;
    }

    private static function tm_status_labels(): array {
        $labels = [
            'tm-await-pay' => 'Čaká na úhradu',
            'tm-paid' => 'Platba prijatá',
            'tm-processing' => 'Objednávka sa vybavuje',
            'tm-shipped' => 'Expedovaná',
            'tm-returned' => 'Vrátená',
        ];
        // Stabilný identifikátor šablóny je zároveň skutočným Woo stavom.
        // S prefixom wc- má 19 znakov, takže sa zmestí aj do post_status.
        foreach (self::email_templates() as $slug => $template) {
            if (preg_match('/^tm-mail-[a-f0-9]{8}$/', (string)$slug) && is_array($template) && is_string($template['label'] ?? null) && trim($template['label']) !== '') {
                $labels[$slug] = $template['label'];
            }
        }
        return $labels;
    }

    private static function default_email_templates(): array {
        return [
            'tm-await-pay' => ['subject'=>'Objednávka č. {order_number} čaká na úhradu | ToneryMAXIM.sk','message'=>'Objednávku evidujeme. Po prijatí úhrady ju začneme pripravovať.'],
            'tm-paid' => ['subject'=>'Platba objednávky č. {order_number} bola prijatá | ToneryMAXIM.sk','message'=>'Platbu sme úspešne prijali. Objednávku pripravujeme na vybavenie.'],
            'tm-processing' => ['subject'=>'Objednávka č. {order_number} sa vybavuje | ToneryMAXIM.sk','message'=>'Objednávku práve kompletizujeme a pripravujeme na expedíciu.'],
            'tm-shipped' => ['subject'=>'Objednávka č. {order_number} bola expedovaná | ToneryMAXIM.sk','message'=>'Objednávku sme odovzdali dopravcovi. O doručení vás bude informovať kuriér.'],
            'tm-returned' => ['subject'=>'Objednávka č. {order_number} bola vrátená | ToneryMAXIM.sk','message'=>'Pri objednávke sme zaevidovali vrátenie. O ďalšom postupe vás budeme informovať.'],
        ];
    }

    private static function email_templates(): array {
        $saved = get_option('tm_customer_admin_email_templates', []);
        return array_replace_recursive(self::default_email_templates(), is_array($saved) ? $saved : []);
    }

    private static function email_template_labels(): array {
        return self::tm_status_labels();
    }

    public static function render_email_templates(): void {
        self::guard();
        $templates = self::email_templates();
        $labels = self::email_template_labels(); ?>
        <div class="wrap tm-wrap">
        <div class="tm-head"><div><h1>E-mailové šablóny</h1><p class="tm-muted">Každá vlastná šablóna má vlastný stav objednávky s rovnakým názvom. Výberom tohto stavu objednávku skutočne prepnete do nového stavu a zákazníkovi sa odošle príslušný e-mail.</p><p class="tm-muted">Premenná <code>{order_number}</code> sa nahradí číslom objednávky. Text môže obsahovať nové riadky a <code>**tučné zvýraznenie**</code>.</p></div><a class="button button-primary" href="#tm-new-email-template">Pridať novú šablónu</a></div>
        <?php self::notice(); ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="tm_save_email_templates"><?php wp_nonce_field(self::NONCE); ?>
        <div class="tm-grid"><?php foreach ($labels as $slug => $label): $t = $templates[$slug] ?? []; $custom = (bool)preg_match('/^tm-mail-[a-f0-9]{8}$/', $slug); ?>
        <div class="tm-card tm-span-6"><h2><?php echo esc_html($label); ?></h2>
        <?php if ($custom): ?><div class="tm-field" style="margin-bottom:12px"><label for="<?php echo esc_attr($slug.'-label'); ?>">Názov stavu a šablóny</label><input id="<?php echo esc_attr($slug.'-label'); ?>" name="templates[<?php echo esc_attr($slug); ?>][label]" maxlength="120" required value="<?php echo esc_attr($label); ?>"></div><?php endif; ?>
        <div class="tm-field"><label for="<?php echo esc_attr($slug.'-subject'); ?>">Predmet</label><input id="<?php echo esc_attr($slug.'-subject'); ?>" name="templates[<?php echo esc_attr($slug); ?>][subject]" maxlength="250" <?php if ($custom) echo 'required'; ?> value="<?php echo esc_attr($t['subject'] ?? ''); ?>"></div>
        <div class="tm-field" style="margin-top:12px"><label for="<?php echo esc_attr($slug.'-message'); ?>">Text správy</label><textarea id="<?php echo esc_attr($slug.'-message'); ?>" rows="6" maxlength="20000" <?php if ($custom) echo 'required'; ?> name="templates[<?php echo esc_attr($slug); ?>][message]"><?php echo esc_textarea($t['message'] ?? ''); ?></textarea></div></div>
        <?php endforeach; ?></div><p><button class="button button-primary button-large">Uložiť šablóny</button></p></form>
        <div class="tm-card" id="tm-new-email-template" style="margin-top:28px;max-width:760px"><h2>Pridať novú e-mailovú šablónu</h2><p class="tm-muted">Vytvorením šablóny pridáte aj nový stav objednávky. E-mail sa odošle až pri prepnutí objednávky do tohto stavu.</p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="tm_add_email_template"><?php wp_nonce_field(self::NONCE); ?>
        <div class="tm-field"><label for="tm-template-name">Názov nového stavu a šablóny</label><input id="tm-template-name" name="template_label" maxlength="120" required placeholder="Napr. Čakáme na naskladnenie"></div>
        <div class="tm-field" style="margin-top:12px"><label for="tm-template-subject">Predmet novej šablóny</label><input id="tm-template-subject" name="template_subject" maxlength="250" required placeholder="Informácia k objednávke č. {order_number} | ToneryMAXIM.sk"></div>
        <div class="tm-field" style="margin-top:12px"><label for="tm-template-message">Text novej šablóny</label><textarea id="tm-template-message" name="template_message" rows="7" maxlength="20000" required></textarea></div>
        <p><button class="button button-primary button-large">Vytvoriť šablónu</button></p></form></div></div><?php
    }

    public static function save_email_templates(): void {
        self::verify();
        $raw = isset($_POST['templates']) && is_array($_POST['templates']) ? wp_unslash($_POST['templates']) : [];
        $clean = self::email_templates();
        foreach (self::email_template_labels() as $slug => $label) {
            if (!isset($raw[$slug]) || !is_array($raw[$slug])) continue;
            $row = $raw[$slug];
            if (!is_string($row['subject'] ?? null) || !is_string($row['message'] ?? null)) continue;
            $clean[$slug]['subject'] = mb_substr(sanitize_text_field($row['subject']), 0, 250);
            $clean[$slug]['message'] = mb_substr(sanitize_textarea_field($row['message']), 0, 20000);
            if (preg_match('/^tm-mail-[a-f0-9]{8}$/', $slug) && ($clean[$slug]['subject'] === '' || $clean[$slug]['message'] === '')) self::redirect_templates('Vlastný stav musí mať vyplnený predmet aj text e-mailu.', true);
            if (preg_match('/^tm-mail-[a-f0-9]{8}$/', $slug) && is_string($row['label'] ?? null)) {
                $new_label = mb_substr(sanitize_text_field($row['label']), 0, 120);
                if ($new_label !== '') $clean[$slug]['label'] = $new_label;
            }
        }
        update_option('tm_customer_admin_email_templates', $clean, false);
        self::redirect_templates('E-mailové šablóny boli uložené.');
    }

    private static function redirect_templates(string $message, bool $error = false): void {
        wp_safe_redirect(add_query_arg(['page'=>self::MENU_SLUG.'-emails', ($error ? 'tm_error' : 'tm_notice')=>$message], admin_url('admin.php'))); exit;
    }

    public static function add_email_template(): void {
        self::verify();
        $raw = wp_unslash($_POST);
        foreach (['template_label', 'template_subject', 'template_message'] as $key) {
            if (!isset($raw[$key]) || !is_string($raw[$key]) || trim($raw[$key]) === '') self::redirect_templates('Vyplňte názov, predmet aj text novej šablóny.', true);
        }
        $label = mb_substr(sanitize_text_field($raw['template_label']), 0, 120);
        $subject = mb_substr(sanitize_text_field($raw['template_subject']), 0, 250);
        $message = mb_substr(sanitize_textarea_field($raw['template_message']), 0, 20000);
        if ($label === '' || $subject === '' || $message === '') self::redirect_templates('Vyplňte názov, predmet aj text novej šablóny.', true);
        $templates = self::email_templates();
        do { $slug = 'tm-mail-' . substr(str_replace('-', '', wp_generate_uuid4()), 0, 8); } while (isset($templates[$slug]));
        $templates[$slug] = ['label'=>$label, 'subject'=>$subject, 'message'=>$message];
        update_option('tm_customer_admin_email_templates', $templates, false);
        self::redirect_templates('Nový stav objednávky a e-mailová šablóna boli vytvorené. Stav je dostupný pri úprave aj filtrovaní objednávok.');
    }

    public static function order_status_changed(int $order_id, string $from, string $to, $order = null): void {
        $order = $order ?: wc_get_order($order_id);
        if ($from === $to || !$order || !self::is_tm_order($order)) return;
        $template = self::email_templates()[$to] ?? [];
        // Platí aj pri zmene cez štandardný Woo editor, hromadnú akciu či REST.
        // Vymaže tiež starý text pri prechode na iný bežný stav.
        $order->update_meta_data('_tm_email_subject', (string)($template['subject'] ?? ''));
        $order->update_meta_data('_tm_email_message', (string)($template['message'] ?? ''));
        if (preg_match('/^tm-mail-[a-f0-9]{8}$/', $to) && isset(self::tm_status_labels()[$to])) {
            if (empty($template['subject']) || empty($template['message'])) {
                $order->update_meta_data('_tm_email_template_last_error', 'Doplňte predmet a text e-mailovej šablóny pre tento stav.');
            } else {
                $request = ['id'=>wp_generate_uuid4(), 'template_slug'=>$to, 'label'=>self::tm_status_labels()[$to], 'subject'=>$template['subject'], 'message'=>$template['message'], 'created_at'=>gmdate('c')];
                $pending = json_decode((string)$order->get_meta('_tm_email_template_request', true), true);
                if (is_array($pending) && !empty($pending['id']) && $pending['id'] !== (string)$order->get_meta('_tm_email_template_sent_id', true)) {
                    $backlog = json_decode((string)$order->get_meta('_tm_email_template_backlog', true), true);
                    $backlog = is_array($backlog) ? $backlog : [];
                    $backlog[] = $request;
                    $order->update_meta_data('_tm_email_template_backlog', wp_json_encode($backlog, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                } else {
                    $order->update_meta_data('_tm_email_template_request', wp_json_encode($request, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                    $order->delete_meta_data('_tm_email_template_last_error');
                }
            }
        }
        $order->save();
    }

    public static function advance_status_email_queue($order, $data_store = null): void {
        static $advancing = false;
        if ($advancing || !$order || !self::is_tm_order($order)) return;
        $backlog = json_decode((string)$order->get_meta('_tm_email_template_backlog', true), true);
        if (!is_array($backlog) || !$backlog) return;
        $pending = json_decode((string)$order->get_meta('_tm_email_template_request', true), true);
        if (is_array($pending) && !empty($pending['id']) && $pending['id'] !== (string)$order->get_meta('_tm_email_template_sent_id', true)) return;
        // Astro zapíše potvrdenie odoslania cez Woo REST. Tento save uvoľní
        // ďalšiu správu; rýchle zmeny stavov tak neprepisujú čakajúce e-maily.
        $advancing = true;
        try {
            $next = array_shift($backlog);
            $order->update_meta_data('_tm_email_template_request', wp_json_encode($next, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            if ($backlog) $order->update_meta_data('_tm_email_template_backlog', wp_json_encode(array_values($backlog), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            else $order->delete_meta_data('_tm_email_template_backlog');
            $order->delete_meta_data('_tm_email_template_last_error');
            $order->set_date_modified(time());
            $order->save();
        } finally {
            $advancing = false;
        }
    }

    private static function render_status_email_options(string $current_status): void {
        foreach (wc_get_order_statuses() as $key => $label) {
            $value = preg_replace('/^wc-/', '', $key);
            echo '<option value="'.esc_attr($value).'" '.selected($current_status, $value, false).'>'.esc_html($label).'</option>';
        }
    }

    private static function render_order_status_email_notice($order): void {
        $request = json_decode((string)$order->get_meta('_tm_email_template_request', true), true);
        $pending = is_array($request) && !empty($request['id']) && $request['id'] !== (string)$order->get_meta('_tm_email_template_sent_id', true);
        $backlog = json_decode((string)$order->get_meta('_tm_email_template_backlog', true), true);
        $last_error = (string)$order->get_meta('_tm_email_template_last_error', true);
        if ($pending) echo '<p class="tm-muted">E-mail „'.esc_html($request['label'] ?? '').'“ čaká na odoslanie.</p>';
        elseif (is_array($request) && !empty($request['id'])) echo '<p class="tm-muted">E-mail „'.esc_html($request['label'] ?? '').'“ bol odoslaný: '.esc_html((string)$order->get_meta('_tm_email_template_sent_at', true)).'</p>';
        if (is_array($backlog) && $backlog) echo '<p class="tm-muted">Ďalšie e-maily pri zmene stavu čakajú vo fronte: '.count($backlog).'.</p>';
        if ($last_error !== '') echo '<p class="tm-danger">'.esc_html($last_error).'</p>';
    }

    private static function money_gross($value): string { return wc_price((float)$value, ['currency'=>'EUR']); }
    private static function snapshot($order): array { $raw=(string)$order->get_meta('tm_order_snapshot'); $data=json_decode($raw,true); return is_array($data)?$data:[]; }

    private static function gross_order_total($order): float {
        $snapshot = self::snapshot($order);
        if (isset($snapshot['total']) && is_numeric($snapshot['total'])) return round((float)$snapshot['total'], 2);

        $meta_total = $order->get_meta('tm_order_total_gross', true);
        if ($meta_total !== '' && is_numeric($meta_total)) return round((float)$meta_total, 2);

        return round((float)$order->get_total(), 2);
    }

    private static function formatted_gross_order_total($order): string {
        return wc_price(self::gross_order_total($order), ['currency' => $order->get_currency() ?: 'EUR']);
    }

    private static function meta_first($order, array $keys): string {
        foreach ($keys as $key) {
            $value = $order->get_meta($key, true);
            if (is_scalar($value) && trim((string)$value) !== '') return trim((string)$value);
        }
        return '';
    }

    private static function pickup_data($order): array {
        $raw = $order->get_meta('tm_shipping_pickup', true);
        $decoded = [];
        if (is_string($raw) && $raw !== '') { $tmp=json_decode($raw,true); if(is_array($tmp))$decoded=$tmp; }
        elseif (is_array($raw)) $decoded=$raw;
        $pick=function(array $keys) use($decoded){foreach($keys as $key){if(isset($decoded[$key])&&trim((string)$decoded[$key])!=='')return trim((string)$decoded[$key]);}return '';};
        $data=[];
        $data['id']=self::meta_first($order,['tm_shipping_pickup_id','gls_pickup_id','gls_parcelshop_id','dpd_pickup_id','dpd_parcelshop_id','dpd_pudo_id']) ?: $pick(['pickup_id','id','pudoId','parcelshop_id']);
        $data['name']=self::meta_first($order,['tm_shipping_pickup_name','gls_parcelshop_name','dpd_pickup_name']) ?: $pick(['pickup_name','name','title','company']);
        $data['street']=self::meta_first($order,['tm_shipping_pickup_street','gls_parcelshop_address','dpd_pickup_address']) ?: $pick(['pickup_address','street','address','addressText']);
        $data['city']=self::meta_first($order,['tm_shipping_pickup_city']) ?: $pick(['pickup_city','city','town','municipality']);
        $data['zip']=self::meta_first($order,['tm_shipping_pickup_postcode']) ?: $pick(['pickup_zip','zip','postalcode','postalCode','postcode']);
        $data['country']=self::meta_first($order,['tm_shipping_pickup_country']) ?: $pick(['pickup_country','country','countrycode','countryCode']);
        $data['carrier']=self::meta_first($order,['tm_shipping_carrier']) ?: $pick(['carrier']);
        $data['type']=self::meta_first($order,['tm_shipping_pickup_type','dpd_pickup_type']) ?: $pick(['delivery_type','raw_type','type']);
        $data['address']=trim(implode(', ',array_filter([$data['street'],trim($data['zip'].' '.$data['city']),$data['country']])));
        $data['text']=self::meta_first($order,['tm_shipping_pickup_text']) ?: trim(implode(', ',array_filter([$data['name'],$data['address']])));
        return $data;
    }

    private static function gopay_state_info(string $state): array {
        $state=strtoupper(trim($state));
        $map=[
            'PAID'=>['UHRADENÉ','Platba bola úspešne prijatá.','green'],
            'AUTHORIZED'=>['AUTORIZOVANÉ','Platba je autorizovaná.','green'],
            'CREATED'=>['NEUHRADENÉ','Platba bola vytvorená, ale zatiaľ nebola uhradená.','gray'],
            'PAYMENT_METHOD_CHOSEN'=>['NEUHRADENÉ','Platobná metóda bola zvolená, úhrada ešte nebola potvrdená.','gray'],
            'CANCELED'=>['ZRUŠENÉ','Platba bola zrušená.','red'],
            'TIMEOUTED'=>['VYPRŠALA','Platnosť platby vypršala.','red'],
            'FAILED'=>['NEÚSPEŠNÉ','Platba zlyhala.','red'],
        ];
        return $map[$state]??['NEOVERENÉ','Stav platby zatiaľ nebol potvrdený GoPay.','gray'];
    }

    private static function is_payment_fee_item($fee): bool {
        if (!is_object($fee) || !method_exists($fee, 'get_name')) return false;
        if ((string) $fee->get_meta('_tm_payment_fee', true) === 'yes') return true;

        $name = strtolower(trim(wp_strip_all_tags((string) $fee->get_name())));
        $legacy_names = [
            'dobierka',
            'poplatok za dobierku',
            'poplatok za platbu',
            'online platba gopay',
            'platba online gopay',
            'gopay',
            'platba prevodom vopred',
            'platba prevodným príkazom vopred',
            'prevodný príkaz pre organizácie a firmy',
            'platba prevodom pre organizácie',
        ];
        foreach ($legacy_names as $legacy_name) {
            if ($name === $legacy_name || str_contains($name, $legacy_name)) return true;
        }

        $payment_code = strtolower((string) $fee->get_meta('tm_payment_code', true));
        return in_array($payment_code, ['cod', 'gopay', 'bank_prepaid', 'bank_organization'], true);
    }

    private static function gross_item($item, string $kind='total'): float {
        return (float)($kind==='subtotal'?$item->get_subtotal():$item->get_total())+(float)($kind==='subtotal'?$item->get_subtotal_tax():$item->get_total_tax());
    }
    private static function tax_context($order, bool $shipping = false): array {
        $args = [
            'country'   => (string) $order->get_billing_country(),
            'state'     => (string) $order->get_billing_state(),
            'postcode'  => (string) $order->get_billing_postcode(),
            'city'      => (string) $order->get_billing_city(),
            'tax_class' => '',
        ];
        $rates = class_exists('WC_Tax') ? WC_Tax::find_rates($args) : [];
        if ($shipping && class_exists('WC_Tax')) {
            $shipping_rates = WC_Tax::get_shipping_tax_rates('');
            if (is_array($shipping_rates) && $shipping_rates) $rates = $shipping_rates;
        }
        if (is_array($rates) && $rates) {
            $rate_id = (int) array_key_first($rates);
            $rate = isset($rates[$rate_id]['rate']) ? (float) $rates[$rate_id]['rate'] : 23.0;
            return [$rate_id, max(0.0, $rate)];
        }
        return [0, 23.0];
    }

    private static function gross_parts(float $gross, $order, bool $shipping = false): array {
        $gross = max(0.0, round($gross, 2));
        [$rate_id, $rate] = self::tax_context($order, $shipping);
        $net = $rate > 0 ? round($gross / (1 + $rate / 100), 2) : $gross;
        $tax = round($gross - $net, 2);
        return [$net, $tax, $rate_id];
    }

    private static function product_taxes(float $subtotal_tax, float $total_tax, int $rate_id): array {
        if ($rate_id <= 0) return ['subtotal' => [], 'total' => []];
        return ['subtotal' => [$rate_id => $subtotal_tax], 'total' => [$rate_id => $total_tax]];
    }

    private static function total_taxes(float $tax, int $rate_id): array {
        if ($rate_id <= 0) return ['total' => []];
        return ['total' => [$rate_id => $tax]];
    }

    private static function net(float $gross): float { return round($gross/1.23,2); }
    private static function tax(float $gross): float { return round($gross-self::net($gross),2); }
    private static function field(string $label,string $name,$value,string $type='text'): void { echo '<label class="tm-field"><span>'.esc_html($label).'</span><input type="'.esc_attr($type).'" step="'.($type==='number'?'0.01':''). '" name="'.esc_attr($name).'" value="'.esc_attr($value).'"></label>'; }

    private static function posted_money($value): float {
        $normalized = str_replace([' ', '€', ','], ['', '', '.'], (string)$value);
        return max(0, round((float)$normalized, 2));
    }

    private static function redirect_order_editor(int $order_id, string $message, bool $error=false): void {
        $args = ['page'=>self::MENU_SLUG.'-orders','order_id'=>$order_id,'tm_edit'=>1];
        $args[$error ? 'tm_error' : 'tm_notice'] = $message;
        wp_safe_redirect(add_query_arg($args, admin_url('admin.php')));
        exit;
    }

    public static function save_full_order(): void {
        self::verify();
        $order_id = absint($_POST['order_id'] ?? 0);
        try {
            $order = wc_get_order($order_id);
            if (!$order || !self::is_tm_order($order)) throw new RuntimeException('TM objednávka nebola nájdená.');
            $original_snapshot = self::snapshot($order);

            foreach (['billing','shipping'] as $kind) {
                foreach (['first_name','last_name','company','address_1','address_2','city','postcode','country','email','phone'] as $field) {
                    if (!isset($_POST[$kind][$field])) continue;
                    $method = 'set_'.$kind.'_'.$field;
                    if (is_callable([$order,$method])) $order->$method(wc_clean(wp_unslash($_POST[$kind][$field])));
                }
            }

            foreach (['ico'=>'billing_ico','dic'=>'billing_dic','ic_dph'=>'billing_ic_dph'] as $post=>$meta) {
                $value = sanitize_text_field(wp_unslash($_POST[$post] ?? ''));
                $order->update_meta_data($meta,$value);
                $order->update_meta_data('_'.$meta,$value);
            }

            $rows = is_array($_POST['line'] ?? null) ? wp_unslash($_POST['line']) : [];
            foreach ($order->get_items('line_item') as $item_id=>$item) {
                $row = $rows[$item_id] ?? [];
                if (!empty($row['remove'])) {
                    $order->remove_item($item_id);
                    continue;
                }
                $qty = max(1, absint($row['qty'] ?? $item->get_quantity()));
                $gross_subtotal = self::posted_money($row['gross_subtotal'] ?? self::gross_item($item,'subtotal'));
                $gross_total = self::posted_money($row['gross_total'] ?? self::gross_item($item));
                $item->set_quantity($qty);
                [$subtotal_net, $subtotal_tax, $subtotal_rate_id] = self::gross_parts($gross_subtotal, $order, false);
                [$total_net, $total_tax, $total_rate_id] = self::gross_parts($gross_total, $order, false);
                $rate_id = $total_rate_id ?: $subtotal_rate_id;
                $item->set_subtotal($subtotal_net);
                $item->set_total($total_net);
                $item->set_taxes(self::product_taxes($subtotal_tax, $total_tax, $rate_id));
                $item->update_meta_data('tm_gross_line_subtotal',number_format($gross_subtotal,2,'.',''));
                $item->update_meta_data('tm_gross_line_total',number_format($gross_total,2,'.',''));
                $item->save();
            }

            $new_identifier = sanitize_text_field(wp_unslash($_POST['new_product_identifier'] ?? ''));
            $new_name = sanitize_text_field(wp_unslash($_POST['new_product_name'] ?? ''));
            $new_qty = max(1, absint($_POST['new_product_qty'] ?? 1));
            $new_gross = self::posted_money($_POST['new_product_gross'] ?? 0);
            if ($new_identifier !== '' || $new_name !== '') {
                $product = null;
                if (ctype_digit($new_identifier)) $product = wc_get_product((int)$new_identifier);
                if (!$product && $new_identifier !== '') {
                    $product_id = wc_get_product_id_by_sku($new_identifier);
                    if ($product_id) $product = wc_get_product($product_id);
                }
                if ($new_gross <= 0 && $product) $new_gross = (float)wc_get_price_including_tax($product);
                if ($new_gross <= 0) throw new RuntimeException('Pri novom produkte zadajte cenu s DPH.');
                $item = new WC_Order_Item_Product();
                if ($product) $item->set_product($product);
                $item->set_name($new_name !== '' ? $new_name : ($product ? $product->get_name() : $new_identifier));
                $item->set_quantity($new_qty);
                $line_gross = round($new_gross * $new_qty, 2);
                [$line_net, $line_tax, $line_rate_id] = self::gross_parts($line_gross, $order, false);
                $item->set_subtotal($line_net);
                $item->set_total($line_net);
                $item->set_taxes(self::product_taxes($line_tax, $line_tax, $line_rate_id));
                $item->update_meta_data('tm_gross_line_subtotal',number_format($line_gross,2,'.',''));
                $item->update_meta_data('tm_gross_line_total',number_format($line_gross,2,'.',''));
                $order->add_item($item);
            }

            $shipping_title = sanitize_text_field(wp_unslash($_POST['shipping_title'] ?? ''));
            $shipping_method = sanitize_key(wp_unslash($_POST['shipping_method'] ?? ''));
            $shipping_gross = self::posted_money($_POST['shipping_gross'] ?? 0);
            $shipping_items = $order->get_items('shipping');
            $ship = $shipping_items ? reset($shipping_items) : null;
            if (!$ship instanceof WC_Order_Item_Shipping) {
                $ship = new WC_Order_Item_Shipping();
                $order->add_item($ship);
            }
            foreach ($shipping_items as $shipping_item_id => $shipping_item) {
                if ($shipping_item !== $ship) $order->remove_item($shipping_item_id);
            }
            $ship->set_method_title($shipping_title ?: 'Doprava');
            $ship->set_method_id($shipping_method ?: 'tm_shipping');
            [$shipping_net, $shipping_tax, $shipping_rate_id] = self::gross_parts($shipping_gross, $order, true);
            $ship->set_total($shipping_net);
            $ship->set_taxes(self::total_taxes($shipping_tax, $shipping_rate_id));
            $ship->update_meta_data('tm_gross_shipping_total',number_format($shipping_gross,2,'.',''));
            $ship->save();

            $payment_method = sanitize_key(wp_unslash($_POST['payment_method'] ?? $order->get_payment_method()));
            $payment_title = sanitize_text_field(wp_unslash($_POST['payment_title'] ?? $order->get_payment_method_title()));
            $payment_gross = self::posted_money($_POST['payment_gross'] ?? 0);
            $order->set_payment_method($payment_method);
            if (is_callable([$order,'set_payment_method_title'])) $order->set_payment_method_title($payment_title);
            else $order->update_meta_data('_payment_method_title',$payment_title);
            $order->update_meta_data('tm_payment_code',$payment_method);
            $order->update_meta_data('tm_payment_label',$payment_title);
            $order->update_meta_data('tm_payment_price',number_format($payment_gross,2,'.',''));

            // Remove both current TM payment fee and legacy Woo payment fees.
            // Older orders often stored Dobierka as 1.20 net + tax (1.48 gross),
            // which otherwise remained in the order and was counted a second time.
            foreach ($order->get_items('fee') as $fee_id => $fee) {
                if (self::is_payment_fee_item($fee)) $order->remove_item($fee_id);
            }
            if ($payment_gross > 0) {
                $fee = new WC_Order_Item_Fee();
                $fee->set_name($payment_title ?: 'Poplatok za platbu');
                [$payment_net, $payment_tax, $payment_rate_id] = self::gross_parts($payment_gross, $order, false);
                $fee->set_amount($payment_net);
                $fee->set_total($payment_net);
                $fee->set_tax_status($payment_tax > 0 ? 'taxable' : 'none');
                $fee->set_tax_class('');
                $fee->set_taxes(self::total_taxes($payment_tax, $payment_rate_id));
                $fee->add_meta_data('_tm_payment_fee','yes',true);
                $fee->add_meta_data('tm_payment_code',$payment_method,true);
                $fee->add_meta_data('tm_gross_payment_total',number_format($payment_gross,2,'.',''),true);
                $order->add_item($fee);
            }

            $pickup=[];
            foreach(['carrier','type','id','name','street','city','zip','country'] as $key) $pickup[$key]=sanitize_text_field(wp_unslash($_POST['pickup_'.$key]??''));
            foreach(['carrier'=>'tm_shipping_carrier','type'=>'tm_shipping_pickup_type','id'=>'tm_shipping_pickup_id','name'=>'tm_shipping_pickup_name','street'=>'tm_shipping_pickup_street','city'=>'tm_shipping_pickup_city','zip'=>'tm_shipping_pickup_postcode','country'=>'tm_shipping_pickup_country'] as $key=>$meta) $order->update_meta_data($meta,$pickup[$key]);
            $pickup['pickup_id']=$pickup['id'];$pickup['pickup_name']=$pickup['name'];$pickup['pickup_address']=$pickup['street'];$pickup['pickup_city']=$pickup['city'];$pickup['pickup_zip']=$pickup['zip'];$pickup['pickup_country']=$pickup['country'];
            $text=trim(implode(', ',array_filter([$pickup['name'],$pickup['street'],trim($pickup['zip'].' '.$pickup['city']),$pickup['country']])));
            $order->update_meta_data('tm_shipping_pickup_text',$text);
            $order->update_meta_data('tm_shipping_pickup',wp_json_encode($pickup,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));

            $status=sanitize_key(wp_unslash($_POST['order_status']??''));
            if($status&&array_key_exists('wc-'.$status,wc_get_order_statuses())) $order->set_status($status,'Objednávka upravená v TM administrácii.',false);

            self::recalculate_order_totals_exact($order);
            $order->save();
            self::refresh_order_snapshot($order, $original_snapshot);
            $order->save();
            self::redirect_order_editor($order_id,'Objednávka bola úspešne uložená.');
        } catch (Throwable $error) {
            error_log('TM order save error #'.$order_id.': '.$error->getMessage().' in '.$error->getFile().':'.$error->getLine());
            self::redirect_order_editor($order_id,'Objednávku sa nepodarilo uložiť: '.$error->getMessage(),true);
        }
    }

    private static function recalculate_order_totals_exact($order): void {
        $items_subtotal = 0.0;
        $items_subtotal_tax = 0.0;
        $items_total = 0.0;
        $items_total_tax = 0.0;
        foreach ($order->get_items('line_item') as $item) {
            $items_subtotal += (float)$item->get_subtotal();
            $items_subtotal_tax += (float)$item->get_subtotal_tax();
            $items_total += (float)$item->get_total();
            $items_total_tax += (float)$item->get_total_tax();
        }

        $shipping_total = 0.0;
        $shipping_tax = 0.0;
        foreach ($order->get_items('shipping') as $item) {
            $shipping_total += (float)$item->get_total();
            $shipping_tax += (float)$item->get_total_tax();
        }

        $fees_total = 0.0;
        $fees_tax = 0.0;
        foreach ($order->get_items('fee') as $fee) {
            $gross_meta = $fee->get_meta('tm_gross_fee_total', true);
            if ($gross_meta === '') $gross_meta = $fee->get_meta('tm_gross_payment_total', true);
            if ($gross_meta !== '') {
                $gross = round((float)$gross_meta, 2);
                $sign = $gross < 0 ? -1 : 1;
                [$net_abs, $tax_abs, $rate_id] = self::gross_parts(abs($gross), $order, false);
                $net = round($net_abs * $sign, 2);
                $tax = round($tax_abs * $sign, 2);
                $fee->set_amount($net);
                $fee->set_total($net);
                $fee->set_tax_status(abs($tax) > 0 ? 'taxable' : 'none');
                $fee->set_taxes(self::total_taxes($tax, $rate_id));
                $fee->save();
            }
            $fees_total += (float)$fee->get_total();
            $fees_tax += (float)$fee->get_total_tax();
        }

        $discount_total = max(0, $items_subtotal - $items_total);
        $discount_tax = max(0, $items_subtotal_tax - $items_total_tax);
        $cart_tax = $items_total_tax + $fees_tax;
        $grand_total = $items_total + $items_total_tax + $shipping_total + $shipping_tax + $fees_total + $fees_tax;

        $order->set_discount_total(round($discount_total, 2));
        $order->set_discount_tax(round($discount_tax, 2));
        $order->set_shipping_total(round($shipping_total, 2));
        $order->set_shipping_tax(round($shipping_tax, 2));
        $order->set_cart_tax(round($cart_tax, 2));
        $order->set_total(round($grand_total, 2));
    }

    private static function refresh_order_snapshot($order, array $previous_snapshot = []): void {
        $items = [];
        $original_subtotal = 0.0;
        $products_total = 0.0;
        foreach ($order->get_items('line_item') as $item) {
            $original = self::gross_item($item, 'subtotal');
            $total = self::gross_item($item);
            $original_subtotal += $original;
            $products_total += $total;
            $product = $item->get_product();
            $items[] = [
                'id' => $product ? $product->get_id() : 0,
                'sku' => $product ? (string) $product->get_sku() : '',
                'name' => $item->get_name(),
                'qty' => (int) $item->get_quantity(),
                'originalGross' => round($original, 2),
                'discountGross' => round(max(0, $original - $total), 2),
                'totalGross' => round($total, 2),
            ];
        }
        $shipping = 0.0;
        foreach ($order->get_items('shipping') as $item) $shipping += self::gross_item($item);
        $payment = 0.0;
        foreach ($order->get_items('fee') as $item) {
            if (self::is_payment_fee_item($item)) $payment += self::gross_item($item);
        }
        $snapshot = [
            'items' => $items,
            'originalSubtotal' => round($original_subtotal, 2),
            'quantityDiscount' => round(max(0, $original_subtotal - $products_total), 2),
            'couponDiscount' => round((float)($previous_snapshot['couponDiscount'] ?? $order->get_meta('tm_coupon_discount', true) ?: 0), 2),
            'couponLabel' => (string)($previous_snapshot['couponLabel'] ?? $order->get_meta('tm_coupon_label', true) ?: ''),
            'loyaltyDiscount' => round((float)($previous_snapshot['loyaltyDiscount'] ?? $order->get_meta('tm_loyalty_discount', true) ?: 0), 2),
            'shippingLabel' => $order->get_shipping_method(),
            'shippingPrice' => round($shipping, 2),
            'paymentLabel' => $order->get_payment_method_title(),
            'paymentPrice' => round($payment, 2),
            'total' => round((float) $order->get_total(), 2),
            'manuallyEdited' => true,
            'updatedAt' => current_time('mysql'),
        ];
        $order->update_meta_data('tm_order_snapshot', wp_json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    private static function render_full_editor($order): void {
        $pickup=self::pickup_data($order);
        $payment_gross=(float)$order->get_meta('tm_payment_price',true);
        if($payment_gross<=0){foreach($order->get_items('fee') as $fee){if(self::is_payment_fee_item($fee)){$payment_gross=self::gross_item($fee);break;}}}
        ?>
        <div class="tm-card tm-span-12"><h2>Upraviť celú objednávku</h2><?php self::notice(); ?><form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="tm_order_save_full"><input type="hidden" name="order_id" value="<?php echo (int)$order->get_id(); ?>"><?php wp_nonce_field(self::NONCE); ?>
        <div class="tm-form-grid"><?php foreach(['billing'=>'Fakturačné údaje','shipping'=>'Dodacie údaje'] as $kind=>$title): ?><div class="tm-card"><h3><?php echo esc_html($title); ?></h3><?php foreach(['first_name'=>'Meno','last_name'=>'Priezvisko','company'=>'Firma','address_1'=>'Ulica a číslo','address_2'=>'Doplnenie adresy','city'=>'Mesto','postcode'=>'PSČ','country'=>'Krajina','email'=>'E-mail','phone'=>'Telefón'] as $field=>$label){$m='get_'.$kind.'_'.$field;self::field($label,$kind.'['.$field.']',is_callable([$order,$m])?$order->$m():'');} ?></div><?php endforeach; ?></div>
        <div class="tm-form-grid" style="margin-top:16px"><div class="tm-card"><h3>Firemné údaje</h3><?php self::field('IČO','ico',self::meta_first($order,['billing_ico','_billing_ico']));self::field('DIČ','dic',self::meta_first($order,['billing_dic','_billing_dic']));self::field('IČ DPH','ic_dph',self::meta_first($order,['billing_ic_dph','_billing_ic_dph'])); ?></div><div class="tm-card"><h3>Doprava a platba</h3><?php $sg=0;foreach($order->get_items('shipping')as$sh)$sg+=(float)$sh->get_total()+(float)$sh->get_total_tax();self::field('Kód dopravy','shipping_method',current($order->get_items('shipping'))?current($order->get_items('shipping'))->get_method_id():'');self::field('Názov dopravy','shipping_title',$order->get_shipping_method());self::field('Cena dopravy s DPH','shipping_gross',number_format($sg,2,'.',''),'number'); ?>
        <label class="tm-field"><span>Spôsob platby</span><select name="payment_method" id="tm-payment-method"><option value="gopay" <?php selected($order->get_payment_method(),'gopay'); ?>>Online platba GoPay</option><option value="cod" <?php selected($order->get_payment_method(),'cod'); ?>>Dobierka</option><option value="bank_prepaid" <?php selected($order->get_payment_method(),'bank_prepaid'); ?>>Platba prevodom vopred</option><option value="bank_organization" <?php selected($order->get_payment_method(),'bank_organization'); ?>>Platba prevodom pre organizácie</option></select></label>
        <?php self::field('Názov platby','payment_title',$order->get_payment_method_title());self::field('Poplatok za platbu s DPH','payment_gross',number_format($payment_gross,2,'.',''),'number'); ?>
        <label class="tm-field"><span>Stav objednávky</span><select name="order_status"><?php foreach(wc_get_order_statuses()as$key=>$label){$v=str_replace('wc-','',$key);echo'<option value="'.esc_attr($v).'" '.selected($order->get_status(),$v,false).'>'.esc_html($label).'</option>';} ?></select></label></div></div>
        <div class="tm-card" style="margin-top:16px"><h3>Výdajné miesto GLS / DPD</h3><div class="tm-form-grid"><?php foreach(['carrier'=>'Dopravca','type'=>'Typ miesta','id'=>'ID miesta','name'=>'Názov miesta','street'=>'Ulica a číslo','city'=>'Mesto','zip'=>'PSČ','country'=>'Krajina'] as $k=>$label)self::field($label,'pickup_'.$k,$pickup[$k]??''); ?></div></div>
        <div class="tm-card" style="margin-top:16px"><h3>Produkty a ceny s DPH</h3><table class="tm-table"><thead><tr><th>Produkt</th><th>Množstvo</th><th>Pôvodná cena s DPH</th><th>Cena po zľave s DPH</th><th>Odstrániť</th></tr></thead><tbody><?php foreach($order->get_items('line_item')as$id=>$item): ?><tr><td><strong><?php echo esc_html($item->get_name()); ?></strong><br><span class="tm-muted">SKU: <?php echo esc_html($item->get_product()?->get_sku() ?: '—'); ?></span></td><td><input type="number" min="1" name="line[<?php echo (int)$id; ?>][qty]" value="<?php echo (int)$item->get_quantity(); ?>"></td><td><input type="number" step="0.01" min="0" name="line[<?php echo (int)$id; ?>][gross_subtotal]" value="<?php echo esc_attr(number_format(self::gross_item($item,'subtotal'),2,'.','')); ?>"></td><td><input type="number" step="0.01" min="0" name="line[<?php echo (int)$id; ?>][gross_total]" value="<?php echo esc_attr(number_format(self::gross_item($item),2,'.','')); ?>"></td><td><label><input type="checkbox" name="line[<?php echo (int)$id; ?>][remove]" value="1"> odstrániť</label></td></tr><?php endforeach; ?></tbody></table>
        <h4 style="margin-top:22px">Pridať produkt</h4><div class="tm-form-grid"><?php self::field('ID produktu alebo SKU','new_product_identifier','');self::field('Vlastný názov produktu (voliteľné)','new_product_name','');self::field('Množstvo','new_product_qty','1','number');self::field('Jednotková cena s DPH','new_product_gross','','number'); ?></div></div>
        <p><button class="button button-primary button-hero">Uložiť celú objednávku</button> <a class="button button-hero" href="<?php echo esc_url(add_query_arg(['page'=>self::MENU_SLUG.'-orders','order_id'=>$order->get_id()],admin_url('admin.php'))); ?>">Späť bez uloženia</a></p></form></div>
        <script>document.addEventListener('DOMContentLoaded',function(){const m=document.getElementById('tm-payment-method');if(!m)return;const title=document.querySelector('[name="payment_title"]');const fee=document.querySelector('[name="payment_gross"]');const map={gopay:['Online platba GoPay','0.00'],cod:['Dobierka','1.20'],bank_prepaid:['Platba prevodom vopred','0.00'],bank_organization:['Platba prevodom pre organizácie','0.00']};m.addEventListener('change',()=>{if(map[m.value]){title.value=map[m.value][0];fee.value=map[m.value][1];}});});</script><?php
    }

    public static function render_tm_order_detail(int $order_id): void {
        $order=wc_get_order($order_id); if(!$order || !self::is_tm_order($order)) wp_die('TM objednávka nebola nájdená.');
        $visible=self::meta_first($order,['tm_order_number']) ?: $order->get_order_number();
        if(!empty($_GET['tm_edit'])){ ?><div class="wrap tm-wrap"><div class="tm-head"><div><h1>Upraviť TM objednávku #<?php echo esc_html($visible); ?></h1></div></div><div class="tm-grid"><?php self::render_full_editor($order); ?></div></div><?php return; }
        $snap=self::snapshot($order); $items=is_array($snap['items']??null)?$snap['items']:[];$pickup=self::pickup_data($order);$payment_id=self::meta_first($order,['gopay_payment_id']);$gstate=self::meta_first($order,['gopay_state']);[$gl,$gd,$gc]=self::gopay_state_info($gstate); ?>
        <div class="wrap tm-wrap"><div class="tm-head"><div><h1>TM objednávka #<?php echo esc_html($visible); ?></h1><p class="tm-muted">Interné Woo ID: <?php echo (int)$order->get_id(); ?></p></div><div class="tm-actions"><a class="button button-primary" href="<?php echo esc_url(add_query_arg(['page'=>self::MENU_SLUG.'-orders','order_id'=>$order_id,'tm_edit'=>1],admin_url('admin.php'))); ?>">Upraviť celú objednávku</a><a class="button" href="<?php echo esc_url(add_query_arg('page',self::MENU_SLUG.'-orders',admin_url('admin.php'))); ?>">← TM objednávky</a></div></div><?php self::notice(); ?>
        <div class="tm-grid"><div class="tm-card tm-span-8"><h2>Produkty a presné ceny s DPH</h2><table class="tm-table"><thead><tr><th>Produkt</th><th>Počet</th><th>Základná cena/ks s DPH</th><th>Pôvodná cena spolu</th><th>Zľava</th><th>Cena po zľave</th></tr></thead><tbody><?php if($items):foreach($items as $item): $qty=max(1,(int)($item['qty']??0));$unit_gross=isset($item['unitGross'])?(float)$item['unitGross']:((float)($item['originalGross']??0)/$qty); ?><tr><td><strong><?php echo esc_html($item['name']??'Produkt'); ?></strong><br><span class="tm-muted">SKU: <?php echo esc_html($item['sku']??''); ?></span></td><td><?php echo (int)($item['qty']??0); ?></td><td><strong><?php echo wp_kses_post(self::money_gross($unit_gross)); ?></strong></td><td><?php echo wp_kses_post(self::money_gross($item['originalGross']??0)); ?></td><td class="tm-success">-<?php echo wp_kses_post(self::money_gross($item['discountGross']??0)); ?></td><td><strong><?php echo wp_kses_post(self::money_gross($item['totalGross']??0)); ?></strong></td></tr><?php endforeach;else:foreach($order->get_items('line_item')as$item): $qty=max(1,(int)$item->get_quantity());$original_gross=self::gross_item($item,'subtotal'); ?><tr><td><strong><?php echo esc_html($item->get_name()); ?></strong></td><td><?php echo (int)$item->get_quantity(); ?></td><td><strong><?php echo wp_kses_post(self::money_gross($original_gross/$qty)); ?></strong></td><td><?php echo wp_kses_post(self::money_gross($original_gross)); ?></td><td class="tm-success">-<?php echo wp_kses_post(self::money_gross(max(0,$original_gross-self::gross_item($item)))); ?></td><td><strong><?php echo wp_kses_post(self::money_gross(self::gross_item($item))); ?></strong></td></tr><?php endforeach;endif; ?></tbody></table></div>
        <div class="tm-card tm-span-4"><h2>Súhrn objednávky</h2><table class="tm-table"><tr><td>Tovar pred zľavou</td><td><?php echo wp_kses_post(self::money_gross($snap['originalSubtotal']??$order->get_subtotal())); ?></td></tr><tr><td>Množstevná zľava</td><td class="tm-success">-<?php echo wp_kses_post(self::money_gross($snap['quantityDiscount']??0)); ?></td></tr><?php if((float)($snap['couponDiscount']??0)>0): ?><tr><td><?php echo esc_html($snap['couponLabel']??'Kupónová zľava'); ?></td><td class="tm-success">-<?php echo wp_kses_post(self::money_gross($snap['couponDiscount'])); ?></td></tr><?php endif; ?><?php if((float)($snap['loyaltyDiscount']??0)>0): ?><tr><td>Vernostná zľava</td><td class="tm-success">-<?php echo wp_kses_post(self::money_gross($snap['loyaltyDiscount'])); ?></td></tr><?php endif; ?><tr><td><?php echo esc_html($snap['shippingLabel']??$order->get_shipping_method()?:'Doprava'); ?></td><td><?php echo wp_kses_post(self::money_gross($snap['shippingPrice']??0)); ?></td></tr><tr><td><?php echo esc_html($snap['paymentLabel']??$order->get_payment_method_title()?:'Platba'); ?></td><td><?php echo wp_kses_post(self::money_gross($snap['paymentPrice']??0)); ?></td></tr><tr><td><strong>Spolu s DPH</strong></td><td><strong><?php echo wp_kses_post(self::money_gross($snap['total']??$order->get_total())); ?></strong></td></tr></table></div>
        <div class="tm-card tm-span-6"><h2>Doprava a výdajné miesto</h2><p><strong><?php echo esc_html($order->get_shipping_method()?:'Neuvedené'); ?></strong></p><?php if($pickup['text']||$pickup['id']): ?><div class="tm-note"><strong><?php echo esc_html($pickup['name']?:'Výdajné miesto'); ?></strong><br><?php echo esc_html($pickup['address']?:'Adresa nebola uložená'); ?><br><span class="tm-muted"><?php echo esc_html(trim(($pickup['carrier']??'').' '.($pickup['type']??''))); ?><?php if($pickup['id'])echo' · ID '.esc_html($pickup['id']); ?></span></div><?php elseif(str_contains(strtolower($order->get_shipping_method()),'pickup')||str_contains(strtolower($order->get_shipping_method()),'parcel')||str_contains(strtolower($order->get_shipping_method()),'balík')): ?><p class="tm-danger"><strong>Adresa výdajného miesta nebola v tejto starej objednávke uložená.</strong></p><?php endif; ?></div>
        <div class="tm-card tm-span-6"><h2>Platba</h2><p><strong><?php echo esc_html($order->get_payment_method_title()?:'Neuvedené'); ?></strong></p><?php if($payment_id||in_array($order->get_payment_method(),['gopay','applepay','googlepay'],true)): ?><p><span class="tm-badge <?php echo esc_attr($gc); ?>">GoPay <?php echo esc_html($gl); ?></span></p><p><?php echo esc_html($gd); ?></p><p class="tm-muted">ID platby: <?php echo esc_html($payment_id?:'neuvedené'); ?><br>Stav brány: <?php echo esc_html($gstate?:'NEOVERENÉ'); ?></p><?php endif; ?></div>
        <div class="tm-card tm-span-6"><h2>Zákazník</h2><p><strong><?php echo esc_html($order->get_formatted_billing_full_name()); ?></strong><br><?php echo esc_html($order->get_billing_email()); ?><br><?php echo esc_html($order->get_billing_phone()); ?></p><p><?php echo wp_kses_post($order->get_formatted_billing_address()); ?></p></div>
        <div class="tm-card tm-span-6"><h2>Stav a e-mail</h2>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="tm-actions">
                <input type="hidden" name="action" value="tm_order_update_status"><input type="hidden" name="order_id" value="<?php echo $order_id; ?>"><?php wp_nonce_field(self::NONCE); ?>
                <select name="order_status" aria-label="Stav objednávky"><?php self::render_status_email_options($order->get_status()); ?></select><button class="button button-primary">Uložiť stav a odoslať e-mail</button>
            </form>
            <p class="tm-muted">Výber zmení stav objednávky a odošle príslušný e-mail.</p>
            <?php self::render_order_status_email_notice($order); ?>
            <p class="tm-muted">Posledné potvrdenie: <?php echo esc_html((string)$order->get_meta('tm_confirmation_email_sent_at') ?: 'bez potvrdenia'); ?></p>
        </div></div></div><?php
    }

    public static function render_loyalty_page(): void {
        self::guard();
        self::render_meta_overview('Vernostné body', self::META_POINTS);
    }

    public static function render_coupons_page(): void {
        self::guard();
        self::render_meta_overview('Kupóny', self::META_COUPONS);
    }

    private static function guard(): void {
        if (!current_user_can('manage_woocommerce')) wp_die('Nemáte oprávnenie.');
    }

    private static function is_tm_customer(int $user_id): bool {
        $source = strtolower((string)get_user_meta($user_id, self::META_SOURCE, true));
        $channel = strtolower((string)get_user_meta($user_id, self::META_CHANNEL, true));
        if (str_contains($source, 'tonerymaxim') || str_contains($channel, 'tonerymaxim')) return true;
        if (!function_exists('wc_get_orders')) return false;
        $orders = wc_get_orders(['customer_id' => $user_id, 'limit' => 5, 'return' => 'objects']);
        foreach ($orders as $order) {
            $values = [
                strtolower((string)$order->get_meta('source')),
                strtolower((string)$order->get_meta('sales_channel')),
                strtolower((string)$order->get_meta('created_via')),
                strtolower((string)$order->get_created_via()),
            ];
            foreach ($values as $value) if (str_contains($value, 'tonerymaxim')) return true;
        }
        return false;
    }

    private static function customer_query(int $page, int $per_page, string $search = ''): array {
        $args = [
            'role__in' => ['customer', 'subscriber'],
            'number' => 500,
            'orderby' => 'registered',
            'order' => 'DESC',
            'fields' => 'all',
        ];
        if ($search !== '') $args['search'] = '*' . esc_attr($search) . '*';
        $users = get_users($args);
        $filtered = array_values(array_filter($users, fn($user) => self::is_tm_customer((int)$user->ID)));
        $total = count($filtered);
        $offset = max(0, ($page - 1) * $per_page);
        return [array_slice($filtered, $offset, $per_page), $total];
    }

    private static function render_customer_list(): void {
        $page = max(1, absint($_GET['paged'] ?? 1));
        $search = sanitize_text_field(wp_unslash($_GET['s'] ?? ''));
        $per_page = 25;
        [$users, $total] = self::customer_query($page, $per_page, $search);
        $pages = max(1, (int)ceil($total / $per_page));
        ?>
        <div class="wrap tm-wrap">
            <div class="tm-head">
                <div><h1>ToneryMaxim zákazníci</h1><p class="tm-muted">Jednotná administrácia údajov, objednávok, bodov, kupónov a uložených tlačiarní.</p></div>
                <form class="tm-search" method="get"><input type="hidden" name="page" value="<?php echo esc_attr(self::MENU_SLUG); ?>"><input type="search" name="s" value="<?php echo esc_attr($search); ?>" placeholder="Meno, e-mail…"><button class="button button-primary">Hľadať</button></form>
            </div>
            <?php self::notice(); ?>
            <div class="tm-grid">
                <div class="tm-card tm-span-3 tm-stat"><span>Registrovaní zákazníci</span><strong><?php echo number_format_i18n($total); ?></strong></div>
                <div class="tm-card tm-span-9"><strong>Zdroj údajov</strong><p class="tm-muted">WooCommerce zákazníci a objednávky označené zdrojom ToneryMaxim.</p></div>
                <div class="tm-card tm-span-12">
                    <table class="tm-table"><thead><tr><th>Zákazník</th><th>Kontakt</th><th>Objednávky</th><th>Obrat</th><th>Body</th><th>Kupóny</th><th></th></tr></thead><tbody>
                    <?php if (!$users): ?><tr><td colspan="7" class="tm-empty">Nenašli sa žiadni zákazníci.</td></tr><?php endif; ?>
                    <?php foreach ($users as $user):
                        $stats = self::customer_stats((int)$user->ID);
                        $detail = admin_url('admin.php?page=' . self::MENU_SLUG . '&customer_id=' . (int)$user->ID);
                    ?>
                    <tr>
                        <td><div class="tm-customer-name"><?php echo esc_html(self::user_name($user)); ?></div><span class="tm-muted">ID <?php echo (int)$user->ID; ?> · <?php echo esc_html(date_i18n('d.m.Y', strtotime($user->user_registered))); ?></span></td>
                        <td><a href="mailto:<?php echo esc_attr($user->user_email); ?>"><?php echo esc_html($user->user_email); ?></a><br><?php echo esc_html(get_user_meta($user->ID, 'billing_phone', true)); ?></td>
                        <td><?php echo number_format_i18n($stats['orders']); ?></td>
                        <td><?php echo wp_kses_post(wc_price($stats['revenue'])); ?></td>
                        <td><span class="tm-badge green"><?php echo number_format_i18n($stats['points']); ?> b</span></td>
                        <td><?php echo number_format_i18n($stats['active_coupons']); ?> aktívne</td>
                        <td><a class="button" href="<?php echo esc_url($detail); ?>">Otvoriť detail</a></td>
                    </tr>
                    <?php endforeach; ?></tbody></table>
                    <?php if ($pages > 1): ?><div class="tablenav"><div class="tablenav-pages"><?php echo wp_kses_post(paginate_links(['base' => add_query_arg('paged', '%#%'), 'format' => '', 'current' => $page, 'total' => $pages])); ?></div></div><?php endif; ?>
                </div>
            </div>
        </div><?php
    }

    private static function render_customer_detail(int $customer_id): void {
        $user = get_user_by('id', $customer_id);
        if (!$user || !self::is_tm_customer($customer_id)) wp_die('Zákazník ToneryMaxim sa nenašiel.');
        $tab = sanitize_key($_GET['tab'] ?? 'overview');
        $base = admin_url('admin.php?page=' . self::MENU_SLUG . '&customer_id=' . $customer_id);
        $stats = self::customer_stats($customer_id);
        ?>
        <div class="wrap tm-wrap">
            <div class="tm-head"><div><a href="<?php echo esc_url(admin_url('admin.php?page=' . self::MENU_SLUG)); ?>">← Zákazníci</a><h1><?php echo esc_html(self::user_name($user)); ?></h1><p class="tm-muted"><?php echo esc_html($user->user_email); ?> · zákazník ID <?php echo (int)$customer_id; ?></p></div></div>
            <?php self::notice(); ?>
            <nav class="tm-tabs">
            <?php foreach (['overview'=>'Prehľad','profile'=>'Údaje a adresy','orders'=>'Objednávky','loyalty'=>'Vernostné body','coupons'=>'Kupóny','printers'=>'Tlačiarne','rewards'=>'Odmeny','notes'=>'Poznámky'] as $key=>$label): ?>
                <a class="<?php echo $tab === $key ? 'active' : ''; ?>" href="<?php echo esc_url(add_query_arg('tab', $key, $base)); ?>"><?php echo esc_html($label); ?></a>
            <?php endforeach; ?>
            </nav>
            <?php
            switch ($tab) {
                case 'profile': self::tab_profile($user); break;
                case 'orders': self::tab_orders($customer_id); break;
                case 'loyalty': self::tab_loyalty($user); break;
                case 'coupons': self::tab_coupons($user); break;
                case 'printers': self::tab_printers($user); break;
                case 'rewards': self::tab_rewards($user); break;
                case 'notes': self::tab_notes($user); break;
                default: self::tab_overview($user, $stats); break;
            }
            ?>
        </div><?php
    }

    private static function tab_overview(WP_User $user, array $stats): void {
        $billing = self::address($user->ID, 'billing');
        $orders = self::orders($user->ID, 5);
        ?>
        <div class="tm-grid">
            <div class="tm-card tm-span-4"><div class="tm-profile-head"><div class="tm-avatar"><?php echo esc_html(self::initials($user)); ?></div><div><h2><?php echo esc_html(self::user_name($user)); ?></h2><a href="mailto:<?php echo esc_attr($user->user_email); ?>"><?php echo esc_html($user->user_email); ?></a></div></div><hr><p><strong>Telefón:</strong> <?php echo esc_html($billing['phone'] ?: '—'); ?></p><p><strong>Firma:</strong> <?php echo esc_html($billing['company'] ?: '—'); ?></p><p><strong>IČO:</strong> <?php echo esc_html(self::meta_any($user->ID, ['billing_ico','tm_ico','ico'])); ?></p></div>
            <div class="tm-card tm-span-2 tm-kpi">Objednávky<strong><?php echo number_format_i18n($stats['orders']); ?></strong></div>
            <div class="tm-card tm-span-2 tm-kpi">Celkový obrat<strong><?php echo wp_kses_post(wc_price($stats['revenue'])); ?></strong></div>
            <div class="tm-card tm-span-2 tm-kpi">Vernostné body<strong><?php echo number_format_i18n($stats['points']); ?></strong></div>
            <div class="tm-card tm-span-2 tm-kpi">Aktívne kupóny<strong><?php echo number_format_i18n($stats['active_coupons']); ?></strong></div>
            <div class="tm-card tm-span-8"><h2>Posledné objednávky</h2><?php self::orders_table($orders); ?></div>
            <div class="tm-card tm-span-4"><h2>Fakturačná adresa</h2><?php echo wp_kses_post(self::address_html($billing)); ?><hr><h3>Uložené tlačiarne</h3><p><?php echo number_format_i18n(count(self::json_meta($user->ID, self::META_PRINTERS))); ?> položiek</p></div>
        </div><?php
    }

    private static function tab_profile(WP_User $user): void {
        $id = (int)$user->ID; $b = self::address($id, 'billing'); $s = self::address($id, 'shipping');
        ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="tm_customer_save_profile"><input type="hidden" name="customer_id" value="<?php echo $id; ?>"><?php wp_nonce_field(self::NONCE); ?>
            <div class="tm-grid">
                <div class="tm-card tm-span-6"><h2>Fakturačné a firemné údaje</h2><?php self::address_fields('billing', $b, true); ?></div>
                <div class="tm-card tm-span-6"><h2>Dodacia adresa</h2><?php self::address_fields('shipping', $s, false); ?></div>
                <div class="tm-card tm-span-12 tm-actions"><button class="button button-primary button-large">Uložiť údaje</button></div>
            </div>
        </form><?php
    }

    private static function address_fields(string $prefix, array $data, bool $company): void {
        $fields = ['first_name'=>'Meno','last_name'=>'Priezvisko','company'=>'Firma','address_1'=>'Ulica a číslo','address_2'=>'Doplnenie adresy','postcode'=>'PSČ','city'=>'Mesto','country'=>'Krajina','phone'=>'Telefón'];
        echo '<div class="tm-form-grid">';
        foreach ($fields as $key=>$label) {
            echo '<div class="tm-field"><label>'.esc_html($label).'</label><input type="text" name="'.esc_attr($prefix.'_'.$key).'" value="'.esc_attr($data[$key] ?? '').'"></div>';
        }
        if ($company) {
            foreach (['billing_ico'=>'IČO','billing_dic'=>'DIČ','billing_ic_dph'=>'IČ DPH'] as $key=>$label) {
                echo '<div class="tm-field"><label>'.esc_html($label).'</label><input type="text" name="'.esc_attr($key).'" value="'.esc_attr(self::meta_any((int)($_GET['customer_id'] ?? 0), [$key, str_replace('billing_','tm_',$key)])).'"></div>';
            }
        }
        echo '</div>';
    }

    private static function tab_orders(int $customer_id): void {
        echo '<div class="tm-card"><h2>Všetky objednávky</h2>'; self::orders_table(self::orders($customer_id, 100)); echo '</div>';
    }

    private static function tab_loyalty(WP_User $user): void {
        $id = (int)$user->ID; $points = (int)get_user_meta($id, self::META_POINTS, true); $history = self::json_meta($id, self::META_HISTORY);
        ?>
        <div class="tm-grid">
            <div class="tm-card tm-span-4"><h2>Aktuálny stav</h2><div class="tm-kpi">Vernostné body<strong><?php echo number_format_i18n($points); ?></strong></div><p class="tm-muted">100 bodov = 1,00 € zľava.</p></div>
            <div class="tm-card tm-span-8"><h2>Manuálna úprava</h2><form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="tm_customer_adjust_points"><input type="hidden" name="customer_id" value="<?php echo $id; ?>"><?php wp_nonce_field(self::NONCE); ?><div class="tm-form-grid"><div class="tm-field"><label>Zmena bodov</label><input type="number" name="points_delta" required placeholder="napr. 100 alebo -50"></div><div class="tm-field"><label>Dôvod</label><input type="text" name="reason" required></div></div><p><button class="button button-primary">Uložiť zmenu</button></p></form></div>
            <div class="tm-card tm-span-12"><h2>História bodov</h2><table class="tm-table"><thead><tr><th>Dátum</th><th>Popis</th><th>Body</th><th>Objednávka</th></tr></thead><tbody><?php if (!$history) echo '<tr><td colspan="4" class="tm-empty">Bez histórie.</td></tr>'; foreach ($history as $row): ?><tr><td><?php echo esc_html($row['date'] ?? '—'); ?></td><td><?php echo esc_html($row['title'] ?? '—'); ?></td><td class="<?php echo ((int)($row['points'] ?? 0) >= 0) ? 'tm-success':'tm-danger'; ?>"><?php echo ((int)($row['points'] ?? 0) > 0 ? '+' : '') . (int)($row['points'] ?? 0); ?></td><td><?php echo esc_html($row['orderId'] ?? '—'); ?></td></tr><?php endforeach; ?></tbody></table></div>
        </div><?php
    }

    private static function tab_coupons(WP_User $user): void {
        $id=(int)$user->ID; $coupons=self::json_meta($id,self::META_COUPONS);
        ?>
        <div class="tm-grid"><div class="tm-card tm-span-4"><h2>Pridať kupón</h2><form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="tm_customer_add_coupon"><input type="hidden" name="customer_id" value="<?php echo $id; ?>"><?php wp_nonce_field(self::NONCE); ?><div class="tm-field"><label>Kód</label><input name="code" required></div><div class="tm-field"><label>Názov</label><input name="label" value="Manuálny kupón"></div><div class="tm-field"><label>Zľava %</label><input type="number" min="1" max="100" name="percent" value="5" required></div><div class="tm-field"><label>Platnosť</label><select name="scope"><option value="all">Celý sortiment</option><option value="compatible">Kompatibilné produkty</option></select></div><div class="tm-field"><label>Platný do</label><input type="date" name="expires_at"></div><p><button class="button button-primary">Vytvoriť kupón</button></p></form></div><div class="tm-card tm-span-8"><h2>Kupóny zákazníka</h2><table class="tm-table"><thead><tr><th>Kód</th><th>Zľava</th><th>Rozsah</th><th>Stav</th><th>Platnosť</th><th></th></tr></thead><tbody><?php if(!$coupons) echo '<tr><td colspan="6" class="tm-empty">Bez kupónov.</td></tr>'; foreach($coupons as $index=>$coupon): ?><tr><td><strong><?php echo esc_html($coupon['code']??''); ?></strong><br><span class="tm-muted"><?php echo esc_html($coupon['label']??''); ?></span></td><td><?php echo (int)($coupon['percent']??0); ?> %</td><td><?php echo ($coupon['scope']??'all')==='compatible'?'Kompatibilné':'Všetko'; ?></td><td><span class="tm-badge <?php echo ($coupon['status']??'active')==='active'?'green':'gray'; ?>"><?php echo esc_html($coupon['status']??'active'); ?></span></td><td><?php echo esc_html(self::date($coupon['expiresAt']??'')); ?></td><td><?php if(($coupon['status']??'active')==='active'): ?><a class="button" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=tm_customer_coupon_status&customer_id='.$id.'&coupon_index='.$index.'&status=expired'),self::NONCE)); ?>">Deaktivovať</a><?php else: ?><a class="button" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=tm_customer_coupon_status&customer_id='.$id.'&coupon_index='.$index.'&status=active'),self::NONCE)); ?>">Aktivovať</a><?php endif; ?></td></tr><?php endforeach; ?></tbody></table></div></div><?php
    }

    private static function tab_printers(WP_User $user): void {
        $id=(int)$user->ID; $printers=self::json_meta($id,self::META_PRINTERS);
        echo '<div class="tm-card"><h2>Uložené tlačiarne</h2><table class="tm-table"><thead><tr><th>Názov</th><th>Značka</th><th>Pridané</th><th></th></tr></thead><tbody>';
        if(!$printers) echo '<tr><td colspan="4" class="tm-empty">Žiadne uložené tlačiarne.</td></tr>';
        foreach($printers as $i=>$printer){$url=wp_nonce_url(admin_url('admin-post.php?action=tm_customer_delete_printer&customer_id='.$id.'&printer_index='.$i),self::NONCE);echo '<tr><td><strong>'.esc_html($printer['title']??'').'</strong></td><td>'.esc_html($printer['brand']??'—').'</td><td>'.esc_html(self::date($printer['added_at']??'')).'</td><td><a class="button tm-danger" href="'.esc_url($url).'">Odstrániť</a></td></tr>';}
        echo '</tbody></table></div>';
    }

    private static function tab_rewards(WP_User $user): void {
        $rewards=self::json_meta((int)$user->ID,self::META_REWARDS);
        echo '<div class="tm-card"><h2>Odmeny</h2>';
        if(!$rewards) echo '<div class="tm-empty">Zatiaľ bez evidovaných odmien.</div>';
        else echo '<div class="tm-json">'.esc_html(wp_json_encode($rewards,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE)).'</div>';
        echo '<p class="tm-muted">Odmeny sú zobrazené z meta kľúča <code>'.esc_html(self::META_REWARDS).'</code>.</p></div>';
    }

    private static function tab_notes(WP_User $user): void {
        $id=(int)$user->ID; $notes=(string)get_user_meta($id,self::META_NOTES,true);
        ?><div class="tm-card"><h2>Interné poznámky</h2><form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="tm_customer_save_notes"><input type="hidden" name="customer_id" value="<?php echo $id; ?>"><?php wp_nonce_field(self::NONCE); ?><textarea name="notes" rows="12" style="width:100%" placeholder="Poznámky viditeľné iba administrátorom…"><?php echo esc_textarea($notes); ?></textarea><p><button class="button button-primary">Uložiť poznámky</button></p></form></div><?php
    }

    private static function orders(int $customer_id, int $limit): array {
        if (!function_exists('wc_get_orders')) return [];
        return wc_get_orders(['customer_id'=>$customer_id,'limit'=>$limit,'orderby'=>'date','order'=>'DESC','return'=>'objects']);
    }

    private static function orders_table(array $orders): void {
        echo '<table class="tm-table"><thead><tr><th>Objednávka</th><th>Dátum</th><th>Stav</th><th>Platba</th><th>Celkom</th></tr></thead><tbody>';
        if(!$orders) echo '<tr><td colspan="5" class="tm-empty">Žiadne objednávky.</td></tr>';
        foreach($orders as $order){$edit=add_query_arg(['page'=>self::MENU_SLUG.'-orders','order_id'=>$order->get_id()],admin_url('admin.php'));echo '<tr><td><a class="tm-order-link" href="'.esc_url($edit).'">#'.esc_html($order->get_order_number()).'</a></td><td>'.esc_html($order->get_date_created()?wc_format_datetime($order->get_date_created()):'—').'</td><td><span class="tm-badge">'.esc_html(wc_get_order_status_name($order->get_status())).'</span></td><td>'.esc_html($order->get_payment_method_title()?:'—').'</td><td>'.wp_kses_post(self::formatted_gross_order_total($order)).'</td></tr>';}
        echo '</tbody></table>';
    }

    private static function customer_stats(int $id): array {
        $orders=self::orders($id,100); $revenue=0; foreach($orders as $order){if(!in_array($order->get_status(),['cancelled','failed','refunded'],true))$revenue+=(float)$order->get_total();}
        $coupons=self::json_meta($id,self::META_COUPONS); $active=0; foreach($coupons as $c){if(($c['status']??'active')==='active' && (empty($c['expiresAt']) || strtotime((string)$c['expiresAt'])>time()))$active++;}
        return ['orders'=>count($orders),'revenue'=>$revenue,'points'=>(int)get_user_meta($id,self::META_POINTS,true),'active_coupons'=>$active];
    }

    private static function address(int $id,string $prefix): array {
        $keys=['first_name','last_name','company','address_1','address_2','postcode','city','country','phone'];$out=[];foreach($keys as $k)$out[$k]=(string)get_user_meta($id,$prefix.'_'.$k,true);return $out;
    }

    private static function address_html(array $a): string {
        $lines=[trim(($a['first_name']??'').' '.($a['last_name']??'')),$a['company']??'',trim(($a['address_1']??'').' '.($a['address_2']??'')),trim(($a['postcode']??'').' '.($a['city']??'')),$a['country']??'',$a['phone']??''];return implode('<br>',array_map('esc_html',array_filter($lines)));
    }

    private static function json_meta(int $id,string $key): array {
        $raw=get_user_meta($id,$key,true);if(is_array($raw))return $raw;if(!is_string($raw)||trim($raw)==='')return[];$decoded=json_decode($raw,true);return is_array($decoded)?$decoded:[];
    }

    private static function user_name(WP_User $user): string { $name=trim((string)get_user_meta($user->ID,'billing_first_name',true).' '.(string)get_user_meta($user->ID,'billing_last_name',true)); return $name?:($user->display_name?:$user->user_email); }
    private static function initials(WP_User $user): string {$parts=preg_split('/\s+/',self::user_name($user));return strtoupper(mb_substr($parts[0]??'T',0,1).mb_substr($parts[1]??'M',0,1));}
    private static function meta_any(int $id,array $keys): string {foreach($keys as $k){$v=(string)get_user_meta($id,$k,true);if(trim($v)!=='')return $v;}return '—';}
    private static function date(string $value): string {if(!$value)return'—';$time=strtotime($value);return $time?date_i18n('d.m.Y',$time):$value;}

    public static function save_profile(): void {
        self::verify(); $id=absint($_POST['customer_id']??0); if(!$id)self::redirect_error($id,'Neplatný zákazník.');
        foreach(['billing','shipping'] as $prefix){foreach(['first_name','last_name','company','address_1','address_2','postcode','city','country','phone'] as $key){update_user_meta($id,$prefix.'_'.$key,sanitize_text_field(wp_unslash($_POST[$prefix.'_'.$key]??'')));}}
        foreach(['billing_ico'=>'tm_ico','billing_dic'=>'tm_dic','billing_ic_dph'=>'tm_ic_dph'] as $key=>$alias){$value=sanitize_text_field(wp_unslash($_POST[$key]??''));update_user_meta($id,$key,$value);update_user_meta($id,$alias,$value);}
        $email=sanitize_email(wp_unslash($_POST['billing_email']??''));if($email){update_user_meta($id,'billing_email',$email);wp_update_user(['ID'=>$id,'user_email'=>$email]);}
        self::redirect_ok($id,'profile','Údaje zákazníka boli uložené.');
    }

    public static function adjust_points(): void {
        self::verify();$id=absint($_POST['customer_id']??0);$delta=(int)($_POST['points_delta']??0);$reason=sanitize_text_field(wp_unslash($_POST['reason']??''));$current=(int)get_user_meta($id,self::META_POINTS,true);$new=max(0,$current+$delta);update_user_meta($id,self::META_POINTS,(string)$new);$history=self::json_meta($id,self::META_HISTORY);array_unshift($history,['date'=>date_i18n('d.m.Y'),'title'=>'Administrátor: '.$reason,'points'=>$delta,'adminId'=>get_current_user_id()]);update_user_meta($id,self::META_HISTORY,wp_json_encode(array_slice($history,0,100),JSON_UNESCAPED_UNICODE));self::redirect_ok($id,'loyalty','Vernostné body boli upravené.');
    }

    public static function add_coupon(): void {
        self::verify();$id=absint($_POST['customer_id']??0);$coupons=self::json_meta($id,self::META_COUPONS);$code=strtoupper(preg_replace('/\s+/','',sanitize_text_field(wp_unslash($_POST['code']??''))));if(!$code)self::redirect_error($id,'Zadajte kód kupónu.','coupons');$expires=sanitize_text_field(wp_unslash($_POST['expires_at']??''));$coupons=array_values(array_filter($coupons,fn($c)=>strtoupper((string)($c['code']??''))!==$code));array_unshift($coupons,['code'=>$code,'type'=>'marketing','label'=>sanitize_text_field(wp_unslash($_POST['label']??'Manuálny kupón')),'percent'=>max(1,min(100,absint($_POST['percent']??5))),'scope'=>($_POST['scope']??'all')==='compatible'?'compatible':'all','status'=>'active','createdAt'=>gmdate('c'),'expiresAt'=>$expires?$expires.'T23:59:59+00:00':null]);update_user_meta($id,self::META_COUPONS,wp_json_encode(array_slice($coupons,0,100),JSON_UNESCAPED_UNICODE));self::redirect_ok($id,'coupons','Kupón bol vytvorený.');
    }

    public static function coupon_status(): void {
        self::verify_get();$id=absint($_GET['customer_id']??0);$index=absint($_GET['coupon_index']??-1);$status=sanitize_key($_GET['status']??'expired');$coupons=self::json_meta($id,self::META_COUPONS);if(isset($coupons[$index])){$coupons[$index]['status']=in_array($status,['active','used','expired'],true)?$status:'expired';update_user_meta($id,self::META_COUPONS,wp_json_encode($coupons,JSON_UNESCAPED_UNICODE));}self::redirect_ok($id,'coupons','Stav kupónu bol zmenený.');
    }

    public static function save_notes(): void {self::verify();$id=absint($_POST['customer_id']??0);update_user_meta($id,self::META_NOTES,sanitize_textarea_field(wp_unslash($_POST['notes']??'')));self::redirect_ok($id,'notes','Poznámky boli uložené.');}
    public static function delete_printer(): void {self::verify_get();$id=absint($_GET['customer_id']??0);$index=absint($_GET['printer_index']??-1);$items=self::json_meta($id,self::META_PRINTERS);if(isset($items[$index])){array_splice($items,$index,1);update_user_meta($id,self::META_PRINTERS,wp_json_encode(array_values($items),JSON_UNESCAPED_UNICODE));}self::redirect_ok($id,'printers','Tlačiareň bola odstránená.');}

    private static function verify(): void {self::guard();check_admin_referer(self::NONCE);}
    private static function verify_get(): void {self::guard();check_admin_referer(self::NONCE);}
    private static function redirect_ok(int $id,string $tab,string $message): void {wp_safe_redirect(add_query_arg(['page'=>self::MENU_SLUG,'customer_id'=>$id,'tab'=>$tab,'tm_notice'=>$message],admin_url('admin.php')));exit;}
    private static function redirect_error(int $id,string $message,string $tab='overview'): void {wp_safe_redirect(add_query_arg(['page'=>self::MENU_SLUG,'customer_id'=>$id,'tab'=>$tab,'tm_error'=>$message],admin_url('admin.php')));exit;}
    private static function notice(): void {if(!empty($_GET['tm_notice']))echo '<div class="notice notice-success is-dismissible"><p>'.esc_html(wp_unslash($_GET['tm_notice'])).'</p></div>';if(!empty($_GET['tm_error']))echo '<div class="notice notice-error is-dismissible"><p>'.esc_html(wp_unslash($_GET['tm_error'])).'</p></div>';}

    private static function render_meta_overview(string $title,string $meta_key): void {
        [$users,$total]=self::customer_query(1,500,'');echo '<div class="wrap tm-wrap"><div class="tm-head"><div><h1>'.esc_html($title).'</h1><p class="tm-muted">Prehľad zákazníkov ToneryMaxim.</p></div></div><div class="tm-card"><table class="tm-table"><thead><tr><th>Zákazník</th><th>Hodnota</th><th></th></tr></thead><tbody>';
        foreach($users as $user){$value=get_user_meta($user->ID,$meta_key,true);$summary=$meta_key===self::META_POINTS?(int)$value.' bodov':count(self::json_meta($user->ID,$meta_key)).' položiek';echo '<tr><td><strong>'.esc_html(self::user_name($user)).'</strong><br>'.esc_html($user->user_email).'</td><td>'.esc_html($summary).'</td><td><a class="button" href="'.esc_url(admin_url('admin.php?page='.self::MENU_SLUG.'&customer_id='.$user->ID)).'">Detail</a></td></tr>';}
        echo '</tbody></table></div></div>';
    }
}

add_action('plugins_loaded', ['TM_Customer_Administration_V1', 'init']);
