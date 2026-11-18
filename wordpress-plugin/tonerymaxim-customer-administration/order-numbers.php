<?php
if (!defined('ABSPATH')) exit;

final class TM_Order_Numbers {
    public static function valid($value): string {
        if (!is_string($value) && !is_int($value) && !is_float($value)) return '';
        $value = trim((string) $value);
        return strlen($value) <= 80 && preg_match('~^(?:TM[-/]?)?[0-9]+(?:[./-][0-9]+)*$~iD', $value) ? $value : '';
    }

    public static function number($order, string $missing = ''): string {
        foreach (['tm_order_number', 'gopay_order_number', 'tm_order_snapshot'] as $key) {
            foreach ($order->get_meta($key, false, 'edit') as $entry) {
                $value = $entry->value;
                if ($key === 'tm_order_snapshot') {
                    $snapshot = is_string($value) ? json_decode($value, true) : $value;
                    $value = is_array($snapshot) ? ($snapshot['orderNumber'] ?? null) : null;
                }
                $number = self::valid($value);
                if ($number !== '') return $number;
            }
        }
        return $missing;
    }

    public static function label($order, string $prefix = ''): string {
        $number = self::number($order);
        return $number === '' ? 'Objednávka' : $prefix . '#' . $number;
    }

    // Explicit order-number searches also need to find orders outside the recent list.
    public static function find(string $number): array {
        if (self::valid($number) === '') return [];
        $keys = ['relation' => 'OR', ['key' => 'tm_order_number', 'value' => $number], ['key' => 'gopay_order_number', 'value' => $number]];
        // JSON may store a slash as \/. Match a literal portion, then compare the decoded number.
        $fragment = $number;
        if (str_contains($number, '/')) {
            preg_match_all('/[0-9]+/', $number, $digits);
            $parts = array_reverse($digits[0]);
            usort($parts, static fn($a, $b) => strlen($b) <=> strlen($a));
            $fragment = $parts[0];
        }
        $snapshot = [['key' => 'tm_order_snapshot', 'value' => $fragment, 'compare' => 'LIKE']];
        $hpos = class_exists(\Automattic\WooCommerce\Utilities\OrderUtil::class) && \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
        foreach (strlen($number) >= 5 ? [$keys, $snapshot] : [$keys] as $meta_query) {
            $matches = [];
            for ($page = 1; ; $page++) {
                $ids = $hpos
                    ? wc_get_orders(['type' => 'shop_order', 'return' => 'ids', 'limit' => 50, 'page' => $page, 'orderby' => 'ID', 'order' => 'DESC', 'meta_query' => $meta_query])
                    : get_posts(['post_type' => 'shop_order', 'post_status' => array_keys(wc_get_order_statuses()), 'fields' => 'ids', 'posts_per_page' => 50, 'paged' => $page, 'orderby' => 'ID', 'order' => 'DESC', 'meta_query' => $meta_query]);
                foreach ($ids as $id) {
                    $order = wc_get_order($id);
                    if ($order && strcasecmp(self::number($order), $number) === 0) $matches[] = $order;
                }
                if (count($ids) < 50) break;
            }
            if ($matches) return $matches;
        }
        return [];
    }
}
