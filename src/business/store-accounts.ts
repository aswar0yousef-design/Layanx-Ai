import {localSecret} from "../security/local-secret-vault.js";
import type {Store} from "./types.js";

/**
 * Online stores connected from the Connected Accounts page: each store has its own keys (two Shopify
 * shops are two tokens), kept in the local secret vault under the store's id and checked with the
 * store before anything is saved. The keys set for the whole of LayanX (LAYANX_SHOPIFY_ACCESS_TOKEN,
 * LAYANX_WOOCOMMERCE_CONSUMER_KEY/SECRET) still serve stores that have none of their own.
 */
export const SHOPIFY_API_VERSION=()=>process.env.LAYANX_SHOPIFY_API_VERSION?.trim()||"2026-04";
export const storeSecret={
  shopifyToken:(id:string)=>`store.${id}.shopify.token`,
  wooKey:(id:string)=>`store.${id}.woocommerce.key`,
  wooSecret:(id:string)=>`store.${id}.woocommerce.secret`
};
/** The keys a store uses: its own, else the ones set for all of LayanX. */
export function shopifyToken(store:Pick<Store,"id">):string|undefined{
  return localSecret(storeSecret.shopifyToken(store.id))??localSecret("shopify.access_token",process.env.LAYANX_SHOPIFY_ACCESS_TOKEN);
}
export function wooKeys(store:Pick<Store,"id">):{key?:string;secret?:string}{
  return{key:localSecret(storeSecret.wooKey(store.id))??localSecret("woocommerce.consumer_key",process.env.LAYANX_WOOCOMMERCE_CONSUMER_KEY),
    secret:localSecret(storeSecret.wooSecret(store.id))??localSecret("woocommerce.consumer_secret",process.env.LAYANX_WOOCOMMERCE_CONSUMER_SECRET)};
}
export function hasOwnKeys(store:Pick<Store,"id"|"platform">):boolean{
  return store.platform==="shopify"?!!localSecret(storeSecret.shopifyToken(store.id)):store.platform==="woocommerce"?!!localSecret(storeSecret.wooKey(store.id)):false;
}

export interface StoreConnectInput{platform:"shopify"|"woocommerce";name?:string;address:string;token?:string;consumerKey?:string;consumerSecret?:string}
export interface VerifiedStore{platform:"shopify"|"woocommerce";name:string;baseUrl:string;secrets:Record<"token"|"key"|"secret",string|undefined>}

/** "myshop", "myshop.myshopify.com" or its https address → the shop's myshopify.com host (the Admin API answers only there). */
export function shopifyHost(address:string):string{
  const raw=address.trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/.*$/,"");
  const host=/^[a-z0-9][a-z0-9-]{0,60}$/.test(raw)?raw+".myshopify.com":raw;
  if(!/^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(host))throw new Error("store_shopify_address: use the shop's myshopify.com address (Shopify admin → Settings → Domains), e.g. myshop.myshopify.com");
  return host;
}
/** A WordPress site's https address → its WooCommerce REST API root. */
export function wooRoot(address:string):string{
  let u:URL;try{u=new URL(/^https?:\/\//i.test(address.trim())?address.trim():"https://"+address.trim());}catch{throw new Error("store_woocommerce_address: enter the site's address, e.g. https://mystore.com");}
  if(u.protocol!=="https:")throw new Error("store_woocommerce_https: WooCommerce keys are sent only over https");
  return u.origin+u.pathname.replace(/\/+$/,"").replace(/\/wp-json(\/wc\/v3)?$/,"")+"/wp-json/wc/v3";
}

/** Check the keys with the store itself, then return what to save. Nothing is saved when the store refuses them. */
export async function verifyStore(input:StoreConnectInput,fetcher:typeof fetch=fetch):Promise<VerifiedStore>{
  const get=async(url:string,headers:Record<string,string>={})=>{
    const r=await fetcher(url,{headers:{accept:"application/json",...headers},redirect:"error",signal:AbortSignal.timeout(20_000)});
    const d=await r.json().catch(()=>({})) as any;
    if(r.status===401||r.status===403)throw new Error("store_keys_rejected: the store refused these keys (HTTP "+r.status+")");
    if(!r.ok)throw new Error("store_unreachable: HTTP "+r.status+(d?.message?" "+String(d.message).slice(0,160):""));
    return d;
  };
  if(input.platform==="shopify"){
    const token=(input.token??"").trim();
    if(!/^shp(at|ca|pa)_[A-Za-z0-9]{20,80}$/.test(token))throw new Error("store_shopify_token: paste the Admin API access token (it starts with shpat_)");
    const host=shopifyHost(input.address);const baseUrl=`https://${host}/admin/api/${SHOPIFY_API_VERSION()}`;
    const d=await get(`${baseUrl}/shop.json`,{"X-Shopify-Access-Token":token});
    return{platform:"shopify",name:(input.name?.trim()||String(d?.shop?.name??host)).slice(0,80),baseUrl,secrets:{token,key:undefined,secret:undefined}};
  }
  if(input.platform==="woocommerce"){
    const key=(input.consumerKey??"").trim(),secret=(input.consumerSecret??"").trim();
    if(!/^ck_[a-f0-9]{30,64}$/.test(key)||!/^cs_[a-f0-9]{30,64}$/.test(secret))throw new Error("store_woocommerce_keys: paste the Consumer key (ck_…) and Consumer secret (cs_…)");
    const baseUrl=wooRoot(input.address);
    await get(`${baseUrl}/products?per_page=1`,{authorization:"Basic "+Buffer.from(key+":"+secret).toString("base64")});
    return{platform:"woocommerce",name:(input.name?.trim()||new URL(baseUrl).hostname).slice(0,80),baseUrl,secrets:{token:undefined,key,secret}};
  }
  throw new Error("store_platform_unsupported");
}

/** Keep a verified store's keys under its id, or forget them. */
export function saveStoreKeys(storeId:string,v:VerifiedStore,vault:{set(k:string,v:string):void}):void{
  if(v.secrets.token)vault.set(storeSecret.shopifyToken(storeId),v.secrets.token);
  if(v.secrets.key)vault.set(storeSecret.wooKey(storeId),v.secrets.key);
  if(v.secrets.secret)vault.set(storeSecret.wooSecret(storeId),v.secrets.secret);
}
export function forgetStoreKeys(storeId:string,vault:{delete(k:string):unknown}):void{
  for(const k of [storeSecret.shopifyToken(storeId),storeSecret.wooKey(storeId),storeSecret.wooSecret(storeId)])vault.delete(k);
}
