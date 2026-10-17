import assert from "node:assert/strict";
import {SkillRegistry,type SkillManifest} from "../src/skills/registry.js";

const registry=new SkillRegistry();
const manifest=(id:string,name:string,description:string,tools:string[]):SkillManifest=>({
 id,name,version:"1.0.0",description,source:"test",license:"MIT",permissions:["L1_READ"],tools,networkHosts:[],checksum:"test-checksum",status:"quarantined"
});
registry.register(manifest("shopify-catalog","Shopify catalog","Manage product inventory and store catalog",["shopify.product.list","shopify.product.update"]));
registry.approve("shopify-catalog");registry.enable("shopify-catalog");
registry.register(manifest("email-digest","Email digest","Search and summarize inbox messages",["email.search","email.read"]));
registry.approve("email-digest");registry.enable("email-digest");
registry.register(manifest("disabled-skill","Disabled store helper","Store product operations",["shopify.product.list"]));
registry.approve("disabled-skill");registry.enable("disabled-skill");registry.disable("disabled-skill");

const store=registry.recommend("Update Shopify product inventory",5);
assert.equal(store[0]?.id,"shopify-catalog");
assert.ok(store[0].matchedTerms.includes("shopify"));
assert.ok(!store.some(x=>x.id==="disabled-skill"),"disabled skills must never be recommended");
assert.deepEqual(registry.recommend("zzzz-no-match",5),[]);
assert.deepEqual(registry.recommend("   ",5),[]);
assert.ok(registry.recommend("Search and summarize inbox emails",1).every(x=>x.status==="enabled"));
console.log("skill-recommend: task relevance ranking, enabled-only filtering, empty input and no-match cases passed");
