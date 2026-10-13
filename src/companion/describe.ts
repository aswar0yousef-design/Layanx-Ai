/**
 * What the owner reads before approving, on the phone, in a notification or on the screen-top island.
 * Every field of the input is shown (not one picked field), lines are kept (a second line of a command
 * is part of the command), and nothing is cut silently: past the limit the text ends with a marker and
 * `full` is false, and then the phone and the island do not offer a quick approve (review on the PC).
 */
export const DETAIL_LIMIT=4000;

const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;

function value(v:unknown):string{
  if(typeof v==="string")return v;
  if(v===undefined)return"";
  try{return JSON.stringify(v);}catch{return String(v);}
}

/** "key: value" per field, the important keys first. */
export function describeInput(input:unknown,first:readonly string[]=[]):{text:string;full:boolean}{
  let text:string;
  if(input===null||input===undefined)text="";
  else if(typeof input!=="object"||Array.isArray(input))text=value(input);
  else{
    const o=input as Record<string,unknown>;
    const keys=[...first.filter(k=>k in o),...Object.keys(o).filter(k=>!first.includes(k))];
    text=keys.map(k=>`${k}: ${value(o[k])}`).join("\n");
  }
  // Control and bidi-override characters could hide or reorder what is shown; newlines and tabs stay.
  text=text.replace(/\r\n?/g,"\n").replace(control,"�");
  if(text.length<=DETAIL_LIMIT)return{text,full:true};
  return{text:text.slice(0,DETAIL_LIMIT)+`\n… (${text.length-DETAIL_LIMIT} more characters; review on the PC)`,full:false};
}
