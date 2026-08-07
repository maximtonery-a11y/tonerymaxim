<?php
/**
 * Plugin Name: ToneryMAXIM Email Policy
 * Description: Zabráni WordPressu a WooCommerce odosielať zákaznícke e-maily pre operácie e-shopu ToneryMAXIM. E-maily ColorIQ zostávajú bez zmeny.
 * Version: 1.0.1
 * Author: ToneryMAXIM.sk
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

defined('ABSPATH') || exit;

final class ToneryMaxim_Email_Policy {
    private const VERSION = '1.0.1';
    private const ORIGIN_HEADER = 'HTTP_X_TONERYMAXIM_ORIGIN';
    private const SUPPRESS_HEADER = 'HTTP_X_TONERYMAXIM_SUPPRESS_EMAILS';

    private const EMAIL_IDS = array(
        'new_order',
        'cancelled_order',
        'failed_order',
        'customer_on_hold_order',
        'customer_processing_order',
        'customer_completed_order',
        'customer_refunded_order',
        'customer_invoice',
        'customer_note',
        'customer_reset_password',
        'customer_new_account',
    );

    public static function boot(): void {
        add_filter('pre_wp_mail', array(__CLASS__, 'suppress_flagged_wp_mail'), 10, 2);
        add_filter('send_password_change_email', array(__CLASS__, 'suppress_password_change_email'), 10, 3);
        add_filter('send_email_change_email', array(__CLASS__, 'suppress_email_change_email'), 10, 3);
        add_filter('send_retrieve_password_email', array(__CLASS__, 'suppress_password_reset_email'), 10, 3);
        add_filter('wp_send_new_user_notification_to_user', array(__CLASS__, 'suppress_new_user_email'), 10, 2);

        foreach (self::EMAIL_IDS as $email_id) {
            add_filter('woocommerce_email_enabled_' . $email_id, array(__CLASS__, 'suppress_woo_email'), 999, 3);
        }

        add_action('rest_api_init', array(__CLASS__, 'register_status_route'));
    }

    private static function is_flagged_astro_request(): bool {
        if (!defined('REST_REQUEST') || REST_REQUEST !== true) {
            return false;
        }

        $origin = isset($_SERVER[self::ORIGIN_HEADER])
            ? sanitize_key(wp_unslash($_SERVER[self::ORIGIN_HEADER]))
            : '';
        $suppress = isset($_SERVER[self::SUPPRESS_HEADER])
            ? sanitize_text_field(wp_unslash($_SERVER[self::SUPPRESS_HEADER]))
            : '';
        if ($origin !== 'astro' || $suppress !== '1') {
            return false;
        }

        $request_uri = isset($_SERVER['REQUEST_URI'])
            ? (string) wp_unslash($_SERVER['REQUEST_URI'])
            : '';
        $allowed_api = strpos($request_uri, '/wp-json/wc/v3/') !== false
            || strpos($request_uri, '/wp-json/tonerymaxim/v1/') !== false;
        if (!$allowed_api) {
            return false;
        }

        return current_user_can('manage_woocommerce') || current_user_can('manage_options');
    }

    private static function is_tonerymaxim_order($object): bool {
        if (!function_exists('wc_get_order')) {
            return false;
        }

        if (is_numeric($object)) {
            $object = wc_get_order((int) $object);
        } elseif (is_object($object) && !is_a($object, 'WC_Order') && method_exists($object, 'get_order')) {
            $object = $object->get_order();
        }

        if (!is_object($object) || !is_a($object, 'WC_Order')) {
            return false;
        }

        foreach (array('source', 'sales_channel', 'created_via', '_tm_source', 'tm_source') as $key) {
            $value = strtolower(trim((string) $object->get_meta($key, true)));
            if ($value !== '' && strpos($value, 'tonerymaxim') !== false) {
                return true;
            }
        }

        return false;
    }

    private static function user_id($object): int {
        if (is_numeric($object)) {
            return (int) $object;
        }
        if ($object instanceof WP_User) {
            return (int) $object->ID;
        }
        if (is_object($object) && method_exists($object, 'get_id')) {
            return (int) $object->get_id();
        }
        if (is_object($object) && isset($object->ID)) {
            return (int) $object->ID;
        }
        return 0;
    }

    private static function is_tonerymaxim_user($object): bool {
        $user_id = self::user_id($object);
        if ($user_id <= 0) {
            return false;
        }

        foreach (array('source', 'sales_channel', 'created_via', '_tm_source', 'tm_source') as $key) {
            $value = strtolower(trim((string) get_user_meta($user_id, $key, true)));
            if ($value !== '' && strpos($value, 'tonerymaxim') !== false) {
                return true;
            }
        }

        return false;
    }

    private static function should_suppress($object = null): bool {
        return self::is_flagged_astro_request()
            || self::is_tonerymaxim_order($object)
            || self::is_tonerymaxim_user($object);
    }

    public static function suppress_flagged_wp_mail($short_circuit, $mail_data) {
        unset($mail_data);
        return self::is_flagged_astro_request() ? true : $short_circuit;
    }

    public static function suppress_woo_email($enabled, $object = null, $email = null): bool {
        unset($email);
        return self::should_suppress($object) ? false : (bool) $enabled;
    }

    public static function suppress_password_change_email($send, $user, $userdata = array()): bool {
        unset($userdata);
        return self::should_suppress($user) ? false : (bool) $send;
    }

    public static function suppress_email_change_email($send, $user, $userdata = array()): bool {
        unset($userdata);
        return self::should_suppress($user) ? false : (bool) $send;
    }

    public static function suppress_password_reset_email($send, $user_login, $user_data): bool {
        unset($user_login);
        return self::should_suppress($user_data) ? false : (bool) $send;
    }

    public static function suppress_new_user_email($send, $user): bool {
        return self::should_suppress($user) ? false : (bool) $send;
    }

    public static function register_status_route(): void {
        register_rest_route('tonerymaxim/v1', '/email-policy', array(
            'methods' => WP_REST_Server::READABLE,
            'callback' => array(__CLASS__, 'status'),
            // Endpoint vracia iba neškodný stav ochrany. Musí byť dostupný aj
            // produkčnej diagnostike, pretože WooCommerce API kľúč sa na
            // vlastnom WordPress REST namespace neprekladá na prihláseného
            // používateľa a pôvodná kontrola preto končila chybou HTTP 401.
            'permission_callback' => '__return_true',
        ));
    }

    public static function status(): WP_REST_Response {
        $response = new WP_REST_Response(array(
            'ok' => true,
            'version' => self::VERSION,
            'mode' => 'tonerymaxim-only',
            'wordpress_mail_suppression' => true,
            'woocommerce_order_suppression' => true,
            'coloriq_untouched' => true,
        ), 200);
        $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return $response;
    }
}

ToneryMaxim_Email_Policy::boot();
