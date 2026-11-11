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

export async function composeTaskAnswer(models:Pick<ModelExecutionRouter,"execute">,goal:string,results:ToolResult[],completed:boolean):Promise<TaskAnswer|null>{
  const {text,image}=resultsForAnswer(results);
  if(!text&&!image)return null;
  const lang=arabic(goal)?"Arabic":"English";
  const prompt=[
    "You are LayanX. The owner asked for something and your tools ran. Write the reply to the owner.",
    "Use ONLY the tool results below"+(image?" and the attached screenshot":"")+". Never invent names, numbers, links or facts that are not there.",
    completed?"":"The task did not finish; say briefly what was found and what is still missing.",
    "If the results do not contain what was asked, say so plainly and what would get it.",
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
    const answer=String(r.output??"").replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
    return answer?{text:answer.slice(0,3000),modelId:r.modelId,fromImage:Boolean(image)}:null;
  }catch(error){
    // No model that sees images: answer from the text results, and say the screenshot could not be read.
    if(!image)return null;
    if(!text)return{text:lang==="Arabic"?"التقطت صورة الشاشة، لكن لا يوجد نموذج يرى الصور الآن لوصفها. فعّل نموذج رؤية من صفحة النماذج.":"I captured the screen, but no model that can see images is available to describe it. Turn on a vision model on the Models page.",fromImage:false};
    try{const r=await attempt(false);return{text:String(r.output??"").trim().slice(0,3000),modelId:r.modelId,fromImage:false};}catch{return null;}
  }
}
