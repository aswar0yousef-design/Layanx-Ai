/**
 * Text out of a PDF invoice. Most carrier invoices are text PDFs: pdf.js (Mozilla's reader, pinned) returns their text, Arabic
 * included. A scanned invoice is an image with no text: its pages are rendered to PNG so the vision model can read them, and
 * the result is marked as read from an image (the owner should glance at those rows).
 */
const MAX_PAGES=5,MAX_BYTES=15*1024*1024;
/** Arabic presentation forms (the shapes a PDF font draws) back to letters; the rial sign to «ريال». */
export function arabicLetters(t:string):string{
  return t.replace(/﷼/g,"ريال").normalize("NFKC").replace(/ی/g,"ي").replace(/ک/g,"ك");
}

async function open(bytes:Uint8Array){
  if(bytes.length>MAX_BYTES)throw new Error("the PDF is larger than 15 MB");
  if(Buffer.from(bytes.subarray(0,5)).toString("latin1")!=="%PDF-")throw new Error("the attachment is not a PDF");
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
  // No XFA forms, no system fonts, no font faces: the PDF is only read (pdf.js 6 no longer compiles fonts with eval).
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),enableXfa:false,useSystemFonts:false,disableFontFace:true,verbosity:0});
  const doc=await task.promise;
  return Object.assign(doc,{close:()=>task.destroy()});
}

/** The PDF's text, line by line (items grouped by their vertical position, right to left for Arabic lines). */
export async function pdfText(bytes:Uint8Array):Promise<{text:string;pages:number}>{
  const doc=await open(bytes);
  try{
    const lines:string[]=[];
    for(let n=1;n<=Math.min(doc.numPages,MAX_PAGES);n++){
      const page=await doc.getPage(n);
      const content=await page.getTextContent();
      const rows=new Map<number,Array<{x:number;w:number;h:number;s:string}>>();
      for(const item of content.items as Array<{str?:string;transform?:number[];width?:number}>){
        if(!item.str?.trim()||!item.transform)continue;
        const y=Math.round(item.transform[5]!/3)*3;
        (rows.get(y)??rows.set(y,[]).get(y)!).push({x:item.transform[4]!,w:item.width??0,h:Math.abs(item.transform[3]!)||10,s:item.str});
      }
      for(const [,items] of [...rows].sort((a,b)=>b[0]-a[0])){
        const rtl=items.some(i=>/[؀-ۿﭐ-﷿ﹰ-﻿]/.test(i.s));
        items.sort((a,b)=>rtl?b.x-a.x:a.x-b.x);
        // Arabic often arrives one glyph per item (seen: "أرا ﻣ ﻜ ﺲ"): a space only where the page really has a gap.
        let line="";
        items.forEach((item,i)=>{
          if(i>0){const prev=items[i-1]!;const gap=rtl?prev.x-(item.x+item.w):item.x-(prev.x+prev.w);if(gap>item.h*0.2)line+=" ";}
          line+=item.s;
        });
        lines.push(arabicLetters(line).replace(/\s+/g," ").trim());
      }
    }
    return{text:lines.filter(Boolean).join("\n").slice(0,20_000),pages:doc.numPages};
  }finally{await doc.close().catch(()=>undefined);}
}

/** The first pages as PNG images, for a scanned PDF (no text layer). */
export async function pdfPageImages(bytes:Uint8Array,maxPages=2,scale=1.5):Promise<string[]>{
  const {createCanvas}=await import("@napi-rs/canvas");
  const doc=await open(bytes);
  try{
    const out:string[]=[];
    for(let n=1;n<=Math.min(doc.numPages,maxPages);n++){
      const page=await doc.getPage(n);
      const viewport=page.getViewport({scale});
      const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
      const context=canvas.getContext("2d");
      context.fillStyle="#ffffff";context.fillRect(0,0,canvas.width,canvas.height);
      await page.render({canvasContext:context as never,viewport,canvas:canvas as never} as never).promise;
      // Cropped to what is printed: an A4 page is mostly white margin, and a smaller image is read far faster
      // (seen live: a whole page at double scale ran past the vision model's 3-minute limit).
      const {width,height}=canvas,pixels=context.getImageData(0,0,width,height).data;
      let top=height,bottom=-1,left=width,right=-1;
      for(let y=0;y<height;y+=2)for(let x=0;x<width;x+=2){const i=(y*width+x)*4;if(pixels[i]!<235||pixels[i+1]!<235||pixels[i+2]!<235){if(y<top)top=y;if(y>bottom)bottom=y;if(x<left)left=x;if(x>right)right=x;}}
      if(bottom<0){out.push(canvas.toBuffer("image/png").toString("base64"));continue;}
      const pad=16,cx=Math.max(0,left-pad),cy=Math.max(0,top-pad),cw=Math.min(width,right+pad)-cx,ch=Math.min(height,bottom+pad)-cy;
      const cropped=createCanvas(cw,ch);cropped.getContext("2d").drawImage(canvas as never,cx,cy,cw,ch,0,0,cw,ch);
      out.push(cropped.toBuffer("image/png").toString("base64"));
    }
    return out;
  }finally{await doc.close().catch(()=>undefined);}
}

/** Text of a PDF attachment: its own text, or (scanned) what the vision model reads off its pages. */
export async function readPdfAttachment(bytes:Uint8Array,see?:(pngBase64:string,prompt:string)=>Promise<string>):Promise<{text:string;source:"text"|"image"|"none";note?:string}>{
  const {text}=await pdfText(bytes);
  if(text.replace(/\s/g,"").length>=40)return{text,source:"text"};
  if(!see)return{text:"",source:"none",note:"the PDF is a scanned image and no vision model is available"};
  const pages=await pdfPageImages(bytes);
  const read:string[]=[];
  for(const png of pages)read.push((await see(png,"This image is a page of an invoice. Transcribe ALL of its text exactly as printed, line by line, keeping every number, code and currency as written. Do not summarise and do not add anything.")).trim());
  const joined=read.join("\n").trim();
  return joined?{text:joined,source:"image"}:{text:"",source:"none",note:"the scanned PDF could not be read"};
}
