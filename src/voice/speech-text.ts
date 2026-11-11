/**
 * Turns written text into what a voice should say, one sentence at a time.
 * A whole reply sent to a speech engine waits for all of it and can be cut off part way; sentences start at once and
 * play one after another, and a pause only ever falls where a reader would pause. Each part names its own language, so
 * a reply mixing Arabic and English is read by the right voice.
 */
export type SpeechLang="ar"|"en";
export interface SpeechSegment{text:string;lang:SpeechLang;pauseMs:number}

export const MAX_SEGMENT_CHARS=220;
const SHORT_SEGMENT_CHARS=14;
/** A run of fewer words stays inside the sentence around it: "افتح LayanX الآن" is one Arabic sentence. */
const MIN_RUN_WORDS=3;
const PAUSE={sentence:140,semicolon:100,paragraph:240,clause:40,languageChange:30};
const ABBREVIATION=/(?:^|\s)(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|st|no|fig)\.$/i;

/** Removes what only makes sense on screen: code blocks, links, Markdown marks, emoji. */
export function cleanForSpeech(raw:string):string{
  return String(raw??"").replace(/\r\n?/g,"\n")
    .replace(/```[\s\S]*?(?:```|$)/g,"\n")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g,"$1")
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi,"")
    .replace(/`/g,"")
    .replace(/^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/gm,"")
    .replace(/^\s{0,3}(?:#{1,6}|>+)\s+/gm,"")
    .replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/gm,"")
    .replace(/\|/g,"، ")
    .replace(/\*+|~~/g,"")
    .replace(/(^|\s)_+(?=\S)|(?<=\S)_+(?=\s|$)/g,"$1")
    .replace(/\s*[→←⇒➜]\s*/g,"، ")
    .replace(/\p{Extended_Pictographic}|[️‍]/gu,"")
    .split("\n").map(line=>line.replace(/[ \t]+/g," ").trim()).filter(Boolean).join("\n");
}

function splitSentences(line:string):Array<{text:string;pauseMs:number}>{
  const out:Array<{text:string;pauseMs:number}>=[];
  let start=0;
  for(let i=0;i<line.length;i++){
    if(!".!?؟…۔؛;".includes(line[i]!))continue;
    let end=i;
    while(end+1<line.length&&".!?؟…۔؛;".includes(line[end+1]!))end++;
    if(end+1<line.length&&!/\s/.test(line[end+1]!)){i=end;continue;}
    const text=line.slice(start,end+1).trim();
    if(line[i]==="."&&end===i&&ABBREVIATION.test(line.slice(start,end+1)))continue;
    if(text)out.push({text,pauseMs:line[end]==="؛"||line[end]===";"?PAUSE.semicolon:PAUSE.sentence});
    start=end+1;i=end;
  }
  const rest=line.slice(start).trim();
  if(rest)out.push({text:rest,pauseMs:PAUSE.sentence});
  return out;
}

/** A sentence too long for one breath breaks at a comma, or at a space, never inside a word unless it has no spaces. */
function splitLong(text:string):string[]{
  const parts:string[]=[];
  let rest=text;
  while(rest.length>MAX_SEGMENT_CHARS){
    const window=rest.slice(0,MAX_SEGMENT_CHARS+1);
    let cut=Math.max(window.lastIndexOf("،"),window.lastIndexOf(","),window.lastIndexOf(":"),window.lastIndexOf("-"))+1;
    if(cut<SHORT_SEGMENT_CHARS)cut=window.lastIndexOf(" ");
    if(cut<SHORT_SEGMENT_CHARS)cut=MAX_SEGMENT_CHARS;
    parts.push(rest.slice(0,cut).trim());
    rest=rest.slice(cut).trim();
  }
  if(rest)parts.push(rest);
  return parts;
}

const wordLang=(word:string):SpeechLang|null=>{
  const arabic=(word.match(/[؀-ۿ]/g)??[]).length,latin=(word.match(/[A-Za-z]/g)??[]).length;
  return!arabic&&!latin?null:arabic>=latin?"ar":"en";
};

function languageRuns(text:string,fallback:SpeechLang):Array<{text:string;lang:SpeechLang}>{
  const words=text.split(/\s+/).filter(Boolean);
  const kinds=words.map(wordLang);
  const firstKnown=kinds.find(Boolean)??fallback;
  let runs:Array<{words:string[];lang:SpeechLang}>=[];
  let current=firstKnown;
  words.forEach((word,index)=>{
    current=kinds[index]??current;
    const last=runs.at(-1);
    if(last?.lang===current)last.words.push(word);else runs.push({words:[word],lang:current});
  });
  // Short runs join a neighbour; the longer side decides the voice.
  for(;;){
    const index=runs.length>1?runs.findIndex(run=>run.words.length<MIN_RUN_WORDS):-1;
    if(index<0)break;
    const with_=index>0?index-1:index+1;
    const [first,second]=index<with_?[runs[index]!,runs[with_]!]:[runs[with_]!,runs[index]!];
    const merged={words:[...first.words,...second.words],lang:first.words.join(" ").length>=second.words.join(" ").length?first.lang:second.lang};
    runs=[...runs.slice(0,Math.min(index,with_)),merged,...runs.slice(Math.max(index,with_)+1)];
    // Neighbours that now share a language are one run.
    runs=runs.reduce<typeof runs>((all,run)=>{const last=all.at(-1);if(last?.lang===run.lang)last.words.push(...run.words);else all.push({words:[...run.words],lang:run.lang});return all;},[]);
  }
  return runs.map(run=>({text:run.words.join(" "),lang:run.lang}));
}

/** The whole text, in order, as parts a speech engine can say in one breath. Nothing but on-screen marks is dropped. */
export function splitForSpeech(raw:string,lang?:string):SpeechSegment[]{
  const fallback:SpeechLang=String(lang??"").toLowerCase().startsWith("en")?"en":"ar";
  const pieces:SpeechSegment[]=[];
  for(const line of cleanForSpeech(raw).split("\n").filter(Boolean)){
    const sentences=splitSentences(line);
    sentences.forEach((sentence,sentenceIndex)=>{
      const runs=languageRuns(sentence.text,fallback);
      runs.forEach((run,runIndex)=>{
        const chunks=splitLong(run.text);
        chunks.forEach((text,chunkIndex)=>{
          const lastChunk=chunkIndex===chunks.length-1,lastRun=runIndex===runs.length-1;
          const pauseMs=!lastChunk?PAUSE.clause:!lastRun?PAUSE.languageChange:sentenceIndex===sentences.length-1?PAUSE.paragraph:sentence.pauseMs;
          pieces.push({text,lang:run.lang,pauseMs});
        });
      });
    });
  }
  // "نعم." alone sounds clipped: a very short part is said together with the next one.
  const joined:SpeechSegment[]=[];
  for(const piece of pieces){
    const last=joined.at(-1);
    if(last&&last.text.length<SHORT_SEGMENT_CHARS&&last.lang===piece.lang&&last.text.length+piece.text.length<MAX_SEGMENT_CHARS)
      joined[joined.length-1]={text:last.text+" "+piece.text,lang:piece.lang,pauseMs:piece.pauseMs};
    else joined.push({...piece});
  }
  if(joined.length)joined[joined.length-1]!.pauseMs=0;
  return joined;
}
