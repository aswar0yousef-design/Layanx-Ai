import type {ModelExecutionRouter} from "./model-execution.js";

/**
 * The owner asked for something ("find leads for layanx.com", "take a screenshot and describe it"); the agent ran tools.
 * Without this the chat showed only a tick per tool and never the answer. A model writes the reply from the tools'
 * results alone (a screenshot is passed as an image), and says what is missing instead of inventing it.
 */
export interface TaskAnswer{text:string;modelId?:string;fromImage:boolean}
type ToolResult={ok?:boolean;tool?:string;data?:unknown};

const MAX_RESULTS_CHARS=8000;
const arabic=(text:string)=>/[؀-ۿ]/.test(text);

/** The tools' output as text for the model: images and huge blobs are left out, and each result is capped. */
export function resultsForAnswer(results:ToolResult[]):{text:string;image?:{mimeType:string;base64:string}}{
  let image:{mimeType:string;base64:string}|undefined;
  const parts:string[]=[];
  for(const r of results){
    if(!r?.ok)continue;
    const data=r.data&&typeof r.data==="object"?r.data as Record<string,unknown>:{value:r.data};
    // A screenshot is passed as the image itself; its size and format say nothing about what is on screen.
    if(typeof data.base64==="string"&&typeof data.mimeType==="string"&&data.mimeType.startsWith("image/")){image={mimeType:data.mimeType,base64:data.base64};continue;}
    const json=JSON.stringify(data,(key,value)=>key==="base64"||key==="images"?undefined:typeof value==="string"&&value.length>2000?value.slice(0,2000)+"…":value);
    if(json&&json!=="{}")parts.push(`[${r.tool??"tool"}] ${json.slice(0,3000)}`);
  }
  return{text:parts.join("\n").slice(0,MAX_RESULTS_CHARS),...(image?{image}:{})};
}

/**
 * The lead list is written by code, not a model: a small model echoed the JSON back (seen live 2026-11-12), and every
 * company and link must be exactly the checked one from the search results.
 */
export function leadsReply(data:unknown,arabicReply:boolean):string|null{
  const d=data as {site?:string;business?:string;segments?:Array<{name?:string;why?:string}>;leads?:Array<{name?:string;url?:string;segment?:string;why?:string}>;searched?:string[];note?:string}|null;
  if(!d||typeof d!=="object"||!Array.isArray(d.leads))return null;
  const lines:string[]=[];
  if(d.business)lines.push((arabicReply?"ما يقدمه "+d.site+" (من نص الموقع): ":"What "+d.site+" offers (from its site): ")+d.business);
  const segments=(d.segments??[]).map(s=>s.name).filter(Boolean);
  if(segments.length)lines.push((arabicReply?"أنواع العملاء المحتملين: ":"Customer types: ")+segments.join("، "));
  if(d.leads.length){
    lines.push(arabicReply?`شركات وجدتها في نتائج البحث (${d.leads.length}):`:`Companies found in the search results (${d.leads.length}):`);
    for(const l of d.leads)lines.push(`- ${l.name} (${l.segment}): ${l.url}${l.why?" — "+l.why:""}`);
    lines.push(arabicReply?"هذه مرشحون من البحث، لم أتواصل مع أحد. راجعهم قبل التواصل.":"These are candidates from web search; nobody was contacted. Review them before reaching out.");
  }else lines.push((arabicReply?"لم أجد شركات بعينها. ":"No individual companies found. ")+(d.note??""));
  if(d.searched?.length)lines.push((arabicReply?"عمليات البحث: ":"Searches: ")+d.searched.join(" | "));
  return lines.join("\n");
}

/**
 * A web form: what was filled and the site's own answer, word for word. Written by code (seen live 2026-11-12: the model's
 * summary came back as broken JSON and dropped the price the site had shown).
 */
export function webFormReply(data:unknown,arabicReply:boolean):string|null{
  const d=data as {url?:string;filled?:Record<string,string>;submitted?:boolean;resultText?:string;note?:string}|null;
  if(!d||typeof d!=="object"||typeof d.submitted!=="boolean")return null;
  const filled=Object.entries(d.filled??{}).map(([k,v])=>`${k}: ${v}`).join("، ");
  const answer=(d.resultText??"").replace(/\s+\n/g,"\n").replace(/\n{2,}/g,"\n").trim().slice(0,900);
  if(!d.submitted)return(arabicReply?"لم أرسل النموذج في "+d.url+". ":"I did not submit the form on "+d.url+". ")+(d.note??"");
  return[(arabicReply?"أرسلتُ النموذج في ":"I submitted the form on ")+d.url+(filled?(arabicReply?" بهذه البيانات: ":" with: ")+filled:""),
    answer?(arabicReply?"ردّ الموقع:\n":"The site answered:\n")+answer:"",d.note??""].filter(Boolean).join("\n");
}

const STATUS:Record<string,string>={processing:"قيد التجهيز",completed:"مكتمل","on-hold":"معلّق",pending:"بانتظار الدفع",cancelled:"ملغى",refunded:"مسترجع",failed:"فاشل","checkout-draft":"مسودة"};
/** The store report, written by code from the store's own numbers (nothing for a model to round or invent). */
export function storeReply(data:unknown,arabicReply:boolean):string|null{
  const d=data as {store?:string;days?:number;orders?:number;byStatus?:Record<string,number>;revenue?:Record<string,number>;toShip?:Array<{number:string;total:string;currency:string;city?:string;items:string}>;top?:Array<{name:string;quantity:number}>;outOfStock?:string[];lowStock?:Array<{name:string;left:number}>;products?:number}|null;
  if(!d||typeof d!=="object"||typeof d.orders!=="number"||!d.byStatus)return null;
  const A=arabicReply;
  const period=d.days===1?(A?"اليوم":"today"):d.days===2?(A?"منذ أمس":"since yesterday"):(A?`آخر ${d.days} يوماً`:`the last ${d.days} days`);
  const money=Object.entries(d.revenue??{}).map(([c,v])=>`${v} ${c}`).join(" + ")||"0";
  const lines=[A?`متجر ${d.store}، ${period}: ${d.orders} طلب، والمبيعات المدفوعة ${money}.`:`Store ${d.store}, ${period}: ${d.orders} orders, paid sales ${money}.`];
  const statuses=Object.entries(d.byStatus).map(([s,n])=>`${A?STATUS[s]??s:s} ${n}`).join("، ");
  if(statuses)lines.push((A?"حسب الحالة: ":"By status: ")+statuses);
  if(d.toShip?.length){lines.push(A?`طلبات تنتظر التجهيز والشحن (${d.toShip.length}):`:`Orders waiting to ship (${d.toShip.length}):`);for(const o of d.toShip.slice(0,10))lines.push(`- #${o.number}: ${o.total} ${o.currency}${o.city?" — "+o.city:""} — ${o.items}`);}
  if(d.top?.length)lines.push((A?"الأكثر مبيعاً: ":"Best sellers: ")+d.top.map(t=>`${t.name} (${t.quantity})`).join("، "));
  if(d.outOfStock?.length)lines.push((A?"نفد مخزونها: ":"Out of stock: ")+d.outOfStock.join("، "));
  if(d.lowStock?.length)lines.push((A?"مخزون منخفض: ":"Low stock: ")+d.lowStock.map(l=>`${l.name} (${A?"بقي":"left"} ${l.left})`).join("، "));
  if(!d.outOfStock?.length&&!d.lowStock?.length)lines.push(A?`لا منتج نافد أو منخفض المخزون من ${d.products} منتجاً منشوراً.`:`No product out of stock or low, of ${d.products} published.`);
  return lines.join("\n");
}
/** One store change: what it was, and what the store holds now (read back after the change). */
export function storeChangeReply(data:unknown,arabicReply:boolean):string|null{
  const d=data as {kind?:string;product?:string;order?:string;before?:any;after?:any;verified?:boolean}|null;
  if(!d||typeof d!=="object"||typeof d.verified!=="boolean")return null;
  const A=arabicReply;
  if(d.kind==="order")return A?`الطلب #${d.order}: كانت حالته «${STATUS[d.before]??d.before}»، وحالته في المتجر الآن «${STATUS[d.after]??d.after}».`:`Order #${d.order}: was ${d.before}, the store now shows ${d.after}.`;
  const fields:Array<[string,string]>=[["regular_price",A?"السعر":"price"],["sale_price",A?"سعر العرض":"sale price"],["stock_quantity",A?"المخزون":"stock"]];
  const changed=fields.filter(([k])=>String(d.before?.[k]??"")!==String(d.after?.[k]??"")).map(([k,label])=>A?`${label} كان ${d.before?.[k]||"—"} وصار ${d.after?.[k]||"—"}`:`${label} ${d.before?.[k]||"—"} → ${d.after?.[k]||"—"}`);
  return(A?`${d.product}: عدّلتُه في المتجر وقرأتُه منه بعد التعديل. `:`${d.product}: changed in the store and read back. `)+(changed.join("، ")||(A?"لم تتغير قيمة.":"no value changed."));
}

export async function composeTaskAnswer(models:Pick<ModelExecutionRouter,"execute">,goal:string,results:ToolResult[],completed:boolean):Promise<TaskAnswer|null>{
  const report=results.filter(r=>r?.ok&&r.tool==="store.report").at(-1);
  const reportText=report?storeReply(report.data,arabic(goal)):null;
  if(reportText)return{text:reportText,fromImage:false};
  const change=results.filter(r=>r?.ok&&r.tool==="store.change").at(-1);
  const changeText=change?storeChangeReply(change.data,arabic(goal)):null;
  if(changeText)return{text:changeText,fromImage:false};
  // A store change that could not be made: its message is the question the owner has to answer (which product, what price).
  const refused=results.filter(r=>r&&!r.ok&&r.tool==="store.change").at(-1) as (ToolResult&{error?:string})|undefined;
  if(refused?.error)return{text:(arabic(goal)?"لم أعدّل المتجر. ":"The store was not changed. ")+refused.error,fromImage:false};
  const leads=results.find(r=>r?.ok&&r.tool==="research.leads");
  const listed=leads?leadsReply(leads.data,arabic(goal)):null;
  if(listed)return{text:listed,fromImage:false};
  const form=results.filter(r=>r?.ok&&r.tool==="web.form").at(-1);
  const formText=form?webFormReply(form.data,arabic(goal)):null;
  if(formText)return{text:formText,fromImage:false};
  const {text,image}=resultsForAnswer(results);
  if(!text&&!image)return null;
  const lang=arabic(goal)?"Arabic":"English";
  const prompt=[
    "You are LayanX. The owner asked for something and your tools ran. Write the reply to the owner.",
    "Use ONLY the tool results below"+(image?" and the attached screenshot":"")+". Never invent names, numbers, links or facts that are not there.",
    // A small model read "use only the results" as "the screenshot is not in the results" (seen live with qwen3.5:9b).
    image?"The attached image IS the screenshot your tool just captured: describe what is on it to answer the request. Do not talk about tools.":"",
    completed?"":"The task did not finish; say briefly what was found and what is still missing.",
    image&&!text?"":"If the results do not contain what was asked, say so plainly and what would get it.",
    `Write in ${lang}, plain text, at most 10 short lines; a list may use "- ".`,
    `Owner's request: ${goal.slice(0,1000)}`,
    text?`Tool results:\n${text}`:""
  ].filter(Boolean).join("\n");
  const attempt=async(withImage:boolean)=>models.execute({
    capability:withImage?"vision":"reasoning",
    input:withImage?[{type:"text",text:prompt},{type:"image",image:image!}]:prompt,
    maxOutputTokens:900,routing:{preferLocal:true}
  } as never);
  try{
    const r=await attempt(Boolean(image));
    const answer=unwrapAnswer(String(r.output??""));
    return answer?{text:answer.slice(0,3000),modelId:r.modelId,fromImage:Boolean(image)}:null;
  }catch(error){
    // No model that sees images: answer from the text results, and say the screenshot could not be read.
    if(!image)return null;
    if(!text)return{text:lang==="Arabic"?"التقطت صورة الشاشة، لكن لا يوجد نموذج يرى الصور الآن لوصفها. فعّل نموذج رؤية من صفحة النماذج.":"I captured the screen, but no model that can see images is available to describe it. Turn on a vision model on the Models page.",fromImage:false};
    try{const r=await attempt(false);return{text:String(r.output??"").trim().slice(0,3000),modelId:r.modelId,fromImage:false};}catch{return null;}
  }
}

/** Small models sometimes wrap a plain reply in JSON ({"response":"..."}); the owner should see the words. */
export function unwrapAnswer(raw:string):string{
  const text=raw.replace(/<think>[\s\S]*?<\/think>/gi,"").replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/,"").trim();
  if(!/^\{[\s\S]*\}$/.test(text))return text;
  try{
    const o=JSON.parse(text) as Record<string,unknown>;
    const value=["response","reply","answer","text","message","content"].map(k=>o[k]).find(v=>typeof v==="string"&&v.trim());
    if(typeof value==="string")return value.trim();
    // Any other key ({"user_question":"...","tool_response":"..."}, seen live): the longest text is the reply.
    const longest=Object.values(o).filter((v):v is string=>typeof v==="string").sort((a,b)=>b.length-a.length)[0];
    return longest&&longest.trim().length>=20?longest.trim():text;
  }catch{return text;}
}
