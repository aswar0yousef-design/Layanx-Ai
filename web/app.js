const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
let token=localStorage.getItem("layanx.apiToken")||"";let activeView="agent";let activeMissionId=null;let pollTimer=null;
if(token)$("#apiToken").value=token;
function headers(json=false){const h={};if(json)h["content-type"]="application/json";if(token)h.authorization="Bearer "+token;return h}
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{...headers(Boolean(opts.body)),...(opts.headers||{})}});let data;try{data=await r.json()}catch{data={ok:r.ok}}if(!r.ok)throw new Error(data.error||("HTTP "+r.status));return data}
function msg(who,text){const el=document.createElement("div");el.className="msg "+who;el.innerHTML="<strong>"+(who==="user"?"أنت":"LayanX")+"</strong><div>"+escapeHtml(text)+"</div>";$("#chatLog").appendChild(el);$("#chatLog").scrollTop=$("#chatLog").scrollHeight}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function project(){return $("#projectId").value.trim()||"default"}
function setBusy(b){const btn=$("#goalForm .send");btn.disabled=b;btn.textContent=b?"LayanX يعمل...":"تشغيل الوكيل ➜"}
function show(view){activeView=view;$$(".view").forEach(x=>x.classList.add("hidden"));$("#"+view+"View").classList.remove("hidden");$$(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view===view));const titles={agent:"الوكيل",missions:"المهام",approvals:"الموافقات",computer:"سطح المكتب",system:"النظام"};$("#viewTitle").textContent=titles[view];if(view==="missions")loadMissions();if(view==="approvals")loadApprovals();if(view==="system")loadSystem();if(view==="computer")loadLive()}
$$(".nav").forEach(b=>b.onclick=()=>show(b.dataset.view));$("#menu").onclick=()=>document.body.classList.toggle("menu-open");$("#refresh").onclick=()=>refreshAll();
$$(".quick").forEach(b=>b.onclick=()=>{$("#goal").value=b.dataset.goal;$("#goalForm").requestSubmit()});
async function runAgent(missionId,approvalIds={}){
 activeMissionId=missionId;startMissionPolling(missionId);
 return api("/v1/missions/"+encodeURIComponent(missionId)+"/agent-loop",{method:"POST",body:JSON.stringify({projectId:project(),maxSteps:10,agentId:"core",approvalIds})});
}
$("#goalForm").onsubmit=async e=>{e.preventDefault();const goal=$("#goal").value.trim();if(!goal)return;$("#goal").value="";msg("user",goal);setBusy(true);try{
 const created=await api("/v1/missions",{method:"POST",body:JSON.stringify({goal,projectId:project()})});activeMissionId=created.mission.id;
 msg("agent","تم إنشاء المهمة "+created.mission.id+" وبدأ التنفيذ.");
 const run=await runAgent(created.mission.id);
 if(run.paused){msg("agent","توقّف الوكيل بأمان لأن الإجراء يحتاج موافقة. افتح «الموافقات» ثم اضغط موافقة.");show("approvals")}
 else if(run.completed)msg("agent","اكتملت المهمة وتم التحقق من نتيجتها.");
 else msg("agent","توقف التنفيذ: "+(run.reason||run.status||"راجع تفاصيل المهمة."));
 await loadMissions();await loadApprovals();await showMissionEvents(created.mission.id);
 }catch(err){msg("agent","تعذر تنفيذ الطلب: "+err.message)}finally{setBusy(false)}};
async function loadMissions(){const box=$("#missionsList");box.innerHTML='<div class="muted">جاري التحميل...</div>';try{const d=await api("/v1/missions?projectId="+encodeURIComponent(project()));const ms=d.missions||[];box.innerHTML=ms.length?ms.map(m=>'<div class="item"><div class="item-head"><b>'+escapeHtml(m.goal||m.id)+'</b><span class="status '+escapeHtml(m.status||"")+'">'+escapeHtml(m.status||"unknown")+'</span></div><div class="muted">'+escapeHtml(m.id)+'</div><div style="margin-top:10px"><button class="secondary details" data-id="'+escapeHtml(m.id)+'">التفاصيل</button>'+((m.status==="running"||m.status==="verifying")?'<button class="secondary danger cancel" data-id="'+escapeHtml(m.id)+'">إيقاف</button>':"")+'</div><pre class="mission-events muted" id="events-'+escapeHtml(m.id)+'"></pre></div>').join(""):'<div class="item muted">لا توجد مهام لهذا المشروع.</div>';
 $$(".details").forEach(b=>b.onclick=()=>showMissionEvents(b.dataset.id));$$(".cancel").forEach(b=>b.onclick=()=>cancelMission(b.dataset.id));ms.forEach(m=>showMissionEvents(m.id).catch(()=>{}));
 }catch(e){box.innerHTML='<div class="item">خطأ: '+escapeHtml(e.message)+'</div>'}}
async function showMissionEvents(id){const pre=$("#events-"+CSS.escape(id));if(!pre)return;try{const d=await api("/v1/missions/"+encodeURIComponent(id)+"?projectId="+encodeURIComponent(project()));const events=d.audit||[];pre.textContent=events.slice(-8).map(x=>x.timestamp+" · "+x.action+" · "+x.result).join("\n")}catch{}}
async function cancelMission(id){try{await api("/v1/control-center/missions/"+encodeURIComponent(id)+"/cancel",{method:"POST",body:JSON.stringify({projectId:project()})});msg("agent","تم إيقاف المهمة "+id+" بأمان.");await loadMissions()}catch(e){alert(e.message)}}
async function loadApprovals(){const box=$("#approvalsList");box.innerHTML='<div class="muted">جاري التحميل...</div>';try{const d=await api("/v1/approvals?projectId="+encodeURIComponent(project()));const a=d.approvals||[];box.innerHTML=a.length?a.map(x=>'<div class="item"><div class="item-head"><b>'+escapeHtml(x.tool||x.action||"Approval")+'</b><span class="status">'+(x.approved?"موافق عليه":"بانتظار الموافقة")+'</span></div><div>'+escapeHtml(x.action||"")+'</div><div class="muted">'+escapeHtml(x.id||"")+'</div>'+(!x.approved?'<div style="margin-top:10px"><button class="secondary approve" data-id="'+escapeHtml(x.id)+'">موافقة ومتابعة</button><button class="secondary danger revoke" data-id="'+escapeHtml(x.id)+'">رفض</button></div>':"")+'</div>').join(""):'<div class="item muted">لا توجد موافقات معلقة.</div>';
 $$(".approve").forEach(b=>b.onclick=()=>decision(b.dataset.id,"approve"));$$(".revoke").forEach(b=>b.onclick=()=>decision(b.dataset.id,"revoke"))
 }catch(e){box.innerHTML='<div class="item">خطأ: '+escapeHtml(e.message)+'</div>'}}
async function decision(id,action){try{
 const d=await api("/v1/approvals/"+encodeURIComponent(id)+"/"+action+"?projectId="+encodeURIComponent(project()),{method:"POST",body:"{}"});
 if(action==="approve"){const approval=d.approval;const missionId=approval?.missionId;const mission=missionId?await api("/v1/missions/"+encodeURIComponent(missionId)+"?projectId="+encodeURIComponent(project())):null;const index=mission?.mission?.tools?.findIndex(t=>t.tool===approval.tool&&t.action===approval.action)??-1;
  if(missionId&&index>=0){msg("agent","تمت الموافقة. استئناف المهمة "+missionId+"...");setBusy(true);try{const run=await runAgent(missionId,{[index]:id});msg("agent",run.completed?"اكتملت المهمة بعد الموافقة.":run.paused?"توجد موافقة أخرى مطلوبة.":("توقف التنفيذ: "+(run.reason||run.status||"راجع المهمة.")))}finally{setBusy(false)}}
 }
 await loadApprovals();await loadMissions()
 }catch(e){alert(e.message)}}
function startMissionPolling(id){clearInterval(pollTimer);pollTimer=setInterval(async()=>{try{await showMissionEvents(id);const d=await api("/v1/missions/"+encodeURIComponent(id)+"?projectId="+encodeURIComponent(project()));const s=d.mission?.status;if(["completed","failed","blocked","cancelled"].includes(s)){clearInterval(pollTimer);await loadMissions();}}catch{clearInterval(pollTimer)}},1500)}
async function loadSystem(){try{const d=await api("/v1/status");const s=d.status||d;const models=s.models||[];const providers=s.providers||[];$("#systemGrid").innerHTML='<div class="stat">الحالة<b>'+escapeHtml(s.ready?"جاهز":"غير جاهز")+'</b></div><div class="stat">النماذج<b>'+models.length+'</b></div><div class="stat">Providers<b>'+providers.length+'</b></div><div class="stat">Persistence<b>'+escapeHtml(String(s.persistence!=="disabled"))+'</b></div>';$("#systemRaw").textContent=JSON.stringify(d,null,2)}catch(e){$("#systemGrid").innerHTML='<div class="item">خطأ: '+escapeHtml(e.message)+'</div>'}}
async function loadLive(){try{const d=await api("/v1/computer/live/status");$("#liveStatus").textContent=d.enabled?"Live Screen يعمل":"Live Screen متوقف";if(d.enabled){const f=await api("/v1/computer/live/frame");if(f.frame){$("#liveFrame").src=f.frame.dataUrl||f.frame.url||"";$("#liveFrame").hidden=false}}}catch(e){$("#liveStatus").textContent="Live Screen غير متاح: "+e.message}}
$("#liveStart").onclick=async()=>{try{await api("/v1/computer/live/start",{method:"POST",body:"{}"});loadLive()}catch(e){alert(e.message)}};$("#liveStop").onclick=async()=>{try{await api("/v1/computer/live/stop",{method:"POST",body:"{}"});$("#liveFrame").hidden=true;loadLive()}catch(e){alert(e.message)}};
$("#missionsRefresh").onclick=loadMissions;$("#approvalsRefresh").onclick=loadApprovals;$("#systemRefresh").onclick=loadSystem;
$("#projectId").onchange=()=>{if(activeView==="missions")loadMissions();if(activeView==="approvals")loadApprovals()};
$("#saveToken").onclick=()=>{token=$("#apiToken").value.trim();if(token)localStorage.setItem("layanx.apiToken",token);else localStorage.removeItem("layanx.apiToken");refreshAll()};
async function refreshAll(){try{const h=await api("/v1/health");$("#healthDot").classList.add("ok");$("#healthText").textContent=h.healthy?"النظام سليم":"تحذير"}catch(e){$("#healthDot").classList.remove("ok");$("#healthText").textContent="API غير متاح"}if(activeView==="missions")loadMissions();if(activeView==="approvals")loadApprovals()}
refreshAll();