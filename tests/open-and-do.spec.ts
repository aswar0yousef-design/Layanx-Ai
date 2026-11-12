import assert from "node:assert/strict";
import {arithmetic,calculatorDisplay,openAndDoRequest} from "../src/tools/open-and-do.js";

// Seen live 2026-11-13: the small model planned web.form / store.report / files.write for these (0/4). Code reads them now.
const write=openAndDoRequest("افتح المفكرة واكتب فيها هذا السطر بالضبط: تقرير LayanX ab12")!;
assert.deepEqual([write.label,write.kind,write.text],["Notepad","write","تقرير LayanX ab12"]);
assert.equal(openAndDoRequest("open notepad and type: hello world")!.text,"hello world");
assert.equal(openAndDoRequest("شغّل المفكرة ثم اكتب «مرحبا»")!.text,"مرحبا");
const calc=openAndDoRequest("افتح الحاسبة واحسب 125 × 8")!;
assert.deepEqual([calc.label,calc.keys,calc.expected],["Calculator","125*8=",1000]);
assert.equal(openAndDoRequest("افتح الحاسبة واحسب ١٥٠٠ ÷ ٣ + ٢٠")!.expected,520,"× ÷ before + −, Arabic digits");
assert.equal(arithmetic("10 - 2 - 3")!.value,5);assert.equal(arithmetic("7 / 0"),null);
assert.equal(openAndDoRequest("افتح المفكرة"),null,"a plain open is the open plan's");
assert.equal(openAndDoRequest("افتح يوتيوب واكتب أغنية"),null,"only the programs this knows how to type into");
assert.equal(openAndDoRequest("افتح الحاسبة واحسب ميزانيتي"),null,"no arithmetic, no plan");
assert.equal(calculatorDisplay({elements:[{name:"Display is 1,000"}]}),1000);
assert.equal(calculatorDisplay({elements:[{name:"العرض هو ١٬٠٠٠"}]}),1000);
{
  const {AiMissionPlanner}=await import("../src/core/ai-planner.js");
  const planner=new AiMissionPlanner({execute:async()=>{throw new Error("no model");}} as any);
  const catalog=["desktop.app.open","desktop.keyboard.type","desktop.ui.tree","web.form","store.report"].map(name=>({name,description:"",permission:"L4_EXECUTE",dangerous:true,actions:[name],tags:[]})) as any;
  const plan=await planner.plan("افتح الحاسبة واحسب 125 × 8",catalog);
  assert.deepEqual(plan.tools.map(t=>t.tool),["desktop.app.open","desktop.keyboard.type","desktop.ui.tree"]);
  assert.deepEqual(plan.tools[1]!.payload,{text:"125*8=",window:"=Calculator|=الحاسبة",waitMs:8000},"typing names its window, by its whole title");
  const catalog2=[...catalog,{name:"desktop.notepad.write",description:"",permission:"L4_EXECUTE",dangerous:true,actions:["desktop notepad write"],tags:[]}];
  const note=await planner.plan("افتح المفكرة واكتب فيها هذا السطر بالضبط: تقرير LayanX ab12",catalog2);
  assert.deepEqual(note.tools.map(t=>[t.tool,t.payload]),[["desktop.notepad.write",{text:"تقرير LayanX ab12"}]],"Notepad text is never typed into whatever tab is in front");
  const {openAndDoReply}=await import("../src/core/task-answer.js");
  assert.equal(openAndDoReply("افتح الحاسبة واحسب 125 × 8",[{ok:true,tool:"desktop.keyboard.type",data:{}},{ok:true,tool:"desktop.ui.tree",data:{elements:[{name:"Display is 1,000"}]}}] as any,true),"الحاسبة تعرض: 1000");
}
console.log("open-and-do: open a program, type only into its window, and report what the window shows");
