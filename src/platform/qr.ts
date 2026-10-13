/**
 * A small QR code encoder (byte mode, error correction level M), enough for the
 * pairing link shown on the setup page. Written here so the setup page needs no
 * outside script. Follows ISO/IEC 18004 the way Project Nayuki's reference
 * implementation does (MIT); checked against a real decoder in the tests.
 */
const ECC_PER_BLOCK_M=[-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
const BLOCKS_M=[-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];
const FORMAT_BITS_M=0;

function rawModules(ver:number):number{
  let result=(16*ver+128)*ver+64;
  if(ver>=2){
    const numAlign=Math.floor(ver/7)+2;
    result-=(25*numAlign-10)*numAlign-55;
    if(ver>=7)result-=36;
  }
  return result;
}
const dataCodewords=(ver:number)=>Math.floor(rawModules(ver)/8)-(ECC_PER_BLOCK_M[ver] as number)*(BLOCKS_M[ver] as number);

function gfMul(x:number,y:number):number{
  let z=0;
  for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x;}
  return z&0xff;
}
function rsDivisor(degree:number):number[]{
  const result=new Array<number>(degree).fill(0);
  result[degree-1]=1;
  let root=1;
  for(let i=0;i<degree;i++){
    for(let j=0;j<result.length;j++){
      result[j]=gfMul(result[j] as number,root);
      if(j+1<result.length)result[j]=(result[j] as number)^(result[j+1] as number);
    }
    root=gfMul(root,0x02);
  }
  return result;
}
function rsRemainder(data:number[],divisor:number[]):number[]{
  const result=new Array<number>(divisor.length).fill(0);
  for(const b of data){
    const factor=b^(result.shift() as number);
    result.push(0);
    divisor.forEach((coef,i)=>{result[i]=(result[i] as number)^gfMul(coef,factor);});
  }
  return result;
}

/** Encodes `text` (UTF-8) and returns the module matrix, true = dark. */
export function qrMatrix(text:string):boolean[][]{
  const bytes=[...Buffer.from(text,"utf8")];
  let ver=1;
  for(;ver<=24;ver++){ // checked with a real decoder up to version 24 (~900 bytes); pairing links are ~150
    const countBits=ver<=9?8:16;
    if(4+countBits+bytes.length*8<=dataCodewords(ver)*8)break;
  }
  if(ver>24)throw new Error("Text too long for a QR code.");
  const capacity=dataCodewords(ver)*8;
  const bits:number[]=[];
  const put=(value:number,len:number)=>{for(let i=len-1;i>=0;i--)bits.push((value>>>i)&1);};
  put(0b0100,4);put(bytes.length,ver<=9?8:16);
  for(const b of bytes)put(b,8);
  put(0,Math.min(4,capacity-bits.length));
  put(0,(8-bits.length%8)%8);
  for(let pad=0xec;bits.length<capacity;pad^=0xec^0x11)put(pad,8);
  const data:number[]=[];
  for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>(a<<1)|b,0));

  // Error correction blocks, interleaved.
  const numBlocks=BLOCKS_M[ver] as number,eccLen=ECC_PER_BLOCK_M[ver] as number;
  const raw=Math.floor(rawModules(ver)/8);
  const numShort=numBlocks-raw%numBlocks,shortLen=Math.floor(raw/numBlocks);
  const divisor=rsDivisor(eccLen);
  const blocks:number[][]=[];
  for(let i=0,k=0;i<numBlocks;i++){
    const dat=data.slice(k,k+shortLen-eccLen+(i<numShort?0:1));
    k+=dat.length;
    const ecc=rsRemainder(dat,divisor);
    if(i<numShort)dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords:number[]=[];
  for(let i=0;i<(blocks[0] as number[]).length;i++)
    blocks.forEach((block,j)=>{if(i!==shortLen-eccLen||j>=numShort)codewords.push(block[i] as number);});

  const size=ver*4+17;
  const modules=Array.from({length:size},()=>new Array<boolean>(size).fill(false));
  const fixed=Array.from({length:size},()=>new Array<boolean>(size).fill(false));
  const set=(x:number,y:number,dark:boolean)=>{(modules[y] as boolean[])[x]=dark;(fixed[y] as boolean[])[x]=true;};

  for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
  const finder=(cx:number,cy:number)=>{
    for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
      const x=cx+dx,y=cy+dy,d=Math.max(Math.abs(dx),Math.abs(dy));
      if(x>=0&&x<size&&y>=0&&y<size)set(x,y,d!==2&&d!==4);
    }
  };
  finder(3,3);finder(size-4,3);finder(3,size-4);
  if(ver>1){
    const numAlign=Math.floor(ver/7)+2;
    const step=Math.floor((ver*8+numAlign*3+5)/(numAlign*4-4))*2;
    const pos=[6];
    for(let p=size-7;pos.length<numAlign;p-=step)pos.splice(1,0,p);
    for(let i=0;i<numAlign;i++)for(let j=0;j<numAlign;j++){
      if((i===0&&j===0)||(i===0&&j===numAlign-1)||(i===numAlign-1&&j===0))continue;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set((pos[i] as number)+dx,(pos[j] as number)+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
    }
  }
  const drawFormat=(mask:number)=>{
    const value=(FORMAT_BITS_M<<3)|mask;
    let rem=value;
    for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);
    const f=((value<<10)|rem)^0x5412;
    const bit=(i:number)=>((f>>>i)&1)!==0;
    for(let i=0;i<=5;i++)set(8,i,bit(i));
    set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));
    for(let i=9;i<15;i++)set(14-i,8,bit(i));
    for(let i=0;i<8;i++)set(size-1-i,8,bit(i));
    for(let i=8;i<15;i++)set(8,size-15+i,bit(i));
    set(8,size-8,true);
  };
  drawFormat(0);
  if(ver>=7){
    let rem=ver;
    for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>>11)*0x1f25);
    const v=(ver<<12)|rem;
    for(let i=0;i<18;i++){
      const dark=((v>>>i)&1)!==0,a=size-11+i%3,b=Math.floor(i/3);
      set(a,b,dark);set(b,a,dark);
    }
  }
  // Data, in the zig-zag order.
  let i=0;
  for(let right=size-1;right>=1;right-=2){
    if(right===6)right=5;
    for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){
      const x=right-j,upward=((right+1)&2)===0,y=upward?size-1-vert:vert;
      if(!(fixed[y] as boolean[])[x]&&i<codewords.length*8){
        (modules[y] as boolean[])[x]=(((codewords[i>>>3] as number)>>>(7-(i&7)))&1)!==0;
        i++;
      }
    }
  }
  const masked=(mask:number)=>{
    const out=modules.map(r=>r.slice());
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      if((fixed[y] as boolean[])[x])continue;
      const invert=[(x+y)%2===0,y%2===0,x%3===0,(x+y)%3===0,(Math.floor(x/3)+Math.floor(y/2))%2===0,(x*y)%2+(x*y)%3===0,((x*y)%2+(x*y)%3)%2===0,((x+y)%2+(x*y)%3)%2===0][mask];
      if(invert)(out[y] as boolean[])[x]=!(out[y] as boolean[])[x];
    }
    return out;
  };
  // Pick the mask that is easiest to scan (runs, 2x2 blocks, dark/light balance).
  let bestMask=0,bestScore=Infinity;
  for(let mask=0;mask<8;mask++){
    drawFormat(mask);
    const score=penalty(masked(mask));
    if(score<bestScore){bestScore=score;bestMask=mask;}
  }
  drawFormat(bestMask);
  return masked(bestMask);
}

function penalty(m:boolean[][]):number{
  const size=m.length;let score=0,dark=0;
  const runs=(get:(a:number,b:number)=>boolean)=>{
    for(let a=0;a<size;a++){
      let run=1;
      for(let b=1;b<size;b++){
        if(get(a,b)===get(a,b-1)){run++;if(run===5)score+=3;else if(run>5)score++;}
        else run=1;
      }
    }
  };
  runs((y,x)=>(m[y] as boolean[])[x] as boolean);
  runs((x,y)=>(m[y] as boolean[])[x] as boolean);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const c=(m[y] as boolean[])[x] as boolean;
    if(c)dark++;
    if(x<size-1&&y<size-1&&c===(m[y] as boolean[])[x+1]&&c===(m[y+1] as boolean[])[x]&&c===(m[y+1] as boolean[])[x+1])score+=3;
  }
  const total=size*size;
  score+=Math.ceil(Math.abs(dark*20-total*10)/total-1)*10;
  return score;
}

/** The QR code as an SVG image (black on white, 4-module quiet zone). */
export function qrSvg(text:string,moduleSize=6):string{
  const m=qrMatrix(text);
  const size=m.length+8;
  let path="";
  m.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)path+=`M${x+4} ${y+4}h1v1h-1z`;}));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size*moduleSize}" height="${size*moduleSize}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
