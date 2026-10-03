import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRequest} from "../core/types.js";
import {ImapFlow} from "imapflow";
import nodemailer from "nodemailer";
type R=Record<string,unknown>;
function rec(r:ToolRequest):R{return r.payload&&typeof r.payload==="object"&&!Array.isArray(r.payload)?r.payload as R:{}}
function s(v:unknown,n:string){if(typeof v!=="string"||!v.trim())throw new Error(n+" is required.");return v.trim()}
function cfg(){const email=process.env.YAHOO_EMAIL;const password=process.env.YAHOO_APP_PASSWORD;if(!email||!password)throw new Error("Yahoo Mail is not configured. Set YAHOO_EMAIL and YAHOO_APP_PASSWORD.");return {email,password}}
export function createYahooMailAdapter():ToolAdapter{
 async function withClient<T>(fn:(c:ImapFlow)=>Promise<T>){const c0=cfg();const c=new ImapFlow({host:"imap.mail.yahoo.com",port:993,secure:true,auth:{user:c0.email,pass:c0.password},logger:false});await c.connect();try{return await fn(c)}finally{await c.logout().catch(()=>{})}}
 return {async execute(req){
  const i=rec(req),a=req.action.toLowerCase();
  if(a==="search yahoo mail"){const q=typeof i.query==="string"?i.query.trim():"";return withClient(async c=>{const lock=await c.getMailboxLock("INBOX");try{const uids=q?await c.search({or:[{subject:q},{from:q},{to:q}]},{uid:true}):await c.search({},{uid:true});const ids=uids.slice(-Math.min(Math.max(typeof i.limit==="number"?i.limit:20,1),50));const msgs=ids.length?await c.fetchAll(ids,{envelope:true,flags:true},{uid:true}):[];return {messages:msgs.map(m=>({id:String(m.uid),subject:m.envelope.subject??"",from:m.envelope.from?.[0]?.address??"",to:m.envelope.to?.[0]?.address??"",date:m.envelope.date?.toISOString()??"",seen:m.flags.has("\\Seen")}))}}finally{lock.release()}})}
  if(a==="read yahoo mail"){const id=s(i.messageId,"messageId");return withClient(async c=>{const lock=await c.getMailboxLock("INBOX");try{const m=await c.fetchOne(id,{envelope:true,source:true},{uid:true});if(!m)throw new Error("Yahoo message not found.");return {id:String(m.uid),envelope:m.envelope,source:m.source?.toString("utf8")??""}}finally{lock.release()}})}
  if(a==="send yahoo mail"){const c0=cfg();const transporter=nodemailer.createTransport({host:"smtp.mail.yahoo.com",port:465,secure:true,auth:{user:c0.email,pass:c0.password}});return transporter.sendMail({from:c0.email,to:s(i.to,"to"),subject:s(i.subject,"subject"),text:s(i.body,"body")})}
  throw new Error("Unsupported Yahoo Mail action.");
 }}
}