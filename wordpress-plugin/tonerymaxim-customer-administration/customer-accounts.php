<?php
if (!defined('ABSPATH')) exit;

final class TM_Customer_Accounts {
    // Email matching is deliberately not an account assignment or a permission.
    public static function order_user($order) {
        if (!$order || !is_a($order, 'WC_Order')) return false;
        $id = (int) $order->get_customer_id();
        return $id > 0 ? get_user_by('id', $id) : false;
    }

    public static function registered($order): bool { return (bool) self::order_user($order); }

    public static function badge($order): string {
        return self::registered($order)
            ? '<span class="tm-badge green">Registrovaný · účet #' . (int) $order->get_customer_id() . '</span>'
            : '<span class="tm-badge gray">Neregistrovaný · hosť</span>';
    }
}
