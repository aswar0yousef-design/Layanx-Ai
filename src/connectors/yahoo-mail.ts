import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRequest} from "../core/types.js";
import {ImapFlow} from "imapflow";
import nodemailer from "nodemailer";

type R=Record<string,unknown>;
type MailConfig={email:string;password:string};
type ImapClient=ImapFlow;
type ImapFactory=(config:ConstructorParameters<typeof ImapFlow>[0])=>ImapClient;
type SmtpFactory=(config:Parameters<typeof nodemailer.createTransport>[0])=>{sendMail(message:Record<string,unknown>):Promise<unknown>};

function rec(r:ToolRequest):R{return r.payload&&typeof r.payload==="object"&&!Array.isArray(r.payload)?r.payload as R:{}}
function s(v:unknown,n:string){if(typeof v!=="string"||!v.trim())throw new Error(n+" is required.");return v.trim()}
function cfg():MailConfig{const email=process.env.YAHOO_EMAIL;const password=process.env.YAHOO_APP_PASSWORD;if(!email||!password)throw new Error("Yahoo Mail is not configured. Set YAHOO_EMAIL and YAHOO_APP_PASSWORD.");return {email,password}}

export interface YahooMailAdapterOptions{
 imapFactory?:ImapFactory;
 smtpFactory?:SmtpFactory;
 config?:MailConfig;
}
export function createYahooMailAdapter(options:YahooMailAdapterOptions={}):ToolAdapter{
 const imapFactory=options.imapFactory??((config)=>new ImapFlow(config));
 const smtpFactory=options.smtpFactory??((config)=>nodemailer.createTransport(config));
 function getConfig(){return options.config??cfg()}
 async function withClient<T>(fn:(c:ImapClient)=>Promise<T>){
  const c0=getConfig();
  const c=imapFactory({host:"imap.mail.yahoo.com",port:993,secure:true,auth:{user:c0.email,pass:c0.password},logger:false});
  await c.connect();
  try{return await fn(c)}finally{await c.logout().catch(()=>{})}
 }
 return {async execute(req){
  const i=rec(req),a=req.action.toLowerCase();
  if(a==="search yahoo mail")return withClient(async c=>{
   const lock=await c.getMailboxLock("INBOX");
   try{
    const q=typeof i.query==="string"?i.query.trim():"";
    const found=q?await c.search({or:[{subject:q},{from:q},{to:q}]},{uid:true}):await c.search({},{uid:true});
    const uids=Array.isArray(found)?found:[];
    const ids=uids.slice(-Math.min(Math.max(typeof i.limit==="number"?i.limit:20,1),50));
    const msgs=ids.length?await c.fetchAll(ids,{envelope:true,flags:true},{uid:true}):[];
    return {messages:msgs.map(m=>{const envelope=m.envelope;const date=envelope?.date;return {id:String(m.uid),subject:envelope?.subject??"",from:envelope?.from?.[0]?.address??"",to:envelope?.to?.[0]?.address??"",date:typeof date==="string"?date:date instanceof Date?date.toISOString():"",seen:m.flags?.has("\\Seen")??false};})}
   }finally{lock.release()}
  });
  if(a==="read yahoo mail")return withClient(async c=>{
   const lock=await c.getMailboxLock("INBOX");
   try{const m=await c.fetchOne(s(i.messageId,"messageId"),{envelope:true,source:true},{uid:true});if(!m)throw new Error("Yahoo message not found.");return {id:String(m.uid),envelope:m.envelope,source:m.source?.toString("utf8")??""}}
   finally{lock.release()}
  });
  if(a==="send yahoo mail"){
   const c0=getConfig();
   const transporter=smtpFactory({host:"smtp.mail.yahoo.com",port:465,secure:true,auth:{user:c0.email,pass:c0.password}});
   return transporter.sendMail({from:c0.email,to:s(i.to,"to"),subject:s(i.subject,"subject"),text:s(i.body,"body")});
  }
  throw new Error("Unsupported Yahoo Mail action.");
 }}
}