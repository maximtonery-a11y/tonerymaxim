<?php
/** Preserve the validated tax-inclusive TM checkout amounts through Woo REST creation. */
if (!defined('ABSPATH')) exit;

final class TM_Checkout_Pricing {
    const CONTRACT = 'gross-v1';
    private static $plans;

    public static function init(): void {
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_filter('woocommerce_rest_pre_insert_shop_order_object', [__CLASS__, 'prepare'], 100, 3);
        add_action('woocommerce_rest_insert_shop_order_object', [__CLASS__, 'finish'], PHP_INT_MAX, 3);
        foreach (['woocommerce_order_item_after_calculate_taxes', 'woocommerce_order_item_fee_after_calculate_taxes', 'woocommerce_order_item_shipping_after_calculate_taxes'] as $hook) {
            add_action($hook, [__CLASS__, 'preserve_line'], PHP_INT_MAX, 1);
        }
    }

    public static function routes(): void {
        register_rest_route('wc/v3', '/tm-pricing-context', ['methods' => 'GET', 'callback' => [__CLASS__, 'context'],
            'permission_callback' => static function () { return current_user_can('manage_woocommerce'); }]);
    }

    private static function rates(): array {
        return WC_Tax::find_rates(['country' => 'SK', 'state' => '', 'postcode' => '', 'city' => '', 'tax_class' => '']);
    }

    public static function context() {
        $rates = self::rates();
        $rate = count($rates) === 1 ? reset($rates) : [];
        return ['contract' => self::CONTRACT, 'rate_id' => count($rates) === 1 ? (int) key($rates) : 0,
            'rate_percent' => (float) ($rate['rate'] ?? 0), 'prices_include_tax' => wc_prices_include_tax(),
            'tax_enabled' => wc_tax_enabled(), 'currency' => get_woocommerce_currency(), 'decimals' => wc_get_price_decimals(),
            'country' => WC()->countries->get_base_country(), 'round_at_subtotal' => get_option('woocommerce_tax_round_at_subtotal') === 'yes',
            'compound' => ($rate['compound'] ?? 'no') !== 'no', 'shipping_taxable' => ($rate['shipping'] ?? 'no') === 'yes'];
    }

    private static function cents($value): int {
        if (!is_scalar($value) || !preg_match('/^-?\d+(?:\.\d{1,2})?$/D', (string) $value) || abs((float) $value) > 10000000) {
            throw new RuntimeException('Neplatná suma objednávky.');
        }
        return (int) round((float) $value * 100);
    }

    private static function parts(int $gross, array $rates): array {
        $sign = $gross < 0 ? -1 : 1;
        // This contract only admits one verified 23% rate. Use integer arithmetic and one
        // final cent rounding: Woo's intermediate 4-decimal rounding can otherwise move 1 cent.
        $tax = intdiv(abs($gross) * 23 + 61, 123) * $sign;
        return ['net' => number_format(($gross - $tax) / 100, 2, '.', ''),
            'taxes' => [(int) key($rates) => number_format($tax / 100, 2, '.', '')]];
    }

    /** Only an explicit, authenticated, new TM REST checkout opts into this contract. */
    public static function prepare($order, $request, $creating) {
        self::$plans = null;
        if (is_wp_error($order) || $order->get_meta('tm_price_contract', true) !== self::CONTRACT) return $order;
        $explicit_update = false;
        foreach ((array) $request->get_param('meta_data') as $meta) {
            if (($meta['key'] ?? '') === 'tm_price_contract' && ($meta['value'] ?? '') === self::CONTRACT) $explicit_update = true;
        }
        if (!$creating && !$explicit_update) return $order;
        try {
            if (!current_user_can('manage_woocommerce') || $request->get_header('x-tonerymaxim-origin') !== 'astro'
                || $order->get_meta('source', true) !== 'tonerymaxim') throw new RuntimeException('Neplatný pôvod objednávky.');
            if (!$creating) {
                $stored = wc_get_order($order->get_id());
                if (!$stored || $stored->get_meta('tm_price_contract', true) !== self::CONTRACT) throw new RuntimeException('Historická objednávka sa automaticky neprepočítava.');
            }
            $context = self::context(); $rates = self::rates(); $rate = count($rates) === 1 ? reset($rates) : [];
            if (!$context['tax_enabled'] || !$context['prices_include_tax'] || $context['currency'] !== 'EUR' || $context['decimals'] !== 2
                || $context['country'] !== 'SK' || $context['round_at_subtotal'] || $context['rate_percent'] != 23
                || ($rate['compound'] ?? 'no') !== 'no' || ($rate['shipping'] ?? 'yes') !== 'yes'
                || $order->get_currency() !== 'EUR' || $order->get_shipping_country() !== 'SK') throw new RuntimeException('Neplatné daňové nastavenia objednávky.');
            $items = $order->get_items(['line_item', 'fee', 'shipping']);
            if (!$items || count($items) > 35 || count($order->get_items('shipping')) !== 1) throw new RuntimeException('Neplatné položky objednávky.');
            $sum = 0; $plan = new WeakMap();
            foreach ($items as $item) {
                $kind = $item->get_type();
                $key = $kind === 'line_item' ? 'tm_gross_line_total' : ($kind === 'shipping' ? 'tm_gross_shipping_total' : 'tm_gross_fee_total');
                $gross = self::cents($item->get_meta($key, true));
                if ($kind !== 'fee' && $gross < 0) throw new RuntimeException('Záporná cena produktu alebo dopravy.');
                if ($kind === 'line_item') {
                    $product = $item->get_product();
                    if ($product && ($product->get_tax_status() !== 'taxable' || $product->get_tax_class() !== '')) throw new RuntimeException('Nepodporovaná daňová trieda produktu.');
                    if (!$product && $item->get_meta('tm_catalog_source', true) !== 'kalendare-2027') throw new RuntimeException('Chýbajúci produkt.');
                    $subtotal = self::cents($item->get_meta('tm_gross_line_subtotal', true));
                    if ($subtotal < $gross) throw new RuntimeException('Neplatná zľava produktu.');
                } else $subtotal = $gross;
                $plan[$item] = ['total' => self::parts($gross, $rates), 'subtotal' => self::parts($subtotal, $rates), 'product' => $kind === 'line_item'];
                $sum += $gross;
            }
            if ($sum < 0 || $sum !== self::cents($order->get_meta('tm_order_total_gross', true))) throw new RuntimeException('Nesúhlasí celková suma objednávky.');
            // Publish the complete plan only after every row and the grand total has been checked.
            self::$plans = $plan;
            foreach ($plan as $item => $entry) self::preserve_line($item);
        } catch (Throwable $error) {
            self::$plans = null;
            return new WP_Error('tm_invalid_checkout_pricing', 'Objednávku nemožno bezpečne uložiť: ' . $error->getMessage(), ['status' => 409]);
        }
        return $order;
    }

    public static function preserve_line($item): void {
        if (!self::$plans || !isset(self::$plans[$item])) return;
        $plan = self::$plans[$item];
        $item->set_total($plan['total']['net']);
        $taxes = ['total' => $plan['total']['taxes']];
        if ($plan['product']) {
            $item->set_subtotal($plan['subtotal']['net']);
            $taxes['subtotal'] = $plan['subtotal']['taxes'];
        }
        $item->set_taxes($taxes);
    }

    public static function finish(): void { self::$plans = null; }
}
add_action('plugins_loaded', ['TM_Checkout_Pricing', 'init']);
