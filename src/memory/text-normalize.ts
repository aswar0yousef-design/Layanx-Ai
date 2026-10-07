/**
 * Search normalisation for Arabic and English memory text.
 *
 * Arabic is written with optional diacritics, several alef/ya/ta-marbuta forms and attached
 * prefixes (ال، و، ب، ل، ف، ك), so "المشروع" and "مشروع" or "الصفحة" and "صفحه" used to miss
 * each other with a plain substring check. Every token is normalised and lightly stemmed; both
 * the stem and the normalised token are indexed.
 */
const DIACRITICS=/[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL=/ـ/g;
const ARABIC_DIGITS="٠١٢٣٤٥٦٧٨٩";
const ARABIC=/[؀-ۿ]/;

export function normalizeText(value:string):string{
 return value
  .toLowerCase()
  .replace(DIACRITICS,"")
  .replace(TATWEEL,"")
  .replace(/[أإآٱ]/g,"ا")
  .replace(/ى/g,"ي")
  .replace(/ؤ/g,"و")
  .replace(/ئ/g,"ي")
  .replace(/ة/g,"ه")
  .replace(/[٠-٩]/g,d=>String(ARABIC_DIGITS.indexOf(d)));
}

const AR_PREFIXES=["وال","بال","كال","فال","لل","ال"];
const AR_SUFFIXES=["ات","ون","ين","ان","ها","هم","هن","كم","نا","يه","يا","ه","ي"];
const EN_SUFFIXES=["ing","ed","es","s"];

/** Light stemmer: strips one common prefix and one common suffix, never below 3 letters (2 for English). */
export function stem(token:string):string{
 if(ARABIC.test(token)){
  let t=token;
  for(const p of AR_PREFIXES){if(t.startsWith(p)&&t.length-p.length>=3){t=t.slice(p.length);break;}}
  for(const s of AR_SUFFIXES){if(t.endsWith(s)&&t.length-s.length>=3){t=t.slice(0,-s.length);break;}}
  return t;
 }
 for(const s of EN_SUFFIXES){if(token.endsWith(s)&&token.length-s.length>=4)return token.slice(0,-s.length);}
 return token;
}

/** Normalised tokens of length >= 2. */
export function tokenize(value:string):string[]{
 return normalizeText(value).split(/[^\p{L}\p{N}_]+/u).filter(token=>token.length>1);
}

/** Distinct search terms (stems) for a query. */
export function searchTerms(value:string):string[]{
 return [...new Set(tokenize(value).map(stem))];
}

/** Index set for a document: normalised tokens plus their stems. */
export function indexTerms(value:string):Set<string>{
 const out=new Set<string>();
 for(const token of tokenize(value)){out.add(token);out.add(stem(token));}
 return out;
}

export function cosine(a:ArrayLike<number>,b:ArrayLike<number>):number{
 const n=Math.min(a.length,b.length);let dot=0,na=0,nb=0;
 for(let i=0;i<n;i++){const x=a[i]!,y=b[i]!;dot+=x*y;na+=x*x;nb+=y*y;}
 return na&&nb?dot/Math.sqrt(na*nb):0;
}
