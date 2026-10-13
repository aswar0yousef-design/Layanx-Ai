import React,{useCallback,useEffect,useMemo,useRef,useState}from"react";
import{Alert,AppState,Image,Linking,PermissionsAndroid,Platform,Pressable,RefreshControl,SafeAreaView,ScrollView,StyleSheet,Switch,Text,TextInput,View}from"react-native";
import*as SecureStore from"expo-secure-store";
import{CameraView,useCameraPermissions}from"expo-camera";
import{LayanxNative}from"./modules/layanx-native";
import{LayanXApi,LinkError,pairWithLink,type AgentSession,type CompanionApproval,type CompanionFeed,type Job,type LinkedDevice,type MissionSummary}from"./src/api";

/**
 * LayanX on the phone. Each paired computer is reached over the encrypted link (keys stay in the
 * Android Keystore, never in JavaScript). While the app is open it follows the PC's companion feed
 * (approvals, jobs, coding agents, PC load); with "live updates" on, a small Android service keeps
 * following it with the app closed and shows notifications, the widget and the quick tile.
 */
type Tab="home"|"missions"|"apps"|"settings";
const K={project:"layanx.project",legacy:"layanx.devices"};
const C={bg:"#0A0F1E",panel:"#121A2E",panel2:"#18223A",line:"#24304D",ink:"#EEF2FA",soft:"#9AA6C2",purple:"#6D4AFF",purple2:"#8B6CFF",green:"#22C55E",amber:"#F59E0B",rose:"#EF4444",blue:"#3B82F6"};
const STATUS:Record<string,[string,string]>={completed:["مكتملة",C.green],failed:["فشلت",C.rose],running:["قيد التنفيذ",C.blue],planned:["مخططة",C.blue],verifying:["قيد التحقق",C.blue],blocked:["متوقفة",C.amber],cancelled:["أُلغيت",C.soft]};
const JOB:Record<string,string>={queued:"في الانتظار",planning:"يخطط",running:"يعمل",waiting_approval:"ينتظر موافقتك",verifying:"تحقق نهائي",completed:"اكتملت",failed:"توقفت",cancelled:"أُلغيت",budget_exhausted:"انتهى الوقت"};
const ACTIVE_JOB=["queued","planning","running","waiting_approval","verifying"];
const AGENT_STATUS:Record<AgentSession["status"],[string,string]>={working:["يعمل",C.blue],waiting:["ينتظر",C.amber],idle:["انتهى",C.green],ended:["أُغلق",C.soft]};
const APPS:Array<{key:string;label:string;color:string;goal:string}>=[
 {key:"shop",label:"التجارة",color:"#16A34A",goal:"أنشئ 5 منتجات جديدة في المتجر مع أوصاف"},
 {key:"social",label:"التواصل",color:"#DB2777",goal:"اكتب منشوراً لإنستغرام عن أحدث منتج"},
 {key:"ads",label:"الإعلانات",color:"#D97706",goal:"حلّل أداء الحملات الإعلانية واقترح تحسينات"},
 {key:"pc",label:"الكمبيوتر",color:"#2563EB",goal:"التقط صورة للشاشة وصف ما تراه"}
];
const DECIDE_ERROR:Record<string,string>={changed:"تغيّر الطلب على الكمبيوتر بعد عرضه. راجعه من جديد.",not_pending:"لم يعد هذا الطلب قائماً (انتهى وقته أو أُجيب عنه).",not_found:"لم يعد هذا الطلب قائماً."};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const message=(e:unknown,fallback:string)=>e instanceof Error&&e.message?e.message:fallback;
const agentName=(a?:string)=>a==="codex"?"Codex":"Claude Code";

export default function App(){
 const[tab,setTab]=useState<Tab>("home");
 const[devices,setDevices]=useState<LinkedDevice[]>([]),[selectedId,setSelectedId]=useState<string|null>(null),[live,setLive]=useState(false);
 const[pairName,setPairName]=useState("هاتفي"),[pairLink,setPairLink]=useState(""),[scanning,setScanning]=useState(false);
 const[cameraPermission,requestCameraPermission]=useCameraPermissions();
 const[project,setProject]=useState("default"),[online,setOnline]=useState<"no"|"trying"|"yes">("no");
 const[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false);
 const[ask,setAsk]=useState(""),[answers,setAnswers]=useState<{q:string;a:string}[]>([]);
 const[feed,setFeed]=useState<CompanionFeed|null>(null),[deciding,setDeciding]=useState<string|null>(null);
 const[missions,setMissions]=useState<MissionSummary[]>([]),[jobs,setJobs]=useState<Job[]>([]),[toEnd,setToEnd]=useState(true);
 const[screen,setScreen]=useState(false),[frame,setFrame]=useState<string|null>(null),[biz,setBiz]=useState<any>(null),[ads,setAds]=useState<any>(null);
 const[recording,setRecording]=useState(false),[voiceRequested,setVoiceRequested]=useState(false),[active,setActive]=useState(AppState.currentState==="active");
 const screenTimer=useRef<ReturnType<typeof setInterval>|null>(null),voiceTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const scanned=useRef(false);
 const input=useRef<TextInput|null>(null);

 const device=devices.find(d=>d.id===selectedId)??devices[0];
 const api=useMemo(()=>device?new LayanXApi(device):null,[device?.id]);
 const approvals=feed?.approvals??[];

 const refreshDevices=useCallback(async(select?:string)=>{
  if(!LayanxNative)return;
  const r=await LayanxNative.devices();
  setDevices(r.devices);setSelectedId(select??r.selected);setLive(r.live);
  if(!r.devices.length)setTab("settings");
 },[]);

 useEffect(()=>{(async()=>{
  if(!LayanxNative){setError("هذا الإصدار من التطبيق يعمل على أندرويد فقط.");return;}
  try{
   setProject(await SecureStore.getItemAsync(K.project)||"default");
   // Phones paired with the old (unencrypted) link have to pair again with the QR code.
   if(await SecureStore.getItemAsync(K.legacy)){setNotice("تم تحديث طريقة الربط إلى اتصال مشفّر. اربط الهاتف من جديد بمسح الرمز من صفحة الإعداد على الكمبيوتر.");await SecureStore.deleteItemAsync(K.legacy);}
   await refreshDevices();
  }catch(e){setError(message(e,"تعذر تحميل الأجهزة المربوطة"));}
 })()},[refreshDevices]);

 useEffect(()=>{const sub=AppState.addEventListener("change",s=>setActive(s==="active"));return()=>sub.remove();},[]);

 // Follow the PC's companion feed while the app is open: it answers as soon as something changes.
 useEffect(()=>{
  if(!api||!active)return;
  let stop=false,since:string|undefined;
  setOnline("trying");
  (async()=>{
   while(!stop){
    try{
     const f=await api.feed(since,since?20:0);
     if(stop)break;
     since=f.v;setFeed(f);setOnline("yes");
    }catch(e){
     if(stop)break;
     setOnline("no");since=undefined;
     if(e instanceof LinkError&&e.code==="ERR_DEVICE_REMOVED"){setError("أُلغي ربط هذا الهاتف من الكمبيوتر. اربطه من جديد بمسح الرمز.");break;}
     await sleep(4000);
    }
   }
  })();
  return()=>{stop=true;};
 },[api,active]);

 const load=useCallback(async()=>{
  if(!api)return;
  try{
   const p=project.trim()||"default";
   const[m,jb]=await Promise.all([api.missions(p),api.jobs(p).catch(()=>null)]);
   setMissions((m.missions??[]).slice().sort((x,y)=>Date.parse(y.createdAt??"0")-Date.parse(x.createdAt??"0")).slice(0,12));
   if(jb)setJobs(jb.jobs.slice(0,8));
   const[b,ad]=await Promise.all([api.business().catch(()=>null),api.ads().catch(()=>null)]);setBiz(b?.business??null);setAds(ad?.dashboard??null);
  }catch(e){setError(message(e,"تعذر التحديث"));}
 },[api,project]);
 useEffect(()=>{if(online==="yes")void load();},[feed?.v,online==="yes"]);
 useEffect(()=>()=>{if(screenTimer.current)clearInterval(screenTimer.current);if(voiceTimer.current)clearTimeout(voiceTimer.current);void LayanxNative?.cancelRecording();},[]);

 async function pair(link:string){
  const l=link.trim();
  if(!l.startsWith("layanx://pair?")){setError("هذا ليس رمز ربط LayanX. أنشئ رمزاً من صفحة الإعداد على الكمبيوتر.");return;}
  setError("");setBusy(true);setScanning(false);
  try{
   const d=await pairWithLink(l,pairName.trim()||"هاتف");
   await refreshDevices(d.id);setPairLink("");setNotice("");setTab("home");
   Alert.alert("تم الربط",`الهاتف مربوط الآن مع ${d.computer??d.name}. الاتصال مشفّر من الطرفين.`);
  }catch(e){setError(message(e,"فشل الربط"));}
  finally{setBusy(false);scanned.current=false;}
 }

 async function startScan(){
  setError("");
  if(!cameraPermission?.granted){const r=await requestCameraPermission();if(!r.granted){setError("اسمح باستخدام الكاميرا لمسح رمز الربط، أو الصق رابط الربط يدوياً.");return;}}
  scanned.current=false;setScanning(true);
 }

 // layanx:// links: from the QR code (scanned by any camera app), the tile, the widget and notifications.
 const onLink=useCallback((url:string|null)=>{
  if(!url)return;
  if(url.startsWith("layanx://pair?")){
   setTab("settings");
   Alert.alert("ربط كمبيوتر","هل تريد ربط هذا الهاتف بالكمبيوتر الذي أنشأ هذا الرمز؟",[{text:"إلغاء",style:"cancel"},{text:"ربط",onPress:()=>void pair(url)}]);
  }else if(url.startsWith("layanx://ask")){setTab("home");if(/voice=1/.test(url))setVoiceRequested(true);else setTimeout(()=>input.current?.focus(),100);}
  else if(url.startsWith("layanx://approvals")||url.startsWith("layanx://jobs"))setTab("missions");
  else if(url.startsWith("layanx://settings"))setTab("settings");
  else if(url.startsWith("layanx://home"))setTab("home");
 },[pairName]);
 useEffect(()=>{void Linking.getInitialURL().then(onLink);const sub=Linking.addEventListener("url",e=>onLink(e.url));return()=>sub.remove();},[onLink]);

 async function send(asTask:boolean,text?:string){
  const q=(text??ask).trim();if(!q||!api)return;
  setAsk("");setBusy(true);setError("");
  try{
   const p=project.trim()||"default";
   if(asTask&&toEnd&&!text){const r=await api.createJob(q,p);setAnswers(a=>[...a,{q,a:"بدأت مهمة مستقلة: يخطط وينفّذ ويختبر حتى النهاية. تابعها في «المهام» أو في الإشعار المباشر."}]);setJobs(j=>[r.job,...j]);}
   else if(asTask){const r=await api.run(q,p);setAnswers(a=>[...a,{q,a:r.paused?"توقفت بانتظار موافقتك.":r.completed?"اكتملت المهمة وتم التحقق منها.":"لم تكتمل: "+(r.reason??r.error??"")}]);}
   else{const r=await api.assistant(q,p);setAnswers(a=>[...a,{q,a:r.reply}]);}
   await load();
  }catch(e){setError(message(e,"تعذر الإرسال"));}finally{setBusy(false);}
 }

 /** Approve only after the fingerprint / face / PIN; deny needs nothing (it only stops work). */
 async function decide(a:CompanionApproval,decision:"approve"|"deny"){
  if(!api||!LayanxNative)return;
  if(decision==="approve"){
   const title=a.kind==="agent"?`السماح لـ ${agentName(a.agent)}: ${a.tool}`:`موافقة: ${a.tool}`;
   const outcome=await LayanxNative.authenticate(title,(a.detail||a.title).slice(0,120)).catch(()=>"unavailable" as const);
   if(outcome==="cancelled")return;
   if(outcome==="unavailable"){
    const ok=await new Promise<boolean>(resolve=>Alert.alert(title,`${a.title}\n${a.detail}\n\nهذا الهاتف بلا قفل شاشة، لذلك لا يمكن التحقق بالبصمة. هل توافق؟`,
     [{text:"إلغاء",style:"cancel",onPress:()=>resolve(false)},{text:"موافقة",style:"destructive",onPress:()=>resolve(true)}],{cancelable:true,onDismiss:()=>resolve(false)}));
    if(!ok)return;
   }
  }
  setDeciding(a.id);setError("");
  try{
   const r=await api.decide(a,decision);
   if(!r.ok)setError(DECIDE_ERROR[r.error??""]??("تعذر تنفيذ القرار: "+(r.error??"")));
   else setFeed(f=>f?{...f,approvals:f.approvals.filter(x=>x.id!==a.id)}:f);
  }catch(e){setError(message(e,"تعذر تنفيذ القرار"));}finally{setDeciding(null);}
 }

 async function toggleLive(on:boolean){
  if(!LayanxNative)return;
  try{
   if(on&&Platform.OS==="android"&&Number(Platform.Version)>=33){
    const g=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if(g!==PermissionsAndroid.RESULTS.GRANTED){setError("اسمح بالإشعارات حتى تصلك طلبات الموافقة والتحديثات المباشرة.");return;}
   }
   setLive(await LayanxNative.setLive(on));
  }catch(e){setError(message(e,"تعذر تشغيل التحديثات المباشرة"));}
 }

 async function stopVoice(){
  if(!LayanxNative||!api)return;
  if(voiceTimer.current){clearTimeout(voiceTimer.current);voiceTimer.current=null;}
  setRecording(false);setBusy(true);
  try{
   const clip=await LayanxNative.stopRecording();
   if(!clip||clip.durationMs<500){setError("التسجيل قصير جداً.");return;}
   const text=(await api.transcribe(clip.base64)).trim();
   if(!text){setError("لم أفهم التسجيل. حاول مرة أخرى.");return;}
   setAsk(text);setTab("home");
  }catch(e){setError(message(e,"تعذر تحويل الصوت إلى نص"));}finally{setBusy(false);}
 }
 async function toggleVoice(){
  if(recording){await stopVoice();return;}
  if(!LayanxNative||!api){setError("اربط الهاتف بالكمبيوتر أولاً.");return;}
  setError("");
  if(Platform.OS==="android"){
   const g=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
   if(g!==PermissionsAndroid.RESULTS.GRANTED){setError("اسمح باستخدام الميكروفون لطرح سؤال بالصوت.");return;}
  }
  try{
   await LayanxNative.startRecording();setRecording(true);
   voiceTimer.current=setTimeout(()=>void stopVoice(),60_000);
  }catch(e){setError(message(e,"الميكروفون غير متاح"));}
 }
 useEffect(()=>{if(voiceRequested&&api&&!recording&&!busy){setVoiceRequested(false);void toggleVoice();}},[voiceRequested,api,recording,busy]);

 async function toggleScreen(on:boolean){
  if(!api)return;setScreen(on);
  if(screenTimer.current){clearInterval(screenTimer.current);screenTimer.current=null;}
  try{
   if(on){await api.liveStart();const grab=async()=>{try{const f=await api.liveFrame();if(f.frame?.base64)setFrame(`data:${f.frame.mimeType};base64,${f.frame.base64}`);}catch{}};await grab();screenTimer.current=setInterval(grab,2000);}
   else{await api.liveStop();}
  }catch(e){setError(message(e,"تعذر تشغيل البث"));setScreen(false);}
 }

 function removeDevice(d:LinkedDevice){
  Alert.alert("إلغاء ربط "+d.name,"يُحذف مفتاح هذا الكمبيوتر من الهاتف. احذف الهاتف أيضاً من صفحة الإعداد على الكمبيوتر.",[{text:"إلغاء",style:"cancel"},{text:"إلغاء الربط",style:"destructive",onPress:async()=>{try{await LayanxNative?.removeDevice(d.id);setFeed(null);await refreshDevices();}catch(e){setError(message(e,"تعذر إلغاء الربط"));}}}]);
 }

 const away=!!api&&!!device?.lastUrl&&/ts\.net|^https:/.test(device.lastUrl);
 const muted=(t:string)=><Text style={s.muted}>{t}</Text>;
 const statusChip=(st:string)=>{const[l,c]=STATUS[st]??[st,C.soft];return <Text style={[s.status,{color:c,borderColor:c+"55"}]}>{l}</Text>};
 const pc=feed?.pc;

 const header=<View style={s.header}>
  <View style={s.logo}><Text style={s.logoText}>X</Text></View>
  <View style={{flex:1}}><Text style={s.title}>LayanX AI</Text>
   <View style={s.onlineRow}><View style={[s.dot,{backgroundColor:online==="yes"?C.green:online==="trying"?C.amber:C.rose}]}/><Text style={[s.small,{color:online==="yes"?C.green:C.soft}]}>{online==="yes"?(away?"متصل من خارج المنزل · مشفّر":"متصل · مشفّر"):online==="trying"?"جارٍ الاتصال…":device?"غير متصل":"اربط جهازك"}</Text></View>
  </View>
  {approvals.length>0&&<Pressable onPress={()=>setTab("missions")} style={s.bell}><Text style={s.bellText}>{approvals.length}</Text></Pressable>}
 </View>;

 const approvalCards=approvals.map(a=><View key={a.id} style={[s.card,{borderColor:C.amber+"88"}]}>
  <Text style={s.itemTitle}>{a.kind==="agent"?`${agentName(a.agent)} يطلب الإذن: ${a.tool}`:`بانتظار موافقتك: ${a.tool}`}</Text>
  <Text style={s.a}>{a.title}</Text>
  {!!a.detail&&<Text style={s.code}>{a.detail}</Text>}
  <View style={s.row}>
   <Pressable style={[s.warn,{flex:1},deciding===a.id&&{opacity:.5}]} disabled={deciding===a.id} onPress={()=>void decide(a,"approve")}><Text style={s.warnText}>موافقة بالبصمة</Text></Pressable>
   <Pressable style={[s.ghost,{flex:1,marginTop:0}]} disabled={deciding===a.id} onPress={()=>void decide(a,"deny")}><Text style={[s.bt,{color:C.rose}]}>رفض</Text></Pressable>
  </View>
 </View>);

 const runningJobs=(feed?.jobs??[]).filter(j=>ACTIVE_JOB.includes(j.status));
 const agents=(feed?.agents??[]).filter(a=>a.status!=="ended").slice(0,6);
 const liveCard=(runningJobs.length>0||agents.length>0||pc)&&<View style={s.card}>
  {runningJobs.map(j=><View key={j.id} style={{marginBottom:10}}>
   <View style={s.between}><Text style={[s.itemTitle,{flex:1}]} numberOfLines={1}>{j.goal}</Text><Text style={s.muted}>{JOB[j.status]??j.status}</Text></View>
   {j.milestone&&muted(`المرحلة ${j.milestone.index}/${j.milestone.total}: ${j.milestone.title}`)}
   <View style={s.bar}><View style={[s.barFill,{width:`${Math.round(j.progress*100)}%`}]}/></View>
  </View>)}
  {agents.map(a=>{const[l,c]=AGENT_STATUS[a.status];return <View key={a.id} style={s.task}>
   <View style={[s.taskDot,{backgroundColor:c}]}/>
   <View style={{flex:1}}><Text style={s.taskText} numberOfLines={1}>{agentName(a.agent)} · {a.project}</Text>{muted((a.lastTool?a.lastTool+(a.lastDetail?": "+a.lastDetail:""):a.prompt??"").slice(0,90))}</View>
   <Text style={[s.status,{color:c,borderColor:c+"55"}]}>{l}</Text>
  </View>;})}
  {pc&&<Text style={[s.muted,{marginTop:6}]}>الكمبيوتر: المعالج {Math.round(pc.cpu)}% · الذاكرة {Math.round(pc.ram)}%{pc.gpu!==undefined?` · GPU ${Math.round(pc.gpu)}%`:""}</Text>}
 </View>;

 const home=<>
  {approvalCards}
  {liveCard}
  <View style={s.mission}>
   <View style={s.between}><Text style={s.missionLabel}>مهمة جديدة</Text>
    <Pressable onPress={()=>void toggleVoice()} disabled={busy&&!recording} style={[s.mic,recording&&{backgroundColor:C.rose}]}><Text style={s.micText}>{recording?"إيقاف ■":"🎙 بالصوت"}</Text></Pressable></View>
   {recording&&<Text style={[s.muted,{color:"#FCA5A5"}]}>يستمع… تكلّم ثم اضغط «إيقاف» (حتى دقيقة).</Text>}
   <TextInput ref={input} style={s.missionInput} multiline placeholder="مثال: نشر منتجات جديدة في المتجر وإنشاء محتوى للسوشيال ميديا" placeholderTextColor="#B9B2FF" value={ask} onChangeText={setAsk}/>
   <View style={[s.between,{marginTop:10}]}><Text style={s.missionLabel}>حتى النهاية دون متابعة</Text><Switch value={toEnd} onValueChange={setToEnd} trackColor={{true:C.purple2,false:C.line}}/></View>
   <Pressable style={s.start} onPress={()=>void send(true)} disabled={busy}><Text style={s.startText}>{busy?"LayanX يعمل…":"بدء المهمة"}</Text></Pressable>
   <Pressable onPress={()=>void send(false)} disabled={busy}><Text style={s.askLink}>سؤال أو تقرير بدلاً من مهمة</Text></Pressable>
  </View>
  <View style={s.apps}>{APPS.map(x=><Pressable key={x.key} style={s.app} onPress={()=>{setAsk(x.goal);input.current?.focus();}}><View style={[s.appIcon,{backgroundColor:x.color}]}><Text style={s.appGlyph}>{x.label.slice(0,1)}</Text></View><Text style={s.appText}>{x.label}</Text></Pressable>)}</View>
  {answers.slice(-3).reverse().map((x,i)=><View key={i} style={s.card}><Text style={s.q}>{x.q}</Text><Text style={s.a}>{x.a}</Text></View>)}
  {!live&&<Pressable style={[s.card,{borderColor:C.purple+"88"}]} onPress={()=>void toggleLive(true)}><Text style={s.itemTitle}>فعّل التحديثات المباشرة</Text>{muted("إشعار بالمهمة الجارية ومراحلها، وطلبات الموافقة بالبصمة من شاشة القفل، حتى والتطبيق مغلق.")}</Pressable>}
  <View style={s.card}>
   <Text style={s.h2}>آخر المهام</Text>
   {missions.length?missions.slice(0,5).map(m=><View key={m.id} style={s.task}><View style={[s.taskDot,{backgroundColor:(STATUS[m.status]??["",C.soft])[1]}]}/><Text style={s.taskText} numberOfLines={1}>{m.goal.split("\n")[0]}</Text>{statusChip(m.status)}</View>):muted("لا توجد مهام بعد.")}
  </View>
 </>;

 const missionsTab=<>
  {approvalCards.length?approvalCards:<View style={s.card}>{muted("لا شيء ينتظر موافقتك.")}</View>}
  {jobs.length>0&&<View style={s.card}><Text style={s.h2}>المهام المستقلة</Text>
   {jobs.map(j=>{const done=j.milestones.filter(m=>m.status==="done").length;return <View key={j.id} style={s.task}><View style={[s.taskDot,{backgroundColor:j.status==="completed"?C.green:j.status==="waiting_approval"?C.amber:["failed","cancelled","budget_exhausted"].includes(j.status)?C.rose:C.blue}]}/>
    <View style={{flex:1}}><Text style={s.taskText} numberOfLines={2}>{j.goal.split("\n")[0]}</Text><Text style={s.muted}>{done}/{j.milestones.length} مراحل · {JOB[j.status]??j.status}</Text></View>
    {ACTIVE_JOB.includes(j.status)&&<Pressable onPress={async()=>{try{await api?.cancelJob(j.id);await load();}catch(e){setError(message(e,"تعذر الإيقاف"));}}}><Text style={[s.status,{color:C.rose,borderColor:C.rose+"55"}]}>إيقاف</Text></Pressable>}</View>;})}
  </View>}
  {(feed?.agents??[]).length>0&&<View style={s.card}><Text style={s.h2}>Claude Code و Codex</Text>
   {(feed?.agents??[]).map(a=>{const[l,c]=AGENT_STATUS[a.status];return <View key={a.id} style={s.task}><View style={[s.taskDot,{backgroundColor:c}]}/><View style={{flex:1}}><Text style={s.taskText}>{agentName(a.agent)} · {a.project}</Text>{muted(`${l} · ${a.edits} تعديلات${a.lastTool?" · "+a.lastTool:""}`)}</View></View>;})}
  </View>}
  <View style={s.card}><Text style={s.h2}>المهام</Text>
   {missions.length?missions.map(m=><View key={m.id} style={s.task}><View style={[s.taskDot,{backgroundColor:(STATUS[m.status]??["",C.soft])[1]}]}/><Text style={s.taskText} numberOfLines={2}>{m.goal.split("\n")[0]}</Text>{statusChip(m.status)}</View>):muted("لا توجد مهام.")}
  </View>
 </>;

 const appsTab=<>
  <View style={s.card}>
   <View style={s.between}><Text style={s.h2}>شاشة الكمبيوتر</Text><Switch value={screen} onValueChange={v=>void toggleScreen(v)} trackColor={{true:C.purple,false:C.line}}/></View>
   {screen&&frame?<Image source={{uri:frame}} style={s.screen} resizeMode="contain"/>:muted("فعّل البث لرؤية الشاشة الآن (كل ثانيتين).")}
  </View>
  <View style={s.card}>
   <Text style={s.h2}>الأعمال والإعلانات</Text>
   <View style={s.grid}>{[["المتاجر",biz?.stores?.length],["المنتجات",biz?.products?.length],["الطلبات",biz?.orders?.length],["المحتوى",biz?.content?.length],["الحملات",biz?.campaigns?.length],["عائد الإعلانات",ads?.roas?.toFixed?.(2)]].map(([l,v])=><View key={String(l)} style={s.tile}><Text style={s.muted}>{String(l)}</Text><Text style={s.tileValue}>{v??"—"}</Text></View>)}</View>
  </View>
  <View style={s.card}><Text style={s.h2}>أوامر سريعة</Text>
   {["شغّل اختبارات المشروع وأخبرني بالنتيجة","أعطني تقرير اليوم","افحص حالة Git للمشروع","التقط صورة للشاشة وصف ما تراه"].map(g=><Pressable key={g} style={s.ghost} onPress={()=>void send(true,g)} disabled={busy}><Text style={s.bt}>{g}</Text></Pressable>)}
  </View>
 </>;

 const settingsTab=<>
  {devices.length>0&&<View style={s.card}><Text style={s.h2}>أجهزة الكمبيوتر المربوطة</Text>
   {devices.map(d=><View key={d.id} style={[s.deviceRow,d.id===device?.id&&{borderColor:C.purple}]}>
    <Pressable style={{flex:1}} onPress={async()=>{await LayanxNative?.select(d.id);setFeed(null);setSelectedId(d.id);}}><Text style={s.bt}>{d.name}</Text>{muted(d.urls.join("، "))}</Pressable>
    <Pressable onPress={()=>removeDevice(d)}><Text style={[s.status,{color:C.rose,borderColor:C.rose+"55"}]}>إلغاء</Text></Pressable>
   </View>)}
  </View>}
  {devices.length>0&&<View style={s.card}>
   <View style={s.between}><Text style={s.h2}>التحديثات المباشرة</Text><Switch value={live} onValueChange={v=>void toggleLive(v)} trackColor={{true:C.purple,false:C.line}}/></View>
   {muted("يتابع الهاتف الكمبيوتر المحدد حتى والتطبيق مغلق: إشعار ثابت بالمهمة الجارية ومرحلتها، وإشعار لكل طلب موافقة (الموافقة بالبصمة، والرفض بضغطة)، وتحديث الودجت. أضف أيضاً زر «اسأل LayanX» من الإعدادات السريعة، وودجت LayanX من الشاشة الرئيسية.")}
  </View>}
  <View style={s.card}>
   <Text style={s.h2}>ربط كمبيوتر</Text>
   {muted("على الكمبيوتر: صفحة الإعداد ← «الهاتف و VS Code» ← «إنشاء رمز ربط». ثم امسح الرمز هنا. الاتصال مشفّر من طرف إلى طرف بمفتاح الكمبيوتر الموجود في الرمز.")}
   <TextInput style={s.input} placeholder="اسم هذا الهاتف" placeholderTextColor={C.soft} value={pairName} onChangeText={setPairName}/>
   {scanning?<View style={s.cameraBox}>
    <CameraView style={s.camera} facing="back" barcodeScannerSettings={{barcodeTypes:["qr"]}}
     onBarcodeScanned={({data})=>{if(scanned.current||!data)return;if(!data.startsWith("layanx://pair?")){setError("هذا الرمز ليس رمز ربط LayanX.");return;}scanned.current=true;void pair(data);}}/>
    <Pressable style={s.ghost} onPress={()=>setScanning(false)}><Text style={s.bt}>إغلاق الكاميرا</Text></Pressable>
   </View>:<Pressable style={s.start} onPress={()=>void startScan()} disabled={busy}><Text style={s.startText}>{busy?"جارٍ الربط…":"ربط بمسح الرمز"}</Text></Pressable>}
   <TextInput style={s.input} placeholder="أو الصق رابط الربط (layanx://pair?…)" placeholderTextColor={C.soft} autoCapitalize="none" autoCorrect={false} value={pairLink} onChangeText={setPairLink}/>
   {!!pairLink.trim()&&<Pressable style={s.ghost} onPress={()=>void pair(pairLink)} disabled={busy}><Text style={s.bt}>ربط بالرابط</Text></Pressable>}
  </View>
  {!!device&&<View style={s.card}>
   <Text style={s.h2}>المشروع</Text>
   <TextInput style={s.input} value={project} onChangeText={setProject} onEndEditing={async()=>{await SecureStore.setItemAsync(K.project,project.trim()||"default");await load();}} autoCapitalize="none"/>
  </View>}
 </>;

 const tabs:Array<[Tab,string]>=[["home","الرئيسية"],["missions","المهام"],["apps","التطبيقات"],["settings","الإعدادات"]];
 return <SafeAreaView style={s.safe}>
  <ScrollView contentContainerStyle={s.container} refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.purple} onRefresh={async()=>{setRefreshing(true);try{if(api){setFeed(await api.feed());setOnline("yes");}await load();}catch(e){setError(message(e,"تعذر التحديث"));}setRefreshing(false);}}/>}>
   {header}
   {!!notice&&<Text style={s.notice}>{notice}</Text>}
   {!!error&&<Pressable onPress={()=>setError("")}><Text style={s.err}>{error}</Text></Pressable>}
   {tab==="home"&&(device?home:settingsTab)}
   {tab==="missions"&&missionsTab}
   {tab==="apps"&&appsTab}
   {tab==="settings"&&settingsTab}
  </ScrollView>
  <View style={s.tabbar}>
   {tabs.slice(0,2).map(([k,l])=><Pressable key={k} style={s.tabBtn} onPress={()=>setTab(k)}><Text style={[s.tabText,tab===k&&s.tabOn]}>{l}</Text>{k==="missions"&&approvals.length>0&&<View style={s.tabBadge}/>}</Pressable>)}
   <Pressable style={s.center} onPress={()=>{setTab("home");setTimeout(()=>input.current?.focus(),50);}} onLongPress={()=>{setTab("home");void toggleVoice();}}><Text style={s.centerText}>X</Text></Pressable>
   {tabs.slice(2).map(([k,l])=><Pressable key={k} style={s.tabBtn} onPress={()=>setTab(k)}><Text style={[s.tabText,tab===k&&s.tabOn]}>{l}</Text></Pressable>)}
  </View>
 </SafeAreaView>;
}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},container:{padding:16,paddingBottom:110},
 header:{flexDirection:"row-reverse",alignItems:"center",gap:12,marginBottom:16},
 logo:{width:42,height:42,borderRadius:12,backgroundColor:C.blue,alignItems:"center",justifyContent:"center"},logoText:{color:"#fff",fontSize:22,fontWeight:"900"},
 title:{color:C.ink,fontSize:22,fontWeight:"800",textAlign:"right"},onlineRow:{flexDirection:"row-reverse",alignItems:"center",gap:6,marginTop:2},dot:{width:8,height:8,borderRadius:4},
 small:{fontSize:13},bell:{backgroundColor:C.rose,borderRadius:14,minWidth:28,height:28,alignItems:"center",justifyContent:"center",paddingHorizontal:6},bellText:{color:"#fff",fontWeight:"800"},
 h2:{color:C.ink,fontSize:17,fontWeight:"700",textAlign:"right",marginBottom:8},
 muted:{color:C.soft,textAlign:"right",lineHeight:20},
 card:{backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:16,padding:14,marginBottom:14},
 mission:{backgroundColor:"#1B1640",borderColor:"#3B2F8F",borderWidth:1,borderRadius:18,padding:16,marginBottom:14},
 missionLabel:{color:C.ink,fontWeight:"800",fontSize:16,textAlign:"right"},
 missionInput:{color:C.ink,fontSize:16,minHeight:64,textAlign:"right",textAlignVertical:"top",marginTop:8},
 mic:{backgroundColor:"#2B2363",borderRadius:10,paddingHorizontal:10,paddingVertical:6},micText:{color:"#fff",fontWeight:"700",fontSize:13},
 start:{backgroundColor:C.purple,borderRadius:12,padding:14,alignItems:"center",marginTop:12},startText:{color:"#fff",fontWeight:"800",fontSize:15},
 askLink:{color:"#B9B2FF",textAlign:"center",marginTop:10},
 apps:{flexDirection:"row-reverse",justifyContent:"space-between",marginBottom:14},
 app:{width:"23%",backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:14,paddingVertical:12,alignItems:"center",gap:6},
 appIcon:{width:40,height:40,borderRadius:11,alignItems:"center",justifyContent:"center"},appGlyph:{color:"#fff",fontWeight:"800",fontSize:16},appText:{color:C.ink,fontSize:12},
 input:{backgroundColor:"#0B1222",borderColor:C.line,borderWidth:1,borderRadius:10,color:C.ink,padding:12,marginTop:10,textAlign:"right"},
 row:{flexDirection:"row-reverse",gap:10,marginTop:10},between:{flexDirection:"row-reverse",justifyContent:"space-between",alignItems:"center",gap:8},
 ghost:{borderColor:C.line,borderWidth:1,borderRadius:10,padding:12,alignItems:"center",marginTop:8},bt:{color:C.ink,fontWeight:"600",textAlign:"center"},
 warn:{backgroundColor:C.amber,borderRadius:10,padding:12,alignItems:"center"},warnText:{color:"#2A1A02",fontWeight:"800"},
 task:{flexDirection:"row-reverse",alignItems:"center",gap:10,paddingVertical:10,borderTopColor:C.line,borderTopWidth:1},
 taskDot:{width:10,height:10,borderRadius:5},taskText:{flex:1,color:C.ink,textAlign:"right"},
 status:{fontSize:12,borderWidth:1,borderRadius:8,paddingHorizontal:8,paddingVertical:2,overflow:"hidden"},
 itemTitle:{color:C.ink,fontWeight:"700",textAlign:"right",marginBottom:4},
 code:{color:"#FDE68A",backgroundColor:"#0B1222",borderRadius:8,padding:8,marginTop:6,fontFamily:Platform.OS==="android"?"monospace":undefined,fontSize:12,textAlign:"left"},
 q:{color:C.purple2,textAlign:"right",fontWeight:"600"},a:{color:C.ink,textAlign:"right",marginTop:4,lineHeight:21},
 bar:{height:6,backgroundColor:C.line,borderRadius:3,marginTop:6,overflow:"hidden"},barFill:{height:6,backgroundColor:C.purple2,borderRadius:3},
 screen:{width:"100%",aspectRatio:16/9,marginTop:10,borderRadius:10,backgroundColor:"#000"},
 cameraBox:{marginTop:12},camera:{width:"100%",aspectRatio:1,borderRadius:12,overflow:"hidden"},
 deviceRow:{flexDirection:"row-reverse",alignItems:"center",gap:10,borderColor:C.line,borderWidth:1,borderRadius:10,padding:12,marginTop:8},
 grid:{flexDirection:"row-reverse",flexWrap:"wrap",gap:8,marginTop:6},tile:{width:"31%",backgroundColor:"#0B1222",borderRadius:10,padding:10},tileValue:{color:C.ink,fontSize:18,fontWeight:"700",textAlign:"right",marginTop:2},
 err:{color:C.rose,textAlign:"right",marginBottom:12},notice:{color:C.amber,textAlign:"right",marginBottom:12,lineHeight:20},
 tabbar:{position:"absolute",left:0,right:0,bottom:0,flexDirection:"row-reverse",alignItems:"center",justifyContent:"space-around",backgroundColor:"#0E1428",borderTopColor:C.line,borderTopWidth:1,paddingBottom:18,paddingTop:8},
 tabBtn:{alignItems:"center",paddingHorizontal:6,paddingVertical:6},tabText:{color:C.soft,fontSize:12},tabOn:{color:C.purple2,fontWeight:"800"},
 tabBadge:{position:"absolute",top:2,right:0,width:8,height:8,borderRadius:4,backgroundColor:C.rose},
 center:{width:56,height:56,borderRadius:28,backgroundColor:C.blue,alignItems:"center",justifyContent:"center",marginTop:-26,borderWidth:4,borderColor:C.bg},centerText:{color:"#fff",fontSize:24,fontWeight:"900"}
});
