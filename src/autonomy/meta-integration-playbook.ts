/** Deterministic onboarding milestones for an authorized Meta integration.
 * This module describes work; the supervisor still enforces permissions and approvals.
 * Never claim that opening a page or seeing a connected account proves API connectivity.
 */
export interface IntegrationMilestone{
 id:string;title:string;kind:"desktop"|"research"|"code"|"test";
 goal:string;proof:string;requiresOwner?:boolean;
}
export function isMetaIntegrationGoal(goal:string):boolean{
 const meta=/(?:\bmeta\b|ميتا|فيسبوك|facebook|instagram|انستغرام|إنستغرام|واتساب|whatsapp)/iu.test(goal);
 const connect=/(?:اربط|ربط|وصل|توصيل|تكامل|integrat|connect|setup|configure)/iu.test(goal);
 return meta&&connect;
}
export function metaIntegrationMilestones():IntegrationMilestone[]{
 return[
 {id:"inspect",title:"Inspect existing integration",kind:"research",goal:"Inspect current Meta integration configuration, existing connectors, permissions, and previous failures without changing accounts. Avoid duplicate apps and tokens.",proof:"Inventory of existing configuration and missing prerequisites"},
 {id:"browser",title:"Open official Meta configuration",kind:"desktop",goal:"Open the official Meta for Developers and Business configuration pages in the owner's browser, using the existing signed-in session. Do not request or log passwords, cookies, or one-time codes.",proof:"Browser navigation observed and current account context identified"},
 {id:"permissions",title:"Check access and permissions",kind:"research",goal:"Check required app permissions, account roles, WhatsApp Business setup and available official APIs. Request owner assistance for login, 2FA, consent, app review or business verification.",proof:"Documented access and approval status",requiresOwner:true},
 {id:"configure",title:"Configure connector and webhooks",kind:"code",goal:"Implement or configure the authorized Meta API connector, webhook verification, callback URL and local secret references. Never commit access tokens. Avoid duplicate subscriptions.",proof:"Connector configuration and webhook verification test"},
 {id:"verify",title:"End-to-end integration verification",kind:"test",goal:"Test authorized inbound webhook delivery, event handling and permitted outbound message operation with test accounts. Record actual responses and failures.",proof:"Observed API/webhook test results; never infer success from a model response"}
 ];
}
