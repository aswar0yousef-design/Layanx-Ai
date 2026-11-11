import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import type {ShippingDesk} from "./shipping.js";

/** The agent's way into the shipping desk. Booking leaves the computer once a carrier API is connected, so it waits for the owner. */
export function registerShippingTools(core:LayanXCore,desk:ShippingDesk){
  const tools:Array<[string,string,"L1_READ"|"L2_ANALYZE"|"L3_MODIFY"|"L4_EXECUTE",boolean,(p:any)=>unknown]>=[
    ["shipping.carriers","list shipping carriers and their prices","L1_READ",false,()=>desk.carriers()],
    ["shipping.carrier.save","add or change a carrier and its price list","L3_MODIFY",false,p=>desk.saveCarrier(p)],
    ["shipping.quote","compare carriers for a city and weight, cheapest first","L1_READ",false,p=>desk.quote(p)],
    ["shipping.create","create the draft shipment of an order","L3_MODIFY",false,p=>desk.create(p)],
    ["shipping.list","list shipments by status or carrier","L1_READ",false,p=>desk.list(p)],
    ["shipping.book","book a shipment with its carrier","L4_EXECUTE",true,p=>desk.book(String(p.id),p.trackingNumber?String(p.trackingNumber):undefined)],
    ["shipping.update","record a shipment's new status by hand","L3_MODIFY",false,p=>desk.update(String(p.id),p.status,p.note?String(p.note):undefined)],
    ["shipping.refresh","read a shipment's latest tracking from its carrier","L3_MODIFY",false,p=>desk.refresh(String(p.id))],
    ["shipping.cod.collected","record that cash on delivery was received","L3_MODIFY",false,p=>desk.recordCodCollected(String(p.id))],
    ["shipping.invoice","produce a shipment's customer invoice","L1_READ",false,p=>desk.invoice(String(p.id))],
    ["shipping.reconcile","compare a carrier's bill with the shipments","L2_ANALYZE",false,p=>desk.reconcile(String(p.carrierId),p.bill??[])],
    ["shipping.report","report volume, delivery rate, lateness and margin by carrier","L2_ANALYZE",false,p=>desk.report(p.from?String(p.from):undefined,p.to?String(p.to):undefined)]
  ];
  for(const[name,description,permission,dangerous,handler]of tools){
    core.tools.register({name,description,permission,dangerous,actions:[name],tags:["business","shipping"]});
    const adapter:ToolAdapter={async execute(request){return handler(request.payload??{});}};
    core.toolAdapters.register(name,adapter);
  }
}
