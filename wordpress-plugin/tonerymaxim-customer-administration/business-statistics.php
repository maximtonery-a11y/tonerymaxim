<?php
// Read-only Woo source -> isolated, replaceable reporting index. No order save/mail hooks.
if (!defined('ABSPATH')) exit;

final class TM_Business_Statistics {
    const PAGE = 'tm-customers-statistics';
    const STATE = 'tm_business_stats_build_v1';
    const ACTIVE = 'tm_business_stats_active_v1';
    const SETTINGS = 'tm_business_stats_settings_v1';
    const BATCH = 75;

    public static function init(): void {
        add_action('admin_menu', [__CLASS__, 'menu'], 21);
        add_action('wp_ajax_tm_business_stats_refresh', [__CLASS__, 'ajax_refresh']);
        add_action('tm_business_stats_batch', [__CLASS__, 'cron_batch']);
        add_action('admin_post_tm_business_stats_settings', [__CLASS__, 'save_settings']);
        add_action('admin_post_tm_business_stats_csv', [__CLASS__, 'csv']);
    }
    public static function menu(): void { add_submenu_page('tm-customers', 'Štatistiky a grafy', 'Štatistiky a grafy', 'manage_woocommerce', self::PAGE, [__CLASS__, 'page']); }
    private static function table(): string { global $wpdb; return $wpdb->prefix . 'tm_business_facts_v1'; }
    public static function settings(): array {
        $saved = get_option(self::SETTINGS, []);
        return array_merge(['statuses'=>['processing','completed','tm-paid','tm-processing','tm-shipped'],
            'excluded_emails'=>['info@automatizaciafirmy.sk']], is_array($saved) ? $saved : []);
    }
    public static function timezone(): DateTimeZone { return new DateTimeZone('Europe/Bratislava'); }
    public static function range(string $period, string $anchor, ?DateTimeImmutable $clock = null): array {
        if (!in_array($period, ['day','month','year'], true) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $anchor)) throw new RuntimeException('Vyberte správne obdobie a dátum.');
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $anchor, self::timezone());
        if (!$date || $date->format('Y-m-d') !== $anchor || (int)$date->format('Y') < 2000 || (int)$date->format('Y') > 2100) throw new RuntimeException('Dátum nie je platný.');
        $now = ($clock ?: new DateTimeImmutable('now', self::timezone()))->setTimezone(self::timezone());
        $start = $period === 'day' ? $date : ($period === 'month' ? $date->modify('first day of this month') : $date->setDate((int)$date->format('Y'), 1, 1));
        $next = $start->modify('+1 ' . $period);
        $end = $next < $now ? $next : $now;
        if ($end <= $start) throw new RuntimeException('Budúce obdobie ešte nemá údaje.');
        $previous = $start->modify('-1 ' . $period);
        $previous_end = $previous->add($start->diff($end));
        if ($previous_end > $start) $previous_end = $start;
        return ['period'=>$period,'anchor'=>$anchor,'start'=>$start,'end'=>$end,'previous_start'=>$previous,
            'previous_end'=>$previous_end,'partial'=>$end < $next,'label'=>$period === 'day' ? $start->format('d. m. Y') : ($period === 'month' ? $start->format('m / Y') : $start->format('Y'))];
    }
    public static function cents($value): int { return is_numeric($value) ? (int) round((float)$value * 100) : 0; }
    private static function utc(DateTimeInterface $date): string { return DateTimeImmutable::createFromInterface($date)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'); }
    private static function tm_order($order): bool {
        if (!$order || !is_a($order, 'WC_Order')) return false;
        foreach ([$order->get_meta('source'),$order->get_meta('sales_channel'),$order->get_meta('created_via'),$order->get_created_via(),$order->get_meta('tm_order_number')] as $v) {
            if (str_contains(strtolower((string)$v), 'tonerymaxim') || str_starts_with((string)$v, 'TM-')) return true;
        }
        return false;
    }
    public static function facts($order, array $settings): array {
        if (!self::tm_order($order) || !$order->get_date_created()) return [];
        $email = strtolower(trim((string)$order->get_billing_email()));
        if (in_array($email, $settings['excluded_emails'], true) || in_array((string)$order->get_meta('tm_test_order'), ['1','yes','true'], true)) return [];
        $id = (int)$order->get_id(); $user = TM_Customer_Accounts::order_user($order);
        $key = hash_hmac('sha256', $email !== '' ? $email : ($user ? 'user:' . $user->ID : 'order:' . $id), wp_salt('auth'));
        $snapshot = json_decode((string)$order->get_meta('tm_order_snapshot'), true);
        $snapshot = is_array($snapshot) ? $snapshot : [];
        $gross = isset($snapshot['total']) && is_numeric($snapshot['total']) ? self::cents($snapshot['total'])
            : (is_numeric($order->get_meta('tm_order_total_gross')) ? self::cents($order->get_meta('tm_order_total_gross')) : self::cents($order->get_total()));
        $status = (string)$order->get_status(); $refunds = $order->get_refunds();
        $eligible = in_array($status, $settings['statuses'], true) || (in_array($status, ['refunded','tm-returned'], true) && count($refunds) > 0);
        $tax = abs($gross - self::cents($order->get_total())) <= 1 ? self::cents($order->get_total_tax()) : null;
        $shipping = isset($snapshot['shippingPrice']) && is_numeric($snapshot['shippingPrice']) ? self::cents($snapshot['shippingPrice']) : self::cents((float)$order->get_shipping_total() + (float)$order->get_shipping_tax());
        $discount = isset($snapshot['originalSubtotal'], $snapshot['subtotal'])
            ? self::cents((float)$snapshot['originalSubtotal'] - (float)$snapshot['subtotal'] + (float)($snapshot['couponDiscount'] ?? 0) + (float)($snapshot['loyaltyDiscount'] ?? 0))
            : self::cents((float)$order->get_discount_total() + (float)$order->get_discount_tax());
        $base = ['order_id'=>$id,'occurred'=>self::utc($order->get_date_created()),'status'=>$status,'registered'=>$user ? 1 : 0,
            'customer_key'=>$key,'eligible'=>$eligible ? 1 : 0,'currency'=>$order->get_currency() ?: 'EUR',
            'method'=>(string)($order->get_payment_method_title() ?: 'Neurčené'),'total'=>0,'tax'=>0,'shipping'=>0,'discount'=>0,'quantity'=>0,'sku'=>'','label'=>''];
        $rows = [array_merge($base, ['event_key'=>'o:' . $id,'kind'=>'order','total'=>$gross,'tax'=>$tax,'shipping'=>$shipping,'discount'=>max(0,$discount)])];
        if ($user && !empty($user->user_registered)) $rows[] = self::registration($user);
        foreach ($refunds as $refund) {
            if (!$refund->get_date_created()) continue;
            $refund_tax = self::cents($refund->get_total_tax());
            $rows[] = array_merge($base, ['event_key'=>'r:' . $refund->get_id(),'kind'=>'refund','occurred'=>self::utc($refund->get_date_created()),
                'total'=>-abs(self::cents($refund->get_amount())),'tax'=>-abs($refund_tax),
                'shipping'=>-abs(self::cents((float)$refund->get_shipping_total() + (float)$refund->get_shipping_tax()))]);
        }
        $items = $snapshot['items'] ?? [];
        if (!is_array($items) || !$items) {
            $items = [];
            foreach ($order->get_items('line_item') as $item_id=>$item) $items[] = ['sku'=>'produkt-' . $item->get_product_id(),'name'=>$item->get_name(),'qty'=>$item->get_quantity()];
        }
        foreach ($items as $index=>$item) {
            $qty = (float)($item['qty'] ?? 0); if ($qty <= 0) continue;
            $sku = trim((string)($item['sku'] ?? '')) ?: 'bez-sku-' . $id . '-' . $index;
            $rows[] = array_merge($base, ['event_key'=>'p:' . $id . ':' . $index,'kind'=>'product','quantity'=>$qty,
                'sku'=>mb_substr($sku,0,100),'label'=>mb_substr((string)($item['name'] ?? $sku),0,250)]);
        }
        return $rows;
    }
    private static function registration($user): array {
        $date = new DateTimeImmutable($user->user_registered, new DateTimeZone('UTC'));
        return ['event_key'=>'u:' . (int)$user->ID,'kind'=>'registration','order_id'=>0,'occurred'=>self::utc($date),
            'status'=>'','registered'=>1,'customer_key'=>'','eligible'=>0,'currency'=>'EUR','method'=>'','total'=>0,
            'tax'=>0,'shipping'=>0,'discount'=>0,'quantity'=>0,'sku'=>'','label'=>''];
    }
    private static function schema(): void {
        if (get_option('tm_business_stats_schema_v1') === '1') return;
        global $wpdb;
        if (!function_exists('dbDelta')) require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = self::table();
        dbDelta("CREATE TABLE $table (
            generation varchar(32) NOT NULL, event_key varchar(64) NOT NULL, kind varchar(16) NOT NULL,
            order_id bigint unsigned NOT NULL DEFAULT 0, occurred datetime NOT NULL, status varchar(32) NOT NULL DEFAULT '',
            registered tinyint NOT NULL DEFAULT 0, customer_key char(64) NOT NULL DEFAULT '', eligible tinyint NOT NULL DEFAULT 0,
            currency varchar(3) NOT NULL DEFAULT 'EUR', method varchar(128) NOT NULL DEFAULT '', total bigint NOT NULL DEFAULT 0,
            tax bigint DEFAULT NULL, shipping bigint NOT NULL DEFAULT 0, discount bigint NOT NULL DEFAULT 0,
            quantity decimal(18,3) NOT NULL DEFAULT 0, sku varchar(100) NOT NULL DEFAULT '', label varchar(250) NOT NULL DEFAULT '',
            PRIMARY KEY  (generation,event_key), KEY timeline (generation,kind,occurred),
            KEY customers (generation,customer_key,kind,eligible,occurred)
        ) " . $wpdb->get_charset_collate() . ';');
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) !== $table) throw new RuntimeException('Úložisko štatistík sa nepodarilo pripraviť.');
        update_option('tm_business_stats_schema_v1','1',false);
    }
    private static function schedule(): void { if (!wp_next_scheduled('tm_business_stats_batch')) wp_schedule_single_event(time()+10, 'tm_business_stats_batch'); }
    public static function refresh(bool $restart = false): array {
        self::schema(); global $wpdb;
        $lock = 'tm_stats_' . substr(hash('sha256', $wpdb->prefix),0,40);
        if ((int)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock)) !== 1) return ['busy'=>true];
        try {
            $state = get_option(self::STATE, []);
            if (!$state || $restart) {
                $state = ['generation'=>bin2hex(random_bytes(16)),'phase'=>'orders','page'=>1,'scanned'=>0,'tm_orders'=>0,
                    'started'=>time(),'settings'=>self::settings(),'total'=>0];
                update_option(self::STATE,$state,false);
            }
            $table = self::table();
            $write = function(array $row) use ($wpdb,$table,$state) {
                $row['generation']=$state['generation'];
                if ($wpdb->replace($table,$row) === false) throw new RuntimeException('Výpočet štatistík sa prerušil. Predchádzajúci prehľad zostáva zachovaný.');
            };
            if ($state['phase'] === 'orders') {
                $result = wc_get_orders(['type'=>'shop_order','limit'=>self::BATCH,'paged'=>$state['page'],'paginate'=>true,
                    'orderby'=>'id','order'=>'ASC','date_created'=>'<=' . $state['started'],'status'=>array_keys(wc_get_order_statuses())]);
                if (!is_object($result) || !isset($result->orders,$result->total)) throw new RuntimeException('Objednávky sa nepodarilo načítať.');
                $state['total']=(int)$result->total;
                foreach ($result->orders as $order) {
                    $facts=self::facts($order,$state['settings']);
                    if ($facts) $state['tm_orders']++;
                    foreach ($facts as $row) $write($row);
                    $state['scanned']++;
                }
                if ($state['page'] >= max(1,(int)$result->max_num_pages)) { $state['phase']='users'; $state['page']=1; }
                else $state['page']++;
            } else {
                $users=get_users(['role__in'=>['customer','subscriber'],'number'=>self::BATCH,'paged'=>$state['page'],
                    'orderby'=>'ID','order'=>'ASC','meta_query'=>['relation'=>'OR',
                        ['key'=>'source','value'=>'tonerymaxim','compare'=>'LIKE'],['key'=>'sales_channel','value'=>'tonerymaxim','compare'=>'LIKE']]]);
                foreach ($users as $user) if (!in_array(strtolower(trim($user->user_email)),$state['settings']['excluded_emails'],true)) $write(self::registration($user));
                if (count($users) < self::BATCH) {
                    $active=['generation'=>$state['generation'],'updated'=>time(),'tm_orders'=>$state['tm_orders'],'settings'=>$state['settings']];
                    update_option(self::ACTIVE,$active,false);
                    delete_option(self::STATE);
                    // Only disposable analytics cache generations; never orders, users, invoices or their metadata.
                    $wpdb->query($wpdb->prepare("DELETE FROM $table WHERE generation <> %s",$state['generation']));
                    return ['done'=>true,'orders'=>$state['tm_orders']];
                }
                $state['page']++;
            }
            update_option(self::STATE,$state,false); self::schedule();
            return ['done'=>false,'scanned'=>$state['scanned'],'total'=>$state['total'],'phase'=>$state['phase']];
        } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)',$lock)); }
    }
    public static function cron_batch(): void { if (!get_option(self::STATE)) return; try { self::refresh(); } catch (Throwable $e) { /* Resume is available in the protected dashboard. */ } }
    public static function ajax_refresh(): void {
        if (!current_user_can('manage_woocommerce')) wp_send_json_error(['message'=>'Prístup nie je povolený.'],403);
        check_ajax_referer('tm_business_stats');
        $active=get_option(self::ACTIVE,[]);
        if (!get_option(self::STATE) && $active && $active['generation'] !== (string)($_POST['generation']??'')) {
            wp_send_json_success(['done'=>true,'orders'=>$active['tm_orders']]);
            return;
        }
        try { wp_send_json_success(self::refresh()); } catch (Throwable $e) { wp_send_json_error(['message'=>'Aktualizácia sa nepodarila. Pôvodné údaje zostali zachované; skúste Obnoviť údaje.'],503); }
    }
    private static function empty_summary(): array {
        return ['gross'=>0,'tax'=>0,'shipping'=>0,'discount'=>0,'refunds'=>0,'orders'=>0,'sales_orders'=>0,
            'registered_orders'=>0,'guest_orders'=>0,'pending'=>0,'pending_total'=>0,'cancelled'=>0,'returned'=>0,
            'registrations'=>0,'unknown_tax'=>0,'foreign'=>0,'unclassified'=>0,'buyers'=>[],'guest_buyers'=>[],
            'registered_buyers'=>[],'new'=>0,'returning'=>0,'series'=>[],'products'=>[],'methods'=>[],'statuses'=>[]];
    }
    public static function summarize(iterable $rows, array $first, array $range): array {
        $out=self::empty_summary();
        $begin=self::utc($range['start']); $end=self::utc($range['end']);
        foreach ($rows as $row) {
            if ($row['occurred'] < $begin || $row['occurred'] >= $end) continue;
            if ($row['kind']==='registration') { $out['registrations']++; continue; }
            if ($row['currency']!=='EUR') { if ($row['kind']==='order') $out['foreign']++; continue; }
            $local=(new DateTimeImmutable($row['occurred'],new DateTimeZone('UTC')))->setTimezone(self::timezone());
            $bucket=$range['period']==='day' ? $local->format('H') : ($range['period']==='month' ? $local->format('d') : $local->format('m'));
            if (!isset($out['series'][$bucket])) $out['series'][$bucket]=['gross'=>0,'orders'=>0];
            if ($row['kind']==='order') {
                $out['orders']++; $out[$row['registered'] ? 'registered_orders':'guest_orders']++;
                $out['statuses'][$row['status']]=($out['statuses'][$row['status']]??0)+1;
                if (in_array($row['status'],['pending','on-hold','tm-await-pay'],true)) { $out['pending']++; $out['pending_total']+=(int)$row['total']; }
                if (in_array($row['status'],['cancelled','failed'],true)) $out['cancelled']++;
                if (in_array($row['status'],['refunded','tm-returned'],true)) $out['returned']++;
                if (str_starts_with($row['status'],'tm-mail-') && !$row['eligible']) $out['unclassified']++;
                if (!$row['eligible']) continue;
                $out['sales_orders']++; $out['series'][$bucket]['orders']++;
                $out['buyers'][$row['customer_key']]=true;
                $out[$row['registered'] ? 'registered_buyers':'guest_buyers'][$row['customer_key']]=true;
                $out['methods'][$row['method']]=($out['methods'][$row['method']]??0)+(int)$row['total'];
                $out['discount']+=(int)$row['discount'];
            } elseif (!$row['eligible']) continue;
            if ($row['kind']==='product') {
                $sku=$row['sku'];
                if (!isset($out['products'][$sku])) $out['products'][$sku]=['name'=>$row['label'],'qty'=>0];
                $out['products'][$sku]['qty']+=(float)$row['quantity']; continue;
            }
            $out['gross']+=(int)$row['total']; $out['series'][$bucket]['gross']+=(int)$row['total'];
            if ($row['tax']===null) $out['unknown_tax']++; else $out['tax']+=(int)$row['tax'];
            $out['shipping']+=(int)$row['shipping'];
            if ($row['kind']==='refund') $out['refunds']+=abs((int)$row['total']);
        }
        foreach ($out['buyers'] as $key=>$_) {
            if (isset($first[$key]) && $first[$key] >= $begin && $first[$key] < $end) $out['new']++;
            else $out['returning']++;
        }
        uasort($out['products'],fn($a,$b)=>$b['qty']<=>$a['qty']); arsort($out['methods']);
        return $out;
    }
    private static function rows(string $generation, string $start, string $end): Generator {
        global $wpdb; $table=self::table(); $offset=0;
        do {
            $batch=$wpdb->get_results($wpdb->prepare("SELECT * FROM $table WHERE generation=%s AND occurred >= %s AND occurred < %s ORDER BY event_key LIMIT 500 OFFSET %d",$generation,$start,$end,$offset),ARRAY_A);
            if ($wpdb->last_error) throw new RuntimeException('Štatistiky sa nepodarilo načítať.');
            foreach ($batch as $row) yield $row;
            $offset+=500;
        } while (count($batch)===500);
    }
    public static function report(array $range): array {
        $active=get_option(self::ACTIVE,[]); if (!$active) return [];
        global $wpdb; $table=self::table(); $gen=$active['generation'];
        $from=self::utc($range['previous_start']); $to=self::utc($range['end']);
        $first_rows=$wpdb->get_results($wpdb->prepare("SELECT f.customer_key,MIN(f.occurred) first_at FROM $table f INNER JOIN
            (SELECT DISTINCT customer_key FROM $table WHERE generation=%s AND kind='order' AND eligible=1 AND occurred >= %s AND occurred < %s) recent
            ON recent.customer_key=f.customer_key WHERE f.generation=%s AND f.kind='order' AND f.eligible=1 AND f.currency='EUR' GROUP BY f.customer_key",$gen,$from,$to,$gen),ARRAY_A);
        if ($wpdb->last_error) throw new RuntimeException('Históriu zákazníkov sa nepodarilo načítať.');
        $first=[]; foreach ($first_rows as $row) $first[$row['customer_key']]=$row['first_at'];
        $previous=$range; $previous['start']=$range['previous_start']; $previous['end']=$range['previous_end'];
        return ['current'=>self::summarize(self::rows($gen,self::utc($range['start']),$to),$first,$range),
            'previous'=>self::summarize(self::rows($gen,$from,self::utc($range['previous_end'])),$first,$previous),'active'=>$active];
    }
    private static function money(int $cents): string { return number_format_i18n($cents/100,2) . ' €'; }
    public static function change(float $now, float $before): string { return $before==0 ? ($now==0 ? 'Bez zmeny' : 'Bez porovnateľného základu') : (($now-$before)>=0 ? '+' : '') . number_format_i18n(100*($now-$before)/abs($before),1) . ' %'; }
    private static function kpi(string $label, string $value, string $hint, ?string $change=null): void {
        echo '<div class="tm-card tm-kpi"><span>' . esc_html($label) . '</span><strong>' . esc_html($value) . '</strong><small>' . esc_html($hint) . '</small>';
        if ($change!==null) echo '<p class="tm-trend">' . esc_html($change) . ' <span>oproti porovnaniu</span></p>';
        echo '</div>';
    }
    private static function chart(array $current, array $previous, array $range, string $metric): void {
        $count=$range['period']==='day' ? 24 : ($range['period']==='month' ? (int)$range['start']->format('t') : 12);
        if ($range['partial']) $count=$range['period']==='day' ? (int)$range['end']->format('H')+1 : (int)$range['end']->format($range['period']==='month'?'d':'m');
        $keys=[]; for($i=0;$i<$count;$i++) $keys[]=str_pad((string)($range['period']==='day' ? $i : $i+1),2,'0',STR_PAD_LEFT);
        $values=[]; foreach($keys as $key) { $values[]=$current[$key][$metric]??0; $values[]=$previous[$key][$metric]??0; }
        $min=min(0,...$values); $max=max(1,...$values); $span=$max-$min;
        $xy=function($index,$value) use($count,$min,$span) { return [60+$index*800/max(1,$count-1),220-($value-$min)*175/$span]; };
        echo '<div data-chart="' . esc_attr($metric) . '"' . ($metric==='orders'?' hidden':'') . '><svg viewBox="0 0 900 270" role="img" aria-label="' . ($metric==='gross'?'Vývoj obratu v eurách':'Vývoj počtu započítaných objednávok') . '" class="tm-stats-chart">';
        for($i=0;$i<=4;$i++) { $v=$min+$i*$span/4; [, $y]=$xy(0,$v); echo '<line x1="60" y1="'.$y.'" x2="865" y2="'.$y.'" stroke="#e3eaf3"/><text x="50" y="'.($y+4).'" text-anchor="end">'.esc_html($metric==='gross'?number_format_i18n($v/100,0):number_format_i18n($v,1)).'</text>'; }
        foreach (['previous'=>$previous,'current'=>$current] as $which=>$series) {
            $series_keys=$keys;
            if ($which==='previous' && $range['period']==='month') $series_keys=array_slice($keys,0,(int)$range['previous_start']->format('t'));
            $points=[];
            foreach($series_keys as $i=>$key) { $value=$series[$key][$metric]??0; [$x,$y]=$xy($i,$value); $points[]=$x.','.$y; }
            echo '<polyline points="'.esc_attr(implode(' ',$points)).'" fill="none" stroke="'.($which==='current'?'#1264d5':'#9baac0').'" stroke-width="3"'.($which==='previous'?' stroke-dasharray="6 5"':'').'/>';
            foreach($series_keys as $i=>$key) { $value=$series[$key][$metric]??0; [$x,$y]=$xy($i,$value);
                echo '<circle tabindex="0" cx="'.$x.'" cy="'.$y.'" r="4" fill="'.($which==='current'?'#1264d5':'#9baac0').'"><title>'.esc_html(($which==='current'?'Vybrané':'Porovnanie').' · '.$key.' · '.($metric==='gross'?self::money((int)$value):(string)$value.' objednávok')).'</title></circle>';
                if($which==='current' && ($i % max(1,(int)ceil($count/12))===0 || $i===$count-1)) echo '<text x="'.$x.'" y="250" text-anchor="middle">'.esc_html($key).'</text>';
            }
        }
        echo '</svg></div>';
    }
    public static function save_settings(): void {
        if (!current_user_can('manage_woocommerce')) wp_die('Prístup nie je povolený.','',['response'=>403]);
        check_admin_referer('tm_business_stats_settings');
        $allowed=array_map(fn($v)=>substr($v,3),array_keys(wc_get_order_statuses()));
        $statuses=array_values(array_intersect($allowed,array_map('sanitize_key',is_array($_POST['statuses']??null)?$_POST['statuses']:[])));
        $emails=array_values(array_unique(array_filter(array_map(fn($v)=>strtolower(trim($v)),preg_split('/[\s,;]+/',(string)wp_unslash($_POST['excluded_emails']??''))), 'is_email')));
        update_option(self::SETTINGS,['statuses'=>$statuses,'excluded_emails'=>$emails],false);
        // A completed generation remains readable until its replacement is complete.
        delete_option(self::STATE);
        wp_safe_redirect(admin_url('admin.php?page='.self::PAGE.'&refresh=1')); exit;
    }
    public static function csv(): void {
        if (!current_user_can('manage_woocommerce')) wp_die('Prístup nie je povolený.','',['response'=>403]);
        check_admin_referer('tm_business_stats_csv');
        try { $range=self::range((string)($_GET['period']??'month'),(string)($_GET['date']??current_time('Y-m-d'))); $report=self::report($range); }
        catch(Throwable $e) { wp_die('Export sa nepodaril.','',['response'=>400]); }
        if (!$report) wp_die('Štatistiky ešte nie sú pripravené.');
        nocache_headers(); header('Content-Type: text/csv; charset=utf-8'); header('Content-Disposition: attachment; filename="tm-statistiky-'.$range['anchor'].'.csv"');
        $out=fopen('php://output','w'); fwrite($out,"\xEF\xBB\xBF");
        fputcsv($out,['Ukazovateľ','Vybrané obdobie','Porovnanie'],';','"','');
        foreach(['gross'=>'Obrat s DPH po vratkách (EUR)','orders'=>'Všetky objednávky','sales_orders'=>'Objednávky v obrate','registered_orders'=>'Objednávky registrovaných','guest_orders'=>'Objednávky hostí','registrations'=>'Nové registrácie','new'=>'Noví nakupujúci','returning'=>'Opakovaní nakupujúci','refunds'=>'Vratky s DPH (EUR)','cancelled'=>'Stornované a neúspešné'] as $key=>$label) {
            $money=in_array($key,['gross','refunds'],true); fputcsv($out,[$label,$report['current'][$key]/($money?100:1),$report['previous'][$key]/($money?100:1)],';','"','');
        }
        fclose($out); exit;
    }
    public static function page(): void {
        if (!current_user_can('manage_woocommerce')) wp_die('Prístup nie je povolený.','',['response'=>403]);
        nocache_headers();
        $period=(string)($_GET['period']??'month'); $date=(string)($_GET['date']??current_time('Y-m-d'));
        try { $range=self::range($period,$date); $report=self::report($range); }
        catch(Throwable $e) { echo '<div class="wrap"><h1>Štatistiky a grafy</h1><p>'.esc_html($e->getMessage()).'</p></div>'; return; }
        $active=get_option(self::ACTIVE,[]); $building=get_option(self::STATE,[]); $settings=self::settings();
        $needs=!$active || $building || time()-(int)($active['updated']??0)>900 || ($active['settings']??[])!==$settings;
        ?>
        <div class="wrap tm-wrap tm-statistics"><div class="tm-head"><div><p class="tm-eyebrow">TONERYMAXIM · PREHĽAD PODNIKANIA</p><h1>Štatistiky a grafy</h1><p class="tm-muted">Predaje, zákazníci a výsledky vášho e-shopu na jednom mieste.</p></div><div class="tm-actions"><button id="tm-stats-refresh" class="button button-primary">Obnoviť údaje</button><a class="button" href="<?php echo esc_url(admin_url('admin.php?page=tm-customers-orders')); ?>">TM objednávky</a></div></div>
        <div class="tm-card tm-stats-toolbar"><form method="get" class="tm-actions"><input type="hidden" name="page" value="<?php echo self::PAGE; ?>"><label>Obdobie <select name="period"><option value="day" <?php selected($period,'day'); ?>>Deň</option><option value="month" <?php selected($period,'month'); ?>>Mesiac</option><option value="year" <?php selected($period,'year'); ?>>Rok</option></select></label><label>Dátum v období <input type="date" name="date" value="<?php echo esc_attr($date); ?>" max="<?php echo esc_attr(current_time('Y-m-d')); ?>" required></label><button class="button">Zobraziť</button><?php if($report): ?><a class="button" href="<?php echo esc_url(wp_nonce_url(add_query_arg(['action'=>'tm_business_stats_csv','period'=>$period,'date'=>$date],admin_url('admin-post.php')),'tm_business_stats_csv')); ?>">Export CSV</a><?php endif; ?></form><p class="tm-muted"><?php echo esc_html($range['label']); ?><?php echo $range['partial']?' · priebežné obdobie':''; ?> · Eurá · čas Europe/Bratislava<br>Porovnanie: <?php echo esc_html($range['previous_start']->format('d. m. Y H:i').' – '.$range['previous_end']->format('d. m. Y H:i')); ?>. <?php if($active) echo 'Údaje aktualizované '.esc_html(wp_date('d. m. Y H:i',(int)$active['updated'],self::timezone())).'.'; ?></p><p id="tm-stats-progress" role="status" aria-live="polite"></p></div>
        <?php if(!$report): ?><div class="tm-card"><h2>Pripravujeme prvý prehľad</h2><p>História objednávok sa načíta po menších dávkach. Údaje sa zobrazia po dokončení, aby čiastočné súčty nepôsobili ako konečné výsledky.</p></div><?php else:
        $c=$report['current']; $p=$report['previous']; $buyers=count($c['buyers']); $aov=$c['sales_orders'] ? (int)round(($c['gross']+$c['refunds'])/$c['sales_orders']) : 0; $paov=$p['sales_orders'] ? (int)round(($p['gross']+$p['refunds'])/$p['sales_orders']) : 0;
        ?><div class="tm-stats-kpis"><?php
        self::kpi('Obrat objednávok',self::money($c['gross']),'S DPH a dopravou, po skutočných vratkách',self::change($c['gross'],$p['gross']));
        self::kpi('Objednávky',(string)$c['orders'],$c['sales_orders'].' započítaných do obratu',self::change($c['orders'],$p['orders']));
        self::kpi('Priemerná objednávka',self::money($aov),'S DPH, pred vratkami',self::change($aov,$paov));
        self::kpi('Noví nakupujúci',(string)$c['new'],'Prvý započítaný nákup v histórii TM',self::change($c['new'],$p['new']));
        self::kpi('Nové registrácie',(string)$c['registrations'],'Vytvorené TM účty, aj bez objednávky',self::change($c['registrations'],$p['registrations']));
        self::kpi('Opakovaní nakupujúci',(string)$c['returning'],$buyers ? number_format_i18n(100*$c['returning']/$buyers,1).' % z nakupujúcich' : 'Zatiaľ bez nákupov',self::change($c['returning'],$p['returning']));
        ?></div><div class="tm-stats-layout"><section class="tm-card tm-stats-wide"><div class="tm-head"><div><h2>Vývoj predaja</h2><p class="tm-muted">Modrá: vybrané obdobie · prerušovaná sivá: porovnanie. Presnú hodnotu ukáže bod grafu.</p></div><div class="tm-actions" id="tm-chart-switch"><button type="button" class="button button-primary" data-metric="gross" aria-pressed="true">Obrat</button><button type="button" class="button" data-metric="orders" aria-pressed="false">Objednávky</button></div></div><?php self::chart($c['series'],$p['series'],$range,'gross'); self::chart($c['series'],$p['series'],$range,'orders'); ?></section>
        <section class="tm-card"><h2>Registrovaní a hostia</h2><p class="tm-muted">Rozdelenie všetkých objednávok podľa priradeného účtu.</p><?php $share=$c['orders'] ? 100*$c['registered_orders']/$c['orders'] : 0; ?><div class="tm-donut" role="img" aria-label="<?php echo esc_attr($c['registered_orders'].' objednávok registrovaných, '.$c['guest_orders'].' objednávok hostí'); ?>" style="--share:<?php echo (float)$share; ?>%"><span><?php echo (int)$c['orders']; ?><small>objednávok</small></span></div><p><i class="tm-dot"></i> Registrovaní <strong><?php echo (int)$c['registered_orders']; ?></strong></p><p><i class="tm-dot guest"></i> Neregistrovaní <strong><?php echo (int)$c['guest_orders']; ?></strong></p><p class="tm-muted">Nakupujúci s účtom: <?php echo count($c['registered_buyers']); ?> · bez účtu: <?php echo count($c['guest_buyers']); ?>. Jeden človek môže nakupovať oboma spôsobmi.</p></section>
        <section class="tm-card"><h2>Čomu venovať pozornosť</h2><div class="tm-note">Čakajúce na úhradu / potvrdenie: <strong><?php echo (int)$c['pending']; ?></strong> · <?php echo esc_html(self::money($c['pending_total'])); ?></div><div class="tm-note">Stornované / neúspešné: <strong><?php echo (int)$c['cancelled']; ?></strong></div><div class="tm-note">Vrátené objednávky: <strong><?php echo (int)$c['returned']; ?></strong> · finančné vratky <?php echo esc_html(self::money($c['refunds'])); ?></div><?php if($p['gross']>0 && $c['gross']<$p['gross']*0.9): ?><p class="tm-danger">Obrat klesol o viac ako 10 %. Skontrolujte počet objednávok, priemerný nákup a podiel opakovaných zákazníkov.</p><?php endif; ?><?php if($c['unclassified']): ?><p class="tm-danger"><?php echo (int)$c['unclassified']; ?> objednávok má vlastný e-mailový stav mimo obratu. Skontrolujte započítané stavy nižšie.</p><?php endif; ?><?php if($c['foreign']): ?><p><?php echo (int)$c['foreign']; ?> objednávok v inej mene nie je sčítaných s EUR.</p><?php endif; ?><p class="tm-muted">Prehľad objednávok nie je bankový výpis ani účtovná evidencia prijatých platieb.</p></section>
        <section class="tm-card"><h2>Predaj podľa platby</h2><p class="tm-muted">Započítané objednávky pred vratkami.</p><?php if(!$c['methods']) echo '<p class="tm-muted">V období nie sú započítané predaje.</p>'; $maximum=max(1,...array_values($c['methods'])); foreach($c['methods'] as $method=>$amount): ?><div class="tm-bar-row"><span><?php echo esc_html($method); ?></span><strong><?php echo esc_html(self::money($amount)); ?></strong><div><i style="width:<?php echo max(0,100*$amount/$maximum); ?>%"></i></div></div><?php endforeach; ?></section>
        <section class="tm-card"><h2>Rozpad obratu</h2><table class="tm-table"><tbody><tr><td>Obrat s DPH po vratkách</td><td><?php echo esc_html(self::money($c['gross'])); ?></td></tr><tr><td>DPH</td><td><?php echo $c['unknown_tax']?'Nedostupné pre celý výber':esc_html(self::money($c['tax'])); ?></td></tr><tr><td>Obrat bez DPH, vrátane dopravy</td><td><?php echo $c['unknown_tax']?'Nedostupné pre celý výber':esc_html(self::money($c['gross']-$c['tax'])); ?></td></tr><tr><td>Účtovaná doprava s DPH po vratkách</td><td><?php echo esc_html(self::money($c['shipping'])); ?></td></tr><tr><td>Zľavy s DPH pred vratkami</td><td><?php echo esc_html(self::money($c['discount'])); ?></td></tr></tbody></table><?php if($c['unknown_tax']): ?><p class="tm-muted">Pri <?php echo (int)$c['unknown_tax']; ?> dokladoch sa TM suma nezhoduje s Woo súčtom. Obrat berieme z uloženého TM súhrnu; DPH neodhadujeme.</p><?php endif; ?></section>
        <section class="tm-card tm-stats-wide"><h2>Najpredávanejšie SKU</h2><p class="tm-muted">Objednané kusy v započítaných objednávkach pred vratkami. Pri starých položkách bez uloženého SKU je uvedené ID produktu.</p><div class="tm-stats-table"><table class="tm-table"><thead><tr><th>SKU</th><th>Produkt</th><th>Kusy</th></tr></thead><tbody><?php if(!$c['products']) echo '<tr><td colspan="3">Zatiaľ bez položiek.</td></tr>'; foreach(array_slice($c['products'],0,12,true) as $sku=>$product) echo '<tr><td>'.esc_html($sku).'</td><td>'.esc_html($product['name']).'</td><td>'.esc_html(number_format_i18n($product['qty'],0)).'</td></tr>'; ?></tbody></table></div></section>
        <section class="tm-card"><h2>Noví a opakovaní nakupujúci</h2><?php foreach(['new'=>'Noví','returning'=>'Opakovaní'] as $key=>$label): ?><div class="tm-bar-row"><span><?php echo esc_html($label); ?></span><strong><?php echo (int)$c[$key]; ?></strong><div><i style="width:<?php echo $buyers ? 100*$c[$key]/$buyers : 0; ?>%"></i></div></div><?php endforeach; ?><p class="tm-muted">Rovnaký fakturačný e-mail spája históriu nákupov aj po registrácii. Tento štatistický prepočet nikdy nemení vlastníctvo objednávky ani prístup k faktúram.</p></section></div>
        <details class="tm-card" style="margin-top:20px"><summary>Podrobná tabuľka hodnôt grafu</summary><table class="tm-table"><thead><tr><th>Interval</th><th>Obrat</th><th>Porovnanie obratu</th><th>Objednávky</th></tr></thead><tbody><?php $keys=array_unique(array_merge(array_keys($c['series']),array_keys($p['series']))); sort($keys); foreach($keys as $key) echo '<tr><td>'.esc_html((string)$key).'</td><td>'.esc_html(self::money((int)($c['series'][$key]['gross']??0))).'</td><td>'.esc_html(self::money((int)($p['series'][$key]['gross']??0))).'</td><td>'.(int)($c['series'][$key]['orders']??0).'</td></tr>'; ?></tbody></table></details>
        <?php endif; ?>
        <details class="tm-card" style="margin-top:20px"><summary>Ako sa počítajú čísla a čo treba ešte merať</summary><p>Zdrojom sú všetky dostupné TM objednávky v tomto Woo, nie iba posledných 500. Vratky sa odpočítajú v deň skutočnej refundácie. Plne refundovaná objednávka zachová pôvodný predaj a samostatnú vratku; označenie „vrátená“ bez finančnej refundácie nie je dokladom o vrátení peňazí.</p><p>Nový nakupujúci = prvý započítaný nákup v dostupnej histórii TM. Nová registrácia = vznik TM účtu. Registrovaná objednávka musí mať priradený existujúci účet; samotný e-mail nestačí. Aktuálne obdobie porovnávame s rovnakou uplynutou časťou predchádzajúceho obdobia, najviac po jeho koniec.</p><p>Pre konverzný pomer, opustené košíky a cenu získania zákazníka treba spoľahlivú návštevnosť a reklamné náklady. Pre maržu a zisk treba nákupné ceny, reálne náklady dopravy a poplatky. Tieto metriky sa bez takých údajov nezobrazujú ako nula. Prehľad nezahŕňa históriu, ktorá nebola prenesená do Woo.</p><p>Vzory: <a href="https://woocommerce.com/document/woocommerce-analytics/" target="_blank" rel="noopener noreferrer">WooCommerce Analytics</a> · <a href="https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard/using-the-overview-dashboard" target="_blank" rel="noopener noreferrer">Shopify Analytics</a>.</p></details>
        <details class="tm-card" style="margin-top:20px"><summary>Nastavenie obratu a vylúčenie testovacích objednávok</summary><form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="tm_business_stats_settings"><?php wp_nonce_field('tm_business_stats_settings'); ?><p>Započítané stavy (nejde o zmenu stavu objednávok):</p><div class="tm-status-checkboxes"><?php foreach(wc_get_order_statuses() as $slug=>$label): $key=substr($slug,3); ?><label><input type="checkbox" name="statuses[]" value="<?php echo esc_attr($key); ?>" <?php checked(in_array($key,$settings['statuses'],true)); ?>> <?php echo esc_html($label); ?></label><?php endforeach; ?></div><p><label>Vylúčené testovacie e-maily, jeden na riadok<br><textarea name="excluded_emails" rows="3" style="width:100%;max-width:600px"><?php echo esc_textarea(implode("\n",$settings['excluded_emails'])); ?></textarea></label></p><p><button class="button">Uložiť a prepočítať</button></p></form></details></div>
        <style>.tm-statistics .tm-eyebrow{font-size:11px;letter-spacing:1.8px;font-weight:800;color:#68758a}.tm-stats-toolbar{margin-bottom:20px}.tm-stats-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:20px 0}.tm-stats-kpis strong{font-size:30px}.tm-stats-kpis small{display:block;margin-top:8px}.tm-trend{font-weight:700;color:#1264d5;margin-bottom:0}.tm-trend span{font-size:11px;font-weight:400;color:#68758a}.tm-stats-layout{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.tm-stats-wide{grid-column:span 2}.tm-stats-chart{width:100%;height:auto;min-height:220px}.tm-stats-chart text{font:11px system-ui;fill:#68758a}.tm-stats-chart circle:hover,.tm-stats-chart circle:focus{r:7;outline:2px solid #1264d5}.tm-donut{width:160px;height:160px;margin:22px auto;border-radius:50%;background:conic-gradient(#1264d5 0 var(--share),#bcc8da var(--share) 100%);display:grid;place-items:center}.tm-donut span{border-radius:50%;width:112px;height:112px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:white;font-size:28px;font-weight:800}.tm-donut small{font-size:11px;font-weight:400}.tm-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#1264d5;margin-right:6px}.tm-dot.guest{background:#bcc8da}.tm-bar-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin:18px 0}.tm-bar-row>div{grid-column:span 2;height:8px;background:#edf2f8;border-radius:8px;overflow:hidden}.tm-bar-row i{display:block;height:100%;background:#1264d5;border-radius:8px}.tm-status-checkboxes{display:flex;flex-wrap:wrap;gap:14px}.tm-statistics summary{cursor:pointer;font-weight:700}.tm-stats-table{overflow:auto}.tm-statistics [hidden]{display:none!important}@media(max-width:1200px){.tm-stats-layout{grid-template-columns:repeat(2,minmax(0,1fr))}.tm-stats-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.tm-stats-layout,.tm-stats-kpis{grid-template-columns:1fr}.tm-stats-wide{grid-column:auto}.tm-stats-chart{min-height:160px}.tm-stats-toolbar label{display:block}}</style>
        <script>(()=>{const button=document.getElementById('tm-stats-refresh'),status=document.getElementById('tm-stats-progress');let running=false;
        const config=<?php echo wp_json_encode(['url'=>admin_url('admin-ajax.php'),'nonce'=>wp_create_nonce('tm_business_stats'),'needs'=>(bool)$needs,'generation'=>$active['generation']??''],JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT); ?>;
        async function update(){if(running)return;running=true;button.disabled=true;try{let done=false;while(!done){const body=new URLSearchParams({action:'tm_business_stats_refresh',_ajax_nonce:config.nonce,generation:config.generation});const r=await fetch(config.url,{method:'POST',credentials:'same-origin',body});const v=await r.json();if(!r.ok||!v.success)throw new Error(v.data?.message||'Aktualizácia sa nepodarila.');done=v.data.done===true;status.textContent=done?'Údaje sú pripravené.':'Aktualizujeme prehľad: '+(v.data.scanned||0)+' / '+(v.data.total||'…')+' objednávok'+(v.data.phase==='users'?' · kontrolujeme registrácie':'')+'.';if(!done)await new Promise(resolve=>setTimeout(resolve,700));}location.reload();}catch(e){status.textContent=e.message;button.disabled=false;running=false;}}
        button.addEventListener('click',update);if(config.needs)update();document.querySelectorAll('[data-metric]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-chart]').forEach(c=>c.hidden=c.dataset.chart!==b.dataset.metric);document.querySelectorAll('[data-metric]').forEach(x=>{const selected=x===b;x.setAttribute('aria-pressed',String(selected));x.classList.toggle('button-primary',selected);});}));})();</script>
        <?php
    }
}
add_action('plugins_loaded', [TM_Business_Statistics::class,'init'], 25);
