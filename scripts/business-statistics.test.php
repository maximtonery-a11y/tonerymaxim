<?php
// Offline integration of the real reporting module and its bounded index worker.
define('ABSPATH', __DIR__.'/'); define('ARRAY_A','ARRAY_A');
$checks=0; $options=[]; $hooks=[]; $allowed=true; $nonce_ok=true; $scheduled=[];
function check($ok,$message){global $checks;$checks++;if(!$ok)throw new RuntimeException('FAIL: '.$message);echo 'PASS: '.$message."\n";}
function add_action(...$v){$GLOBALS['hooks'][]=$v;}
function get_option($key,$default=false){return $GLOBALS['options'][$key]??$default;}
function update_option($key,$value,$autoload=null){check(str_starts_with($key,'tm_business_stats_'),'Only reporting options are written');$GLOBALS['options'][$key]=$value;}
function delete_option($key){check(str_starts_with($key,'tm_business_stats_'),'Only reporting build state is removed');unset($GLOBALS['options'][$key]);}
function get_user_by($field,$id){return $GLOBALS['users'][(int)$id]??false;}
function wp_salt($scheme){return 'isolated-test-statistics-salt';}
function wc_get_order_statuses(){return array_fill_keys(['wc-processing','wc-completed','wc-pending','wc-on-hold','wc-cancelled','wc-failed','wc-refunded','wc-tm-paid','wc-tm-processing','wc-tm-shipped','wc-tm-returned','wc-tm-mail-abcdef12'],'Label');}
function get_users($args){return array_slice(array_values($GLOBALS['users']),($args['paged']-1)*$args['number'],$args['number']);}
function wc_get_orders($args){check($args['limit']===75 && $args['paginate']===true,'History is read in bounded Woo pages, never an unlimited or last-500 query');$all=$GLOBALS['orders'];return (object)['orders'=>array_slice($all,($args['paged']-1)*$args['limit'],$args['limit']),'total'=>count($all),'max_num_pages'=>(int)ceil(count($all)/$args['limit'])];}
function wp_next_scheduled($hook){return $GLOBALS['scheduled'][$hook]??false;}
function wp_schedule_single_event($time,$hook){$GLOBALS['scheduled'][$hook]=$time;}
function dbDelta($sql){check(str_contains($sql,'PRIMARY KEY  (generation,event_key)'),'Index events have idempotent generation keys');}
function number_format_i18n($v,$decimals=0){return number_format($v,$decimals,',',' ');}
function current_user_can($cap){return $GLOBALS['allowed'];}
class FixtureExit extends RuntimeException {public function __construct(public array $data,public int $status){parent::__construct('response');}}
function wp_send_json_error($data,$status=200){throw new FixtureExit($data,$status);}
function check_ajax_referer($action){if(!$GLOBALS['nonce_ok'])throw new RuntimeException('Bad nonce');}
function wp_mail(...$args){throw new RuntimeException('Statistics must never send mail');}
function esc_html($v){return htmlspecialchars((string)$v,ENT_QUOTES,'UTF-8');}
function esc_attr($v){return esc_html($v);}
function esc_url($v){return esc_html($v);}
function esc_textarea($v){return esc_html($v);}
function nocache_headers(){}
function current_time($format){return '2026-11-17';}
function wp_date($format,$timestamp,$timezone=null){return (new DateTimeImmutable('@'.$timestamp))->setTimezone($timezone??new DateTimeZone('UTC'))->format($format);}
function selected($a,$b){if($a===$b)echo ' selected="selected"';}
function checked($v){if($v)echo ' checked="checked"';}
function admin_url($path){return 'https://woo.example.invalid/wp-admin/'.$path;}
function add_query_arg($args,$url){return $url.'?'.http_build_query($args);}
function wp_nonce_url($url,$action){return $url.'&_wpnonce=fixture';}
function wp_nonce_field($action){echo '<input name="_wpnonce" value="fixture">';}
function wp_create_nonce($action){return 'fixture';}
function wp_json_encode($value,$flags=0){return json_encode($value,$flags);}
if(!function_exists('mb_substr')){function mb_substr($v,$start,$length){return substr($v,$start,$length);}}
class WC_Order {
    public function __construct(public int $id,public string $at,public string $status='processing',public int $customer=7,public string $email='same@example.invalid',public float $total=123.0){}
    public array $meta=['source'=>'tonerymaxim'];public array $refunds=[];
    public function get_id(){return $this->id;}public function get_customer_id(){return $this->customer;}
    public function get_meta($key){return $this->meta[$key]??'';}public function get_created_via(){return $this->meta['source'];}
    public function get_date_created(){return new DateTimeImmutable($this->at);}
    public function get_billing_email(){return $this->email;}public function get_status(){return $this->status;}
    public function get_total(){return $this->total;}public function get_total_tax(){return 23;}
    public function get_shipping_total(){return 4;}public function get_shipping_tax(){return .92;}
    public function get_discount_total(){return 2;}public function get_discount_tax(){return .46;}
    public function get_refunds(){return $this->refunds;}public function get_currency(){return 'EUR';}
    public function get_payment_method_title(){return 'GoPay';}public function get_items($type){return [];}
    public function save(){throw new RuntimeException('Statistics must never save an order');}
    public function update_meta_data(...$args){throw new RuntimeException('Statistics must never mutate order metadata');}
}
class FixtureRefund extends WC_Order {public function get_amount(){return 123;}public function get_total_tax(){return -23;}public function get_shipping_total(){return -4;}public function get_shipping_tax(){return -.92;}}
class FixtureDB {
    public string $prefix='wp_';public string $last_error='';public array $rows=[];public array $prepared=[];public bool $fail=false;public bool $lock=true;
    public function prepare($sql,...$args){$key=$sql.' /*'.json_encode($args).'*/';$this->prepared[$key]=[$sql,$args];return $key;}
    public function esc_like($s){return $s;}public function get_charset_collate(){return '';}
    public function get_var($query){if(str_contains($query,'SHOW TABLES'))return 'wp_tm_business_facts_v1';if(str_contains($query,'GET_LOCK'))return $this->lock?1:0;if(str_contains($query,'RELEASE_LOCK'))return 1;throw new RuntimeException('Unexpected scalar SQL');}
    public function replace($table,$row){check($table==='wp_tm_business_facts_v1','No source Woo table is written');if($this->fail)return false;$this->rows[$row['generation'].':'.$row['event_key']]=$row;return 1;}
    public function query($query){[$sql,$args]=$this->prepared[$query];check(str_starts_with($sql,'DELETE FROM wp_tm_business_facts_v1 WHERE generation <>'),'Cleanup touches disposable index generations only');$this->rows=array_filter($this->rows,fn($r)=>$r['generation']===$args[0]);return 1;}
    public function get_results($query,$format){[$sql,$args]=$this->prepared[$query];
        if(str_contains($sql,'MIN(f.occurred)')){$first=[];foreach($this->rows as $r)if($r['generation']===$args[0]&&$r['kind']==='order'&&$r['eligible']&&$r['currency']==='EUR'){$k=$r['customer_key'];if(!isset($first[$k])||$r['occurred']<$first[$k])$first[$k]=$r['occurred'];}$out=[];foreach($first as $k=>$v)$out[]=['customer_key'=>$k,'first_at'=>$v];return $out;}
        $rows=array_values(array_filter($this->rows,fn($r)=>$r['generation']===$args[0]&&$r['occurred']>=$args[1]&&$r['occurred']<$args[2]));usort($rows,fn($a,$b)=>strcmp($a['event_key'],$b['event_key']));return array_slice($rows,$args[3],500);
    }
}
$wpdb=new FixtureDB();$users=[7=>(object)['ID'=>7,'user_registered'=>'2026-10-01 10:00:00','user_email'=>'same@example.invalid']];
require __DIR__.'/../wordpress-plugin/tonerymaxim-customer-administration/customer-accounts.php';
require __DIR__.'/../wordpress-plugin/tonerymaxim-customer-administration/business-statistics.php';
$settings=TM_Business_Statistics::settings();
$oct=new WC_Order(1,'2026-10-10T10:00:00Z');$nov=new WC_Order(2,'2026-11-10T10:00:00Z');
$guest=new WC_Order(3,'2026-11-11T10:00:00Z','processing',0,'new@example.invalid',50);
$cancel=new WC_Order(4,'2026-11-12T10:00:00Z','cancelled',0,'cancel@example.invalid',999);
$wait=new WC_Order(5,'2026-11-12T10:00:00Z','tm-await-pay',0,'pending@example.invalid',80);
$refunded=new WC_Order(6,'2026-10-12T10:00:00Z','refunded',0,'refund@example.invalid');
$refunded->refunds=[new FixtureRefund(60,'2026-11-13T10:00:00Z')];
$custom=new WC_Order(7,'2026-11-12T10:00:00Z','tm-mail-abcdef12',0,'custom@example.invalid');
$snapshot=new WC_Order(8,'2026-11-14T10:00:00Z','completed',7,'snapshot@example.invalid',100);
$snapshot->meta['tm_order_snapshot']=json_encode(['total'=>246,'shippingPrice'=>4.92,'originalSubtotal'=>300,'subtotal'=>250,'couponDiscount'=>5,'loyaltyDiscount'=>3,'items'=>[['sku'=>'TN-2421','name'=>'Test toner','qty'=>2]]]);
$orders=[$oct,$nov,$guest,$cancel,$wait,$refunded,$custom,$snapshot];$original=serialize($orders);
$clock=new DateTimeImmutable('2026-11-17T13:00:00+01:00');$range=TM_Business_Statistics::range('month','2026-11-17',$clock);
check($range['previous_end']->format('Y-m-d H:i')==='2026-10-17 13:00','Current month compares to the same elapsed part, not an entire earlier month');
check(TM_Business_Statistics::range('day','2026-10-25',new DateTimeImmutable('2026-10-26T10:00:00+01:00'))['end']->getTimestamp()-TM_Business_Statistics::range('day','2026-10-25',new DateTimeImmutable('2026-10-26T10:00:00+01:00'))['start']->getTimestamp()===90000,'Bratislava daylight-saving day is 25 real hours');
foreach([['month','2026-02-30'],['bad','2026-11-17'],['day','2030-01-01']] as [$period,$date]){try{TM_Business_Statistics::range($period,$date,$clock);throw new RuntimeException('Bad date accepted');}catch(RuntimeException $e){check($e->getMessage()!=='Bad date accepted','Invalid and future periods are rejected');}}
check(!TM_Customer_Accounts::registered($guest)&&TM_Customer_Accounts::registered($nov),'Registration uses a real assigned Woo user, not email/name guesses');
$gone=clone $nov;$gone->customer=999;check(!TM_Customer_Accounts::registered($gone),'A deleted user does not retain account access');
$test=clone $nov;$test->email='info@automatizaciafirmy.sk';check(TM_Business_Statistics::facts($test,$settings)===[],'Known test account is excluded from business figures');
$other=clone $nov;$other->meta['source']='another-store';check(TM_Business_Statistics::facts($other,$settings)===[],'ColorIQ orders are not mixed into TM analytics');
$newfacts=TM_Business_Statistics::facts($snapshot,$settings);check($newfacts[0]['total']===24600&&$newfacts[0]['tax']===null,'Authoritative TM gross is preserved; mismatched Woo tax is not guessed');
check($newfacts[0]['discount']===5800,'Quantity, coupon and loyalty discounts are included once');
check($newfacts[count($newfacts)-1]['sku']==='TN-2421','SKU is retained from the order snapshot');
$rows=[];$first=[];foreach($orders as $o)foreach(TM_Business_Statistics::facts($o,$settings) as $r){$rows[]=$r;if($r['kind']==='order'&&$r['eligible']){$key=$r['customer_key'];if(!isset($first[$key])||$r['occurred']<$first[$key])$first[$key]=$r['occurred'];}}
$s=TM_Business_Statistics::summarize($rows,$first,$range);
check($s['gross']===29600,'November gross includes current sales and the October order refund on its November refund date');
check($s['orders']===6&&$s['sales_orders']===3,'Cancelled, unpaid and unmapped custom states do not inflate turnover');
check($s['registered_orders']===2&&$s['guest_orders']===4,'Registered and guest order counts are distinct from new-customer counts');
check($s['new']===2&&$s['returning']===1,'New versus returning buyers consult complete earlier history');
check($s['registrations']===0,'Existing October signup is not a new November registration');
check($s['refunds']===12300&&$s['pending_total']===8000&&$s['cancelled']===1,'Refunds, pending amounts and cancellations remain separately visible');
check($s['unclassified']===1&&$s['unknown_tax']===1,'Unmapped email statuses and incomplete tax reconciliation are visible data-quality signals');
$reg_guest=clone $oct;$reg_guest->customer=0;check(TM_Business_Statistics::facts($reg_guest,$settings)[0]['customer_key']===TM_Business_Statistics::facts($nov,$settings)[0]['customer_key'],'Email joins anonymous/account purchase history only in anonymous statistical keys');
check(TM_Business_Statistics::change(1,0)==='Bez porovnateľného základu','Zero baseline does not produce fake growth percentages');
check(str_contains(TM_Business_Statistics::styles(),'.tm-stats-kpis{display:grid;') && str_contains(TM_Business_Statistics::styles(),'.tm-donut{'), 'Dashboard grid and donut styles are registered through the WordPress stylesheet pipeline');
$a=TM_Business_Statistics::refresh();check(!$a['done']&&!get_option(TM_Business_Statistics::ACTIVE),'Incomplete history never appears as a complete dashboard');
$b=TM_Business_Statistics::refresh();check($b['done']&&$b['orders']===8,'Both order history and registrations complete before atomic publication');
$active=get_option(TM_Business_Statistics::ACTIVE);$r=TM_Business_Statistics::report($range);check($r['current']['gross']===$s['gross'],'The indexed report matches the independently normalized expected sum');
$wpdb->fail=true;try{TM_Business_Statistics::refresh(true);throw new RuntimeException('Write accepted');}catch(RuntimeException $e){check($e->getMessage()!=='Write accepted','Index write failure is reported');}
check(get_option(TM_Business_Statistics::ACTIVE)===$active,'Failed rebuild preserves the last complete generation');$wpdb->fail=false;
$wpdb->lock=false;check(TM_Business_Statistics::refresh()===['busy'=>true],'Concurrent workers do not overwrite one another');$wpdb->lock=true;
$allowed=false;try{TM_Business_Statistics::ajax_refresh();}catch(FixtureExit $e){check($e->status===403,'Non-managers cannot trigger reporting jobs');}$allowed=true;$nonce_ok=false;
try{TM_Business_Statistics::ajax_refresh();}catch(RuntimeException $e){check($e->getMessage()==='Bad nonce','AJAX rebuilds require a valid administrator nonce');}$nonce_ok=true;
$method=new ReflectionMethod(TM_Business_Statistics::class,'chart');ob_start();$method->invoke(null,$s['series'],[],$range,'gross');$chart=ob_get_clean();check(str_contains($chart,'<svg')&&str_contains($chart,'<title>')&&str_contains($chart,'tabindex="0"'),'Charts expose exact values for hover and keyboard focus');
check(serialize($orders)===$original,'Reporting never changes source orders, statuses, totals, payments or shipping');
$orders=[];for($i=0;$i<620;$i++)$orders[]=new WC_Order(1000+$i,'2026-11-10T10:00:00Z');
delete_option(TM_Business_Statistics::STATE);$done=false;$passes=0;
while(!$done&&$passes++<15){$step=TM_Business_Statistics::refresh();$done=$step['done']??false;}
check($done&&$passes===10&&get_option(TM_Business_Statistics::ACTIVE)['tm_orders']===620,'Backfill includes orders beyond 500 and completes all pages plus registrations');
$large=TM_Business_Statistics::report($range);check($large['current']['orders']===620&&$large['current']['gross']===7626000,'Streamed report crosses multiple 500-row reads without lost or doubled totals');
$main=file_get_contents(__DIR__.'/../wordpress-plugin/tonerymaxim-customer-administration/tonerymaxim-customer-administration.php');check(str_contains($main,'Registrácia zákazníka')&&str_contains($main,"TM_Customer_Accounts::badge(\$order)")&&str_contains($main,'name="account"'),'Order summary renders registration badges and preserves a dedicated filter');
// Exercise the entire real page, including sections below the charts and payment bars.
// A successful KPI/chart fragment alone must never count as a successful dashboard render.
$_GET=['period'=>'day','date'=>'2001-01-01'];
$render_base=TM_Business_Statistics::facts($nov,$settings)[0];
$render_base['generation']='page-fixture';$render_base['occurred']='2001-01-01 12:00:00';
$options[TM_Business_Statistics::ACTIVE]=['generation'=>'page-fixture','updated'=>time(),'tm_orders'=>0,'settings'=>$settings];
foreach(['empty'=>[], 'empty-month'=>[], 'empty-year'=>[], 'pending-only'=>[array_merge($render_base,['eligible'=>0,'status'=>'pending'])],
    'cancelled-only'=>[array_merge($render_base,['eligible'=>0,'status'=>'cancelled'])],
    'refund-only'=>[array_merge($render_base,['kind'=>'refund','event_key'=>'r:fixture','total'=>-12300,'tax'=>-2300])],
    'one-payment'=>[$render_base], 'multiple-payments'=>[$render_base,array_merge($render_base,['event_key'=>'o:extra','method'=>'Dobierka','total'=>5000])]] as $name=>$fixture_rows) {
    $_GET['period']=$name==='empty-month'?'month':($name==='empty-year'?'year':'day');
    $wpdb->rows=$fixture_rows;
    ob_start();
    try { TM_Business_Statistics::page(); $html=ob_get_contents(); }
    finally { ob_end_clean(); }
    check(str_contains($html,'Predaj podľa platby')&&str_contains($html,'Najpredávanejšie SKU')
        &&str_contains($html,'name="action" value="tm_business_stats_settings"')&&str_contains($html,"button.addEventListener('click',update)"),
        'Complete dashboard renders through its final settings and script: '.$name);
    if(in_array($name,['empty','empty-month','empty-year','pending-only','cancelled-only','refund-only'],true))check(str_contains($html,'V období nie sú započítané predaje.'),'No-sales payment section is explicit: '.$name);
}
echo 'Business statistics checks: '.$checks."; failures: 0\n";
