import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {customerProductLabel} from '../src/lib/ai-product-label.ts';

function renderer(){
 const names=['renderCommerceResults','renderSafeProducts','productOfferCard','appendAiContent','attachFeedback'];
 const source=readFileSync(new URL('../src/scripts/ai-sales-assistant.js',import.meta.url),'utf8');
 const ast=ts.createSourceFile('assistant.js',source,ts.ScriptTarget.Latest,true),functions:string[]=[];
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name&&names.includes(node.name.text))functions.push(node.getText(ast));ts.forEachChild(node,visit);};visit(ast);assert.equal(functions.length,names.length);
 const messages:any[]=[];
 const element=()=>{
  let html='';const children:any[]=[],attributes=new Set<string>();
  return {children,get innerHTML():string{return html+children.map(child=>child.innerHTML).join('');},set innerHTML(value:string){html=String(value);children.length=0;},
   appendChild:(child:any)=>children.push(child),setAttribute:(name:string)=>attributes.add(name),hasAttribute:(name:string)=>attributes.has(name),
   querySelector:(selector:string)=>selector==='[data-ai-feedback]'?children.find(child=>child.hasAttribute('data-ai-feedback'))||null:null,
   querySelectorAll:()=>[],addEventListener:()=>{},dataset:{}};
 };
 const addMessage=(_role:string,html:string)=>{const node=element();node.innerHTML=html;messages.push(node);return node;};
 const noop=()=>{};
 const scope={document:{createElement:element},state:{lastQuestion:'čo to píšeš?',commerceState:{lastProductQuery:'13264'}},
  addMessage,autoPanelSize:noop,trackEvent:noop,saveCommerceSession:noop,wireAvailability:noop,quantityChooser:noop,
  allowedAiProducts:(products:any[])=>products,isAiInStock:(p:any)=>p.stock_status!=='outofstock',isCalendarProduct:()=>false,
  aiColor:(p:any)=>p.color||'',aiType:(p:any)=>p.type||'compatible',aiTypeLabel:()=> 'Kompatibilný',aiColorLabel:(color:string)=>color,
  aiText:(value:unknown)=>String(value||''),aiImage:()=>'',aiStockLabel:()=> 'Skladom',safeProductUrl:()=>'/produkt/hp-cf259x',webResultsUrl:()=>'/produkty?s=CF259X',
  escapeHtml:(value:unknown)=>String(value||''),money:(value:number)=>`${value.toFixed(2)} €`,costPerPageText:()=>'',costPerPage:()=>0,parseCapacity:()=>0,isHighCapacity:()=>false,isInkOffer:()=>false};
 const code=ts.transpileModule(functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const api=vm.runInNewContext(code+';({renderCommerceResults,attachFeedback})',scope);
 return {api,messages,addMessage};
}
const product={id:13264,sku:'13264',name:'HP CF259X (59X) čierny kompatibilný toner',price:33.72,type:'compatible',color:'black',stock_status:'instock'};

test('ponuka má jednu odpoveď, jeden úvod a hodnotenie až pod produktmi',()=>{
 const {api,messages,addMessage}=renderer();const target=addMessage('bot','<p><b>V našej ponuke máme tieto produkty:</b></p>');
 api.renderCommerceResults({products:[product],queryLabel:'13264'},{target});api.attachFeedback(target,'Ukáž toner.','V našej ponuke máme tieto produkty:');
 assert.equal(messages.length,1);const html=target.innerHTML;
 assert.equal((html.match(/V našej ponuke máme tieto produkty:/g)||[]).length,1);
 assert.doesNotMatch(html,/Naša ponuka pre|Našiel som tieto možnosti|<b>13264<\/b>|<p><b><\/b><\/p>/);
 assert.match(html,/HP CF259X/);assert.match(html,/33\.72/);assert.equal((html.match(/Pomohla odpoveď/g)||[]).length,1);
 assert.ok(html.indexOf('Pomohla odpoveď')>html.indexOf('Detail produktu'));
});
test('samostatné vyhľadávanie aj farebná sada zostávajú v jednom bloku',()=>{
 const mono=renderer();mono.api.renderCommerceResults({products:[product],queryLabel:'13264'});assert.equal(mono.messages.length,1);assert.match(mono.messages[0].innerHTML,/HP CF259X/);
 const color=renderer(),pack={...product,name:'HP 220A CMYK kompatibilná sada',color:'cmyk',package_shape:'set'};
 color.api.renderCommerceResults({products:[pack],presentation:{isColorPrinter:true,setIntent:true,sets:[{type:'compatible',packageKind:'catalog',products:[pack],totalPrice:116.34}]}});
 assert.equal(color.messages.length,1);assert.match(color.messages[0].innerHTML,/HP 220A CMYK/);assert.doesNotMatch(color.messages[0].innerHTML,/Naša ponuka pre/);
});
test('zákaznícky názov nepoužije uložené interné SKU namiesto názvu tonera',()=>{
 for(const query of ['13264','SKU: 13264'])assert.equal(customerProductLabel(query,'koľko to stojí?','sku',[product]),product.name);
 assert.equal(customerProductLabel('13264','Ukáž SKU: 13264.','sku',[product]),'13264');
});
