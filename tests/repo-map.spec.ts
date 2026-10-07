import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildRepoMap,extractDefinitions,findReferences} from "../src/autonomy/repo-map.js";
import {knowledgeSummary,projectRules} from "../src/autonomy/knowledge.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-map-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
const dir=path.join(root,"shop");
const write=(rel:string,text:string)=>{fs.mkdirSync(path.dirname(path.join(dir,rel)),{recursive:true});fs.writeFileSync(path.join(dir,rel),text);};
write("src/cart.ts",`export interface CartItem{sku:string;qty:number}\nexport function calculateTotal(items:CartItem[]):number{return items.reduce((n,i)=>n+i.qty,0);}\nexport class CheckoutService{\n  async payOrder(orderId:string){return calculateTotal([]);}\n}\n`);
write("src/pages/checkout.ts",`import {calculateTotal,CheckoutService} from "../cart.js";\nexport function renderCheckout(){const s=new CheckoutService();return calculateTotal([])+String(s);}\n`);
write("src/pages/admin.ts",`import {calculateTotal} from "../cart.js";\nexport const adminTotals=()=>calculateTotal([]);\n`);
write("api/server.py","class OrderApi:\n    def create_order(self, data):\n        return data\n\ndef start_server(port):\n    pass\n");
write("lib/main.dart","class ShopApp extends StatelessWidget {\n  Widget build(BuildContext context) { return Container(); }\n}\nFuture<void> loadProducts() async {}\n");
write("node_modules/dep/index.js","export function shouldNotAppear(){}\n");
write("AGENTS.md","Use pnpm. Never edit src/generated.\n");

// Definitions per language; the body of one-line functions is not leaked into the signature.
assert.deepEqual(extractDefinitions("a.ts","export function f(o:{a:number}){return o.a}").map(d=>d.signature),["export function f(o:{a:number})"]);
assert.deepEqual(extractDefinitions("api/server.py",fs.readFileSync(path.join(dir,"api/server.py"),"utf8")).map(d=>d.name),["OrderApi","create_order","start_server"]);
assert.ok(extractDefinitions("lib/main.dart",fs.readFileSync(path.join(dir,"lib/main.dart"),"utf8")).some(d=>d.name==="loadProducts"));

const map=buildRepoMap(dir,{tokenBudget:400});
assert.equal(map.ranked[0]!.file,"src/cart.ts","the most-used file ranks first");
assert.match(map.text,/calculateTotal\(items:CartItem\[\]\):number/);
assert.ok(!map.text.includes("shouldNotAppear"),"dependencies are not mapped");
const focused=buildRepoMap(dir,{focus:"python order api",tokenBudget:400});
assert.equal(focused.ranked[0]!.file,"api/server.py","focus terms pull related code to the top");

const refs=findReferences(dir,"calculateTotal");
assert.deepEqual(refs.definitions.map(d=>d.file),["src/cart.ts"]);
assert.deepEqual(refs.files.sort(),["src/cart.ts","src/pages/admin.ts","src/pages/checkout.ts"]);
assert.throws(()=>findReferences(dir,"rm -rf /"),/single identifier/);

assert.match(projectRules(dir),/\(AGENTS\.md\) Use pnpm/);
assert.match(knowledgeSummary("shop"),/PROJECT RULES[\s\S]*Never edit src\/generated/,"rules reach the planner even before .layanx exists");
fs.rmSync(root,{recursive:true,force:true});
console.log("repo-map: definitions, ranking, focus, references and project rules verified");
