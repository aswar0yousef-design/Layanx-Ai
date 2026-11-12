import fs from "node:fs";
import path from "node:path";
import type {MessagingChannels} from "./channels/service.js";
import type {ShippingDesk} from "./business/shipping.js";
import type {ImprovementRunner} from "./autonomy/improvement-runner.js";
import {adoptSkill,decideIntake,listIntake,requestIntake} from "./autonomy/integration-intake.js";
import {mineFailures,proposeExperiments,readLedger,rollBack} from "./autonomy/improvement-cycle.js";
import {domainBrief,routeGoal,type DomainReader} from "./autonomy/domain-coordinator.js";
import {qrSvg} from "./platform/qr.js";
import {readLearningLedger} from "./autonomy/daily-learning.js";
import {decideProposal,readScoutLedger,runProjectScout,type ScoutIntegrations} from "./autonomy/project-scout.js";
import {approvePulls,checkHardware,describePlan,detectHardware,installedModels,loadCatalog,ollamaPull,pullMode,pullPlanned,readHardwareState} from "./platform/hardware-plan.js";

/** The owner's controls for WhatsApp QR, shipping, the two-domain report, outside code and self-improvement. Every caller is already authorized. */
export interface OwnerRouteDeps{channels?:MessagingChannels;desk:ShippingDesk;domains:DomainReader;intakeRoot:string;ledgerFile:string;jobFiles:()=>string[];improvement:ImprovementRunner;learningFile?:string;startLearning?:()=>unknown;hardwareStore?:string;scoutStore?:string;scoutIntegrations?:ScoutIntegrations}
export type OwnerSend=(status:number,value:Record<string,unknown>)=>void;
export type OwnerRoute=(method:string,url:URL,input:()=>Promise<any>,send:OwnerSend)=>Promise<boolean>;

const PREFIXES=/^\/v1\/(?:channels\/whatsapp\/(?:qr|methods)|shipping|domains|intake|improvement|scout)(?:\/|$)/;

export const isOwnerRoute=(url?:string)=>PREFIXES.test((url??"").split("?")[0]!);
export function createOwnerRoutes(deps:OwnerRouteDeps):OwnerRoute{
  const qrStatus=()=>{
    const qr=deps.channels?.whatsappQr;
    if(!qr)throw new Error("messaging_channels_not_configured");
    const code=qr.qrCode();
    return{status:qr.status(),...(code?{qrSvg:qrSvg(code)}:{})};
  };
  return async(method,url,input,send)=>{
    const route=url.pathname;
    if(!PREFIXES.test(route))return false;
    const parts=route.split("/").slice(2).map(decodeURIComponent);
    try{
      // ---- WhatsApp through a linked device
      if(route==="/v1/channels/whatsapp/qr"&&method==="GET"){send(200,{ok:true,...qrStatus()});return true;}
      if(route==="/v1/channels/whatsapp/qr/link"&&method==="POST"){
        if((await input()).acceptRisk!==true)throw new Error("whatsapp_qr_risk_not_accepted");
        await deps.channels?.whatsappQr.start();
        send(200,{ok:true,...qrStatus()});return true;
      }
      if(route==="/v1/channels/whatsapp/qr/stop"&&method==="POST"){await deps.channels?.whatsappQr.stop();send(200,{ok:true,...qrStatus()});return true;}
      if(route==="/v1/channels/whatsapp/qr/unlink"&&method==="POST"){await deps.channels?.whatsappQr.unlink();send(200,{ok:true,...qrStatus()});return true;}
      if(route==="/v1/channels/whatsapp/methods"&&method==="GET"){send(200,{ok:true,methods:deps.channels?.methods.list()??{}});return true;}
      if(route==="/v1/channels/whatsapp/methods"&&method==="POST"){
        const body=await input();
        if(!deps.channels)throw new Error("messaging_channels_not_configured");
        send(200,{ok:true,methods:deps.channels.methods.set(String(body.number),body.method??null)});return true;
      }
      // ---- Shipping. Booking here records a tracking number by hand; booking through a carrier's API goes through the approved tool.
      if(route==="/v1/shipping"&&method==="GET"){send(200,{ok:true,carriers:deps.desk.carriers(),shipments:deps.desk.list({status:url.searchParams.get("status") as any||undefined,carrierId:url.searchParams.get("carrierId")||undefined})});return true;}
      if(route==="/v1/shipping/report"&&method==="GET"){send(200,{ok:true,report:deps.desk.report(url.searchParams.get("from")||undefined,url.searchParams.get("to")||undefined)});return true;}
      if(route==="/v1/shipping/carrier"&&method==="POST"){send(200,{ok:true,carrier:deps.desk.saveCarrier(await input())});return true;}
      if(route==="/v1/shipping/quote"&&method==="POST"){send(200,{ok:true,quotes:deps.desk.quote(await input())});return true;}
      if(route==="/v1/shipping/shipment"&&method==="POST"){send(200,{ok:true,shipment:deps.desk.create(await input())});return true;}
      if(route==="/v1/shipping/reconcile"&&method==="POST"){const body=await input();send(200,{ok:true,result:deps.desk.reconcile(String(body.carrierId),body.bill??[])});return true;}
      if(parts[0]==="shipping"&&parts[1]==="shipment"&&parts[2]){
        const id=parts[2];
        if(parts[3]==="invoice"&&method==="GET"){send(200,{ok:true,invoice:deps.desk.invoice(id)});return true;}
        if(parts[3]==="book"&&method==="POST"){
          const tracking=String((await input()).trackingNumber??"").trim();
          if(!tracking)throw new Error("shipping_tracking_number_required");
          send(200,{ok:true,shipment:await deps.desk.book(id,tracking)});return true;
        }
        if(parts[3]==="status"&&method==="POST"){const body=await input();send(200,{ok:true,shipment:deps.desk.update(id,body.status,body.note)});return true;}
        if(parts[3]==="cod"&&method==="POST"){send(200,{ok:true,shipment:deps.desk.recordCodCollected(id)});return true;}
      }
      // ---- One report over the store and trading
      if(route==="/v1/domains/route"&&method==="GET"){send(200,{ok:true,routing:routeGoal(url.searchParams.get("goal")??"")});return true;}
      if(route==="/v1/domains/brief"&&method==="GET"){send(200,{ok:true,brief:await domainBrief(deps.domains)});return true;}
      // ---- Outside code. Only the owner reaches these; no tool can approve anything.
      if(route==="/v1/intake"&&method==="GET"){send(200,{ok:true,records:listIntake(deps.intakeRoot)});return true;}
      if(route==="/v1/intake"&&method==="POST"){const body=await input();send(200,{ok:true,record:await requestIntake({source:body.source,target:String(body.target??""),ref:String(body.ref??""),why:String(body.why??"")},{root:deps.intakeRoot})});return true;}
      if(parts[0]==="intake"&&parts[1]&&parts[2]==="decide"&&method==="POST"){
        const decision=(await input()).decision;
        if(decision!=="approved"&&decision!=="rejected")throw new Error("intake_invalid_decision");
        send(200,{ok:true,record:decideIntake(deps.intakeRoot,parts[1],decision)});return true;
      }
      if(parts[0]==="intake"&&parts[1]&&parts[2]==="adopt"&&method==="POST"){send(200,{ok:true,playbook:adoptSkill(deps.intakeRoot,parts[1],String((await input()).skill??""))});return true;}
      // ---- Popular new GitHub projects, reviewed and prepared; the owner approves or rejects each.
      if(route==="/v1/scout"&&method==="GET"){if(!deps.scoutStore)throw new Error("scout_not_configured");const ledger=readScoutLedger(deps.scoutStore);send(200,{ok:true,lastRun:ledger.lastRun??null,proposals:ledger.proposals.slice().reverse()});return true;}
      if(route==="/v1/scout/run"&&method==="POST"){if(!deps.scoutStore)throw new Error("scout_not_configured");const ledger=await runProjectScout(deps.scoutStore,{intakeRoot:deps.intakeRoot});send(200,{ok:true,lastRun:ledger.lastRun,proposals:ledger.proposals.slice().reverse(),...(ledger.problem?{problem:ledger.problem}:{})});return true;}
      if(parts[0]==="scout"&&parts[1]&&parts[2]==="decide"&&method==="POST"){
        if(!deps.scoutStore)throw new Error("scout_not_configured");
        const decision=(await input()).decision;
        if(decision!=="approved"&&decision!=="rejected")throw new Error("scout_invalid_decision");
        send(200,{ok:true,proposal:await decideProposal(deps.scoutStore,deps.intakeRoot,parts[1],decision,deps.scoutIntegrations??{})});return true;
      }
      // ---- Measured self-improvement
      if(route==="/v1/improvement"&&method==="GET"){
        const ledger=readLedger(deps.ledgerFile),patterns=mineFailures(deps.jobFiles());
        send(200,{ok:true,run:deps.improvement.status(),entries:ledger.entries.slice(-50).reverse(),patterns,proposals:proposeExperiments(patterns,{entries:[],baselines:{}},"",5)});return true;
      }
      if(route==="/v1/improvement/learning"&&method==="GET"){const learned=deps.learningFile?readLearningLedger(deps.learningFile):{records:[],heldForOwner:[]};send(200,{ok:true,records:learned.records.slice(-60).reverse(),heldForOwner:learned.heldForOwner.slice(-40).reverse()});return true;}
      if(route==="/v1/hardware"&&method==="GET"){
        if(!deps.hardwareStore)throw new Error("hardware_not_configured");
        const state=readHardwareState(deps.hardwareStore);
        send(200,{ok:true,state,text:state?describePlan(state.plan):"Not checked yet: it runs at every start.",pullMode:pullMode()});return true;
      }
      if(route==="/v1/hardware/check"&&method==="POST"){
        if(!deps.hardwareStore)throw new Error("hardware_not_configured");
        const result=checkHardware(deps.hardwareStore,detectHardware(),await installedModels(process.env.OLLAMA_BASE_URL?.trim()||undefined),loadCatalog());
        send(200,{ok:true,changed:result.changed,state:result.state,text:describePlan(result.state.plan)});return true;
      }
      // The owner allows named downloads from the plan; with LAYANX_MODEL_PULL=off nothing is downloaded even then.
      if(route==="/v1/hardware/approve"&&method==="POST"){
        if(!deps.hardwareStore)throw new Error("hardware_not_configured");
        const body=await input() as {models?:unknown};
        const names=Array.isArray(body?.models)?body.models.filter((name):name is string=>typeof name==="string"):[];
        if(!names.length)throw new Error("models_required");
        const state=approvePulls(deps.hardwareStore,names);
        const mode=pullMode();
        if(mode!=="off")void pullPlanned(state,"ask",ollamaPull(process.env.OLLAMA_BASE_URL?.trim()||undefined));
        send(202,{ok:true,approved:state.approvedPulls,downloading:mode!=="off"});return true;
      }
      if(route==="/v1/improvement/learn"&&method==="POST"){if(!deps.startLearning)throw new Error("learning_not_configured");send(202,{ok:true,run:deps.startLearning()});return true;}
      if(route==="/v1/improvement/run"&&method==="POST"){send(202,{ok:true,run:deps.improvement.start(await input())});return true;}
      if(parts[0]==="improvement"&&parts[1]&&parts[2]==="rollback"&&method==="POST"){
        const entry=rollBack(deps.ledgerFile,parts[1],String((await input()).why??"Undone by the owner."));
        if(!entry)throw new Error("improvement_entry_not_kept");
        send(200,{ok:true,entry});return true;
      }
    }catch(error){send(422,{ok:false,error:error instanceof Error?error.message:"owner_route_failed"});return true;}
    send(404,{ok:false,error:"not_found"});
    return true;
  };
}
/** The job records the improvement cycle learns from: real work, and past benchmark runs. */
export function improvementJobFiles(storeDir:string,runsRoot:string):string[]{
  const files=[path.join(storeDir,"supervisor-jobs.json")];
  try{for(const entry of fs.readdirSync(runsRoot,{withFileTypes:true}))if(entry.isDirectory())files.push(path.join(runsRoot,entry.name,"store","supervisor-jobs.json"));}catch{}
  return files.filter(file=>fs.existsSync(file));
}
