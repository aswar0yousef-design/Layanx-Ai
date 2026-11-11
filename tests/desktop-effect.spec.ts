import assert from "node:assert/strict";
import {createDesktopControlToolAdapter,printedState} from "../src/tools/desktop-control.js";

// A fake window: what each operation answers is set per test, so a tool that "succeeded" without effect is visible.
const real=Object.getOwnPropertyDescriptor(process,"platform")!;
Object.defineProperty(process,"platform",{value:"win32"});
const req=(action:string,payload:Record<string,unknown>)=>({missionId:"m",agentId:"core",projectId:"p",tool:"t",action,permission:"L4_EXECUTE",idempotencyKey:"k",payload} as any);
function fake(answers:Partial<Record<string,string|string[]>>){
  const ops:any[]=[];
  const adapter=createDesktopControlToolAdapter({windows:{async send(op){
    ops.push(op);
    const answer=answers[String(op.op)];
    if(Array.isArray(answer))return answer.shift()??"";
    return answer??"ok";
  }}});
  return{adapter,ops,sent:(name:string)=>ops.some(op=>op.op===name)};
}
try{
  // Position and focus changing is not an effect; a value changing is.
  assert.equal(printedState('{"i":0,"type":"Edit","name":"a","rect":[1,2,3,4],"focused":true}'),'{"i":0,"type":"Edit","name":"a"}');

  // Text that did not arrive is a failure, even though the action "worked".
  {
    const {adapter}=fake({uiset:"value",uiread:'{"i":0,"value":"something else"}'});
    await assert.rejects(adapter.execute(req("desktop set element text",{index:0,text:"hello"})),/not set.*something else/);
  }
  {
    const {adapter}=fake({uiset:"value",uiread:'{"i":0,"value":"hello"}'});
    assert.deepEqual((await adapter.execute(req("desktop set element text",{index:0,text:"hello"})) as any).effect,{verified:true});
  }
  // A password field cannot be read back: reported as unknown, never as verified.
  {
    const {adapter}=fake({uiset:"value",uiread:'{"i":0,"password":true}'});
    assert.equal((await adapter.execute(req("desktop set element text",{index:0,text:"x"})) as any).effect.verified,null);
  }
  // Long text is compared as far as the tree reports it.
  {
    const long="a".repeat(500);
    const {adapter}=fake({uiset:"value",uiread:JSON.stringify({i:0,value:"a".repeat(200)})});
    assert.equal((await adapter.execute(req("desktop set element text",{index:0,text:long})) as any).effect.verified,true);
  }

  // A check box that did not flip is a failure.
  {
    const {adapter}=fake({uiclick:"toggle",uiread:'{"i":1,"checked":false}',uiprint:"same"});
    await assert.rejects(adapter.execute(req("desktop click element",{index:1,pattern:true})),/checked state did not change/);
  }
  {
    const {adapter}=fake({uiclick:"toggle",uiread:['{"i":1,"checked":false}','{"i":1,"checked":true}'],uiprint:["before","after"]});
    assert.equal((await adapter.execute(req("desktop click element",{index:1,pattern:true})) as any).effect.changed,true);
  }
  // A click that changed nothing says so, and the caller decides.
  {
    const {adapter}=fake({uiclick:"mouse|1|2",uiread:'{"i":1}',uiprint:"same"});
    assert.equal((await adapter.execute(req("desktop click element",{index:1})) as any).effect.changed,false);
  }

  // Typing is checked against what the focused element holds.
  {
    const {adapter}=fake({uifocused:["v|","v|other"]});
    await assert.rejects(adapter.execute(req("desktop type",{text:"hello"})),/did not appear/);
  }
  {
    const {adapter}=fake({uifocused:["v|","v|say hello there"]});
    assert.equal((await adapter.execute(req("desktop type",{text:"hello"})) as any).effect.verified,true);
  }
  {
    const {adapter}=fake({uifocused:"none"});
    assert.equal((await adapter.execute(req("desktop type",{text:"hello"})) as any).effect.verified,null,"unreadable is unknown, not verified");
  }

  // Mouse and keyboard go nowhere unless the named window is in front.
  for(const[action,body,op]of [["desktop type",{text:"secret"},"type"],["desktop click",{x:1,y:2},"click"]] as const){
    const {adapter,sent}=fake({uiforeground:"Bank website"});
    await assert.rejects(adapter.execute(req(action,{...body,window:"Notepad"})),/Nothing was sent/);
    assert.equal(sent(op),false);
  }
  {
    const {adapter,sent}=fake({uiforeground:"Untitled - Notepad",uifocused:"none"});
    await adapter.execute(req("desktop type",{text:"x",window:"notepad"}));
    assert.equal(sent("type"),true,"title match ignores case");
  }

  // Focusing is confirmed by what is really in front.
  {
    const {adapter}=fake({focuswin:"ok|1|Notepad",uiforeground:"Something else"});
    await assert.rejects(adapter.execute(req("desktop focus window",{title:"Notepad"})),/Nothing was sent|front window/);
  }
}finally{Object.defineProperty(process,"platform",real);}
console.log("desktop-effect: actions are checked by what really changed, and input only goes to the named window");
