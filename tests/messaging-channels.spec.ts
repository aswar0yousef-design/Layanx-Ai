import assert from "node:assert/strict";
import {WhatsAppCloudAdapter} from "../src/channels/whatsapp-cloud.js";
import {TelegramAdapter} from "../src/channels/telegram.js";
import {ChannelRouter} from "../src/channels/router.js";

process.env.LAYANX_WHATSAPP_ACCESS_TOKEN="test-token";
process.env.LAYANX_WHATSAPP_PHONE_NUMBER_ID="123";
process.env.LAYANX_WHATSAPP_VERIFY_TOKEN="verify";
process.env.LAYANX_TELEGRAM_BOT_TOKEN="telegram-token";

const wa=new WhatsAppCloudAdapter();
assert.equal(wa.verify("subscribe","verify","abc"),"abc");
assert.throws(()=>wa.verify("subscribe","wrong","abc"));
const message=wa.parseWebhook({entry:[{changes:[{value:{messages:[{id:"m1",from:"96890000000",type:"text",text:{body:"hello"},timestamp:"1"}]}}]}]});
assert.equal(message?.senderId,"96890000000");
assert.equal(message?.text,"hello");
assert.equal(wa.status().enabled,true);

const telegram=new TelegramAdapter();
assert.equal(telegram.status().enabled,true);
assert.equal(telegram.status().transport,"long_polling");

const router=new ChannelRouter({} as any,{ownerIds:new Set(["owner"]),staffIds:new Set(["staff"])});
assert.equal(router.roleFor("owner"),"owner");
assert.equal(router.roleFor("staff"),"staff");
assert.equal(router.roleFor("customer"),"customer");

console.log("messaging-channels.spec.ts: ok");
