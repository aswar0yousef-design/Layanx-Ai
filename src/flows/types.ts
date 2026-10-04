export type FlowNodeType="trigger"|"ai_agent"|"condition"|"tool"|"message"|"crm_upsert"|"handoff"|"end";
export type FlowStatus="draft"|"active"|"paused";
export interface FlowNode{ id:string; type:FlowNodeType; label?:string; config:Record<string,unknown>; position?:{x:number;y:number}; }
export interface FlowEdge{ id:string; source:string; target:string; condition?:string; label?:string; }
export interface FlowDefinition{ id:string; projectId:string; name:string; description?:string; status:FlowStatus; version:number; nodes:FlowNode[]; edges:FlowEdge[]; createdAt:string; updatedAt:string; }
export interface FlowEvent{ id:string; projectId:string; channel:string; senderId:string; chatId:string; text:string; timestamp:string; metadata?:Record<string,unknown>; }
export interface FlowExecution{ id:string; flowId:string; projectId:string; eventId:string; status:"running"|"completed"|"failed"|"paused"; currentNodeId?:string; startedAt:string; endedAt?:string; outputs:Record<string,unknown>; trace:string[]; error?:string; handoff?:{queue:string;reason:string}; }
export interface FlowContext{ event:FlowEvent; variables:Record<string,unknown>; outputs:Record<string,unknown>; execution:FlowExecution; }
