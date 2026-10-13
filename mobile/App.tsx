import React,{useCallback,useEffect,useMemo,useRef,useState}from"react";
import{Alert,Image,Modal,PermissionsAndroid,Platform,Pressable,RefreshControl,SafeAreaView,ScrollView,StyleSheet,Switch,Text,TextInput,View}from"react-native";
import*as SecureStore from"expo-secure-store";
import{CameraView,useCameraPermissions}from"expo-camera";
import{LayanXApi,type Approval,type Feed,type Job,type MissionSummary}from"./src/api";
import{parsePairingLink}from"./src/pairing";
import{LayanXNative,type DecideResult}from"./modules/layanx-native";

/**
 * A device = one paired computer. `urls` holds every address of that computer
 * (home Wi-Fi, Tailscale, tunnel). The app tries them in order and remembers the
 * one that answered, so the same pairing works at home and away.
 */
type Device={name:string;url:string;urls?:string[];token:string;deviceId:string;
 /** SHA-256 of the computer's LAN certificate, from the QR code: the only certificate accepted on IP addresses. */
 pin?:string|null};
type Tab="home"|"missions"|"apps"|"settings";
const K={devices:"layanx.devices",selected:"layanx.selected",project:"layanx.project"};
const C={bg:"#0A0F1E",panel:"#121A2E",panel2:"#18223A",line:"#24304D",ink:"#EEF2FA",soft:"#9AA6C2",purple:"#6D4AFF",purple2:"#8B6CFF",green:"#22C55E",amber:"#F59E0B",rose:"#EF4444",blue:"#3B82F6"};
const STATUS:Record<string,[string,string]>={completed:["مكتملة",C.green],failed:["فشلت",C.rose],running:["قيد التنفيذ",C.blue],planned:["مخططة",C.blue],verifying:["قيد التحقق",C.blue],blocked:["متوقفة",C.amber],cancelled:["أُلغيت",C.soft]};
const APPS:Array<{key:string;label:string;color:string;goal:string}>=[
 {key:"shop",label:"التجارة",color:"#16A34A",goal:"أنشئ 5 منتجات جديدة في المتجر مع أوصاف"},
 {key:"social",label:"التواصل",color:"#DB2777",goal:"اكتب منشوراً لإنستغرام عن أحدث منتج"},
 {key:"ads",label:"الإعلانات",color:"#D97706",goal:"حلّل أداء الحملات الإعلانية واقترح تحسينات"},
 {key:"pc",label:"الكمبيوتر",color:"#2563EB",goal:"التقط صورة للشاشة وصف ما تراه"}
];

export default function App(){
 const[tab,setTab]=useState<Tab>("home");
 const[devices,setDevices]=useState<Device[]>([]),[selected,setSelected]=useState(0);
 const[pairName,setPairName]=useState("هاتفي"),[pairUrl,setPairUrl]=useState(""),[pairCode,setPairCode]=useState("");
 const[project,setProject]=useState("default"),[api,setApi]=useState<LayanXApi|null>(null),[online,setOnline]=useState<"no"|"trying"|"yes">("no");
 const[error,setError]=useState(""),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false);
 const[ask,setAsk]=useState(""),[answers,setAnswers]=useState<{q:string;a:string}[]>([]);
 const[approvals,setApprovals]=useState<Approval[]>([]),[missions,setMissions]=useState<MissionSummary[]>([]);
 const[feed,setFeed]=useState<Feed|null>(null),[scanning,setScanning]=useState(false),[watching,setWatching]=useState(()=>LayanXNative?.isWatching()??false);
 const[camera,askCamera]=useCameraPermissions();
 const scanned=useRef(false);
 const[jobs,setJobs]=useState<Job[]>([]),[toEnd,setToEnd]=useState(true);
 const[live,setLive]=useState(false),[frame,setFrame]=useState<string|null>(null),[biz,setBiz]=useState<any>(null),[ads,setAds]=useState<any>(null);
 const liveTimer=useRef<ReturnType<typeof setInterval>|null>(null);
 const input=useRef<TextInput|null>(null);

 useEffect(()=>{(async()=>{try{
  const raw=await SecureStore.getItemAsync(K.devices);const saved=raw?JSON.parse(raw):[];
  setDevices(Array.isArray(saved)?saved:[]);setSelected(Number(await SecureStore.getItemAsync(K.selected)||"0"));
  setProject(await SecureStore.getItemAsync(K.project)||"default");
  if(!Array.isArray(saved)||!saved.length)setTab("settings");
 }catch{setError("تعذر تحميل الأجهزة المحفوظة")}})()},[]);
 const device=devices[selected];

 async function save(next:Device[],sel:number){setDevices(next);setSelected(sel);await SecureStore.setItemAsync(K.devices,JSON.stringify(next));await SecureStore.setItemAsync(K.selected,String(sel));}

 /** Try every known address of the computer; keep the one that answers first. */
 const connect=useCallback(async(d:Device|undefined=device):Promise<LayanXApi|null>=>{
  if(!d)return null;
  setOnline("trying");setError("");
  const urls=[d.url,...(d.urls??[])].filter((u,i,a)=>u&&a.indexOf(u)===i&&u.startsWith("https://"));
  if(!urls.length){setApi(null);setOnline("no");setError("هذا الربط قديم وغير مشفّر. اربط الهاتف من جديد: «ربط بمسح QR» في الإعدادات.");return null;}
  for(const url of urls){
   const candidate=new LayanXApi(url,d.token,d.pin??null);
   try{
    await candidate.identity(6000);
    let known=d.urls??[];
    try{const who=await candidate.whoami();if(who.addresses?.length)known=who.addresses;}catch{}
    const updated={...d,url,urls:[...new Set([url,...known])].filter(u=>u.startsWith("https://"))};
    const next=devices.map(x=>x.deviceId===d.deviceId?updated:x);
    if(JSON.stringify(next)!==JSON.stringify(devices))await save(next,selected);
    // The background parts (notifications, tile, widget) use the same pairing, token encrypted by Android.
    await LayanXNative?.saveDevice(JSON.stringify({name:updated.name,deviceId:updated.deviceId,urls:updated.urls,pin:updated.pin??"",token:updated.token,projectId:project.trim()||"default"})).catch(()=>undefined);
    setApi(candidate);setOnline("yes");return candidate;
   }catch{}
  }
  setApi(null);setOnline("no");setError("لا يمكن الوصول إلى الكمبيوتر. تأكد أنه يعمل، وأن Tailscale متصل على الهاتف والكمبيوتر إذا كنت خارج المنزل.");return null;
 },[device,devices,selected]);

 const load=useCallback(async(client:LayanXApi|null=api)=>{
  if(!client)return;
  try{
   const p=project.trim()||"default";
   // Approvals of every project, the PC's load and the auto-scalper come from one call.
   const[f,m]=await Promise.all([client.feed(),client.missions(p)]);
   setFeed(f);setApprovals((f.approvals??[]).filter(x=>x.pending??!x.approved));
   setMissions((m.missions??[]).slice().sort((x,y)=>Date.parse(y.createdAt??"0")-Date.parse(x.createdAt??"0")).slice(0,12));
   const jb=await client.jobs(p).catch(()=>null);if(jb)setJobs(jb.jobs.slice(0,8));
   const[b,ad]=await Promise.all([client.business().catch(()=>null),client.ads().catch(()=>null)]);setBiz(b?.business??null);setAds(ad?.dashboard??null);
  }catch(e){setError(e instanceof Error?e.message:"تعذر التحديث")}
 },[api,project]);

 useEffect(()=>{if(device)void connect(device).then(c=>load(c));},[device?.deviceId]);
 useEffect(()=>{if(online!=="yes")return;const id=setInterval(()=>void load(),8000);return()=>clearInterval(id);},[online,load]);
 useEffect(()=>()=>{if(liveTimer.current)clearInterval(liveTimer.current)},[]);

 /** Pair with one of the computer's addresses; `pin` (from the QR code) is the certificate it must present. */
 async function pairWith(urls:string[],code:string,pin:string|null){
  setError("");setBusy(true);
  try{
   let lastError="فشل الربط";
   for(const raw of urls){
    const url=raw.trim().replace(/\/$/,"");
    try{
     const paired=await LayanXApi.pair(url,code,pairName.trim()||"هاتف",pin);
     const client=new LayanXApi(url,paired.deviceToken,pin);
     const identity=(await client.identity()).device;
     let known:string[]=[url];try{const who=await client.whoami();if(who.addresses?.length)known=[...new Set([url,...who.addresses,...urls])];}catch{}
     const d:Device={name:identity.name||pairName,url,urls:known.filter(u=>u.startsWith("https://")),token:paired.deviceToken,deviceId:identity.deviceId,pin};
     const i=devices.findIndex(x=>x.deviceId===d.deviceId);const next=[...devices];if(i>=0)next[i]=d;else next.push(d);
     await save(next,i>=0?i:next.length-1);setPairCode("");setPairUrl("");setTab("home");
     return;
    }catch(e){lastError=e instanceof Error?e.message:lastError;if(/code|رمز|429|410/i.test(lastError))break;}
   }
   setError(lastError);
  }finally{setBusy(false)}
 }
 async function pair(){
  if(!pairUrl.trim()||!pairCode.trim()){setError("أدخل عنوان الكمبيوتر ورمز الربط");return}
  // Typed addresses: only names with real certificates (Tailscale *.ts.net, a tunnel). At home use the QR code.
  await pairWith([pairUrl.trim()],pairCode.trim(),null);
 }
 async function startScan(){
  setError("");scanned.current=false;
  if(!camera?.granted){const r=await askCamera();if(!r.granted){setError("اسمح باستخدام الكاميرا لمسح رمز الربط.");return}}
  setScanning(true);
 }
 function onScanned(data:string){
  if(scanned.current)return;
  const link=parsePairingLink(data);
  if(!link){setError("هذا ليس رمز ربط LayanX.");return}
  scanned.current=true;setScanning(false);
  void pairWith(link.urls,link.code,link.pin);
 }
 async function toggleWatch(on:boolean){
  if(!LayanXNative)return;
  if(on&&Platform.OS==="android"&&Number(Platform.Version)>=33){
   const r=await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS" as any);
   if(r!==PermissionsAndroid.RESULTS.GRANTED){setError("اسمح بالإشعارات حتى تصلك الموافقات وحالة المهمة.");return}
  }
  if(on&&LayanXNative.authStatus()!==0)Alert.alert("البصمة","فعّل البصمة أو قفل الشاشة في الهاتف: كل موافقة تحتاجها.");
  setWatching(await LayanXNative.setWatching(on));
 }

 async function send(asTask:boolean,text?:string){
  const q=(text??ask).trim();if(!q)return;const client=api??await connect();if(!client)return;
  setAsk("");setBusy(true);
  try{
   if(asTask&&toEnd&&!text){const r=await client.createJob(q,project.trim()||"default");setAnswers(a=>[...a,{q,a:"بدأت مهمة مستقلة: يخطط وينفّذ ويختبر حتى النهاية. تابعها في «المهام»."}]);setJobs(j=>[r.job,...j]);}
   else if(asTask){const r=await client.run(q,project.trim()||"default");setAnswers(a=>[...a,{q,a:r.paused?"توقفت بانتظار موافقتك.":r.completed?"اكتملت المهمة وتم التحقق منها.":"لم تكتمل: "+(r.reason??r.error??"")}]);}
   else{const r=await client.assistant(q,project.trim()||"default");setAnswers(a=>[...a,{q,a:r.reply}]);}
   await load(client);
  }catch(e){setError(e instanceof Error?e.message:"تعذر الإرسال")}finally{setBusy(false)}
 }

 /**
  * Every decision goes through the fingerprint screen (the same one the notification buttons open),
  * carries the request's digest, and the PC continues the work by itself.
  */
 async function decide(a:Approval,action:"approve"|"revoke"){
  if(!api)return;
  const report=(r:DecideResult)=>{
   if(r.cancelled)return;
   setAnswers(x=>[...x,{q:(action==="approve"?"موافقة: ":"رفض: ")+(a.tool??""),a:r.ok?(action==="approve"?(r.continuing==="job"?"تكمل المهمة المستقلة من حيث توقفت.":"يكمل LayanX العمل على الكمبيوتر."):"رُفض الطلب."):r.status===409?"تغيّر الطلب منذ ظهوره؛ راجعه من جديد.":"لم يُنفّذ: "+(r.message??"")}]);
  };
  if(LayanXNative){
   try{report(JSON.parse(await LayanXNative.decide(JSON.stringify(a),action)) as DecideResult);}catch(e){setError(e instanceof Error?e.message:"تعذر تنفيذ القرار")}
   await load();return;
  }
  const go=async()=>{try{const r=await api.decide(a,action);report({ok:true,continuing:(r.continuing??null) as DecideResult["continuing"]});await load();}catch(e){setError(e instanceof Error?e.message:"تعذر تنفيذ القرار")}};
  if(action==="approve")Alert.alert("موافقة على إجراء حساس",(a.tool??"")+"\n"+(a.reason??a.action??""),[{text:"إلغاء",style:"cancel"},{text:"موافقة",style:"destructive",onPress:()=>void go()}]);else void go();
 }

 async function toggleLive(on:boolean){
  if(!api)return;setLive(on);
  if(liveTimer.current){clearInterval(liveTimer.current);liveTimer.current=null}
  try{
   if(on){await api.liveStart();const grab=async()=>{try{const f=await api.liveFrame();if(f.frame?.base64)setFrame(`data:${f.frame.mimeType};base64,${f.frame.base64}`)}catch{}};await grab();liveTimer.current=setInterval(grab,2000);}
   else{await api.liveStop();}
  }catch(e){setError(e instanceof Error?e.message:"تعذر تشغيل البث");setLive(false)}
 }

 const away=useMemo(()=>!!api&&/ts\.net|^https:/.test(api.url),[api]);
 const muted=(t:string)=><Text style={s.muted}>{t}</Text>;
 const statusChip=(st:string)=>{const[l,c]=STATUS[st]??[st,C.soft];return <Text style={[s.status,{color:c,borderColor:c+"55"}]}>{l}</Text>};

 const header=<View style={s.header}>
  <View style={s.logo}><Text style={s.logoText}>X</Text></View>
  <View style={{flex:1}}><Text style={s.title}>LayanX AI</Text>
   <View style={s.onlineRow}><View style={[s.dot,{backgroundColor:online==="yes"?C.green:online==="trying"?C.amber:C.rose}]}/><Text style={[s.small,{color:online==="yes"?C.green:C.soft}]}>{online==="yes"?(away?"متصل من خارج المنزل":"الوكيل متصل"):online==="trying"?"جارٍ الاتصال…":device?"غير متصل":"اربط جهازك"}</Text></View>
  </View>
  {approvals.length>0&&<Pressable onPress={()=>setTab("missions")} style={s.bell}><Text style={s.bellText}>{approvals.length}</Text></Pressable>}
 </View>;

 const approvalCards=approvals.map(a=><View key={a.id} style={[s.card,{borderColor:C.amber+"88"}]}>
  <Text style={s.itemTitle}>بانتظار موافقتك: {a.tool??a.action}</Text>{muted(a.reason??a.action??"")}
  {muted((a.goal?a.goal+" · ":"")+"المشروع: "+(a.projectId??"default"))}
  <View style={s.row}><Pressable style={[s.warn,{flex:1}]} onPress={()=>decide(a,"approve")}><Text style={s.warnText}>موافقة</Text></Pressable><Pressable style={[s.ghost,{flex:1}]} onPress={()=>decide(a,"revoke")}><Text style={[s.bt,{color:C.rose}]}>رفض</Text></Pressable></View>
 </View>);

 const pcLoad=feed?.load,sc=feed?.scalper;
 const pcCard=feed&&<View style={s.card}>
  <View style={s.between}><Text style={s.h2}>حالة الكمبيوتر</Text>{LayanXNative&&<Pressable onPress={()=>void LayanXNative?.ask()}><Text style={[s.status,{color:C.purple2,borderColor:C.purple2+"66"}]}>اسأل بالصوت</Text></Pressable>}</View>
  {pcLoad?<View style={s.grid}>
   <View style={s.tile}><Text style={s.muted}>المعالج</Text><Text style={[s.tileValue,{color:pcLoad.cpu.percent>85?C.rose:pcLoad.cpu.percent>60?C.amber:C.ink}]}>{pcLoad.cpu.percent}%</Text></View>
   <View style={s.tile}><Text style={s.muted}>الذاكرة</Text><Text style={[s.tileValue,{color:pcLoad.memory.percent>85?C.rose:pcLoad.memory.percent>60?C.amber:C.ink}]}>{pcLoad.memory.percent}%</Text></View>
   <View style={s.tile}><Text style={s.muted}>كرت الشاشة</Text><Text style={s.tileValue}>{pcLoad.gpu?pcLoad.gpu.percent+"%":"—"}</Text></View>
  </View>:muted("…")}
  {sc&&muted((sc.running?"السكالبر يعمل":"السكالبر متوقف")+(sc.tradesToday!==undefined?" · صفقات اليوم "+sc.tradesToday:"")+(sc.dailyPnl!==undefined?" · "+(sc.dailyPnl>=0?"+":"")+sc.dailyPnl.toFixed(2):"")+(sc.demo===false?" · حساب حقيقي":""))}
 </View>;

 const home=<>
  {approvalCards}
  {pcCard}
  <View style={s.mission}>
   <Text style={s.missionLabel}>مهمة جديدة</Text>
   <TextInput ref={input} style={s.missionInput} multiline placeholder="مثال: نشر منتجات جديدة في المتجر وإنشاء محتوى للسوشيال ميديا" placeholderTextColor="#B9B2FF" value={ask} onChangeText={setAsk}/>
   <View style={[s.between,{marginTop:10}]}><Text style={s.missionLabel}>حتى النهاية دون متابعة</Text><Switch value={toEnd} onValueChange={setToEnd} trackColor={{true:C.purple2,false:C.line}}/></View>
   <Pressable style={s.start} onPress={()=>send(true)} disabled={busy}><Text style={s.startText}>{busy?"LayanX يعمل…":"بدء المهمة"}</Text></Pressable>
   <Pressable onPress={()=>send(false)} disabled={busy}><Text style={s.askLink}>سؤال أو تقرير بدلاً من مهمة</Text></Pressable>
  </View>
  <View style={s.apps}>{APPS.map(x=><Pressable key={x.key} style={s.app} onPress={()=>{setAsk(x.goal);input.current?.focus();}}><View style={[s.appIcon,{backgroundColor:x.color}]}><Text style={s.appGlyph}>{x.label.slice(0,1)}</Text></View><Text style={s.appText}>{x.label}</Text></Pressable>)}</View>
  {answers.slice(-3).reverse().map((x,i)=><View key={i} style={s.card}><Text style={s.q}>{x.q}</Text><Text style={s.a}>{x.a}</Text></View>)}
  <View style={s.card}>
   <Text style={s.h2}>آخر المهام</Text>
   {missions.length?missions.slice(0,5).map(m=><View key={m.id} style={s.task}><View style={[s.taskDot,{backgroundColor:(STATUS[m.status]??["",C.soft])[1]}]}/><Text style={s.taskText} numberOfLines={1}>{m.goal.split("\n")[0]}</Text>{statusChip(m.status)}</View>):muted("لا توجد مهام بعد.")}
  </View>
 </>;

 const missionsTab=<>
  {approvalCards.length?approvalCards:<View style={s.card}>{muted("لا شيء ينتظر موافقتك.")}</View>}
  {jobs.length>0&&<View style={s.card}><Text style={s.h2}>المهام المستقلة</Text>
   {jobs.map(j=>{const done=j.milestones.filter(m=>m.status==="done").length;return <View key={j.id} style={s.task}><View style={[s.taskDot,{backgroundColor:j.status==="completed"?C.green:j.status==="waiting_approval"?C.amber:["failed","cancelled","budget_exhausted"].includes(j.status)?C.rose:C.blue}]}/>
    <View style={{flex:1}}><Text style={s.taskText} numberOfLines={2}>{j.goal.split("\n")[0]}</Text><Text style={s.muted}>{done}/{j.milestones.length} مراحل · {({queued:"في الانتظار",planning:"يخطط",running:"يعمل",waiting_approval:"ينتظر موافقتك",verifying:"تحقق نهائي",completed:"اكتملت",failed:"توقفت",cancelled:"أُلغيت",budget_exhausted:"انتهى الوقت"} as Record<string,string>)[j.status]??j.status}</Text></View>
    {["queued","planning","running","waiting_approval","verifying"].includes(j.status)&&<Pressable onPress={async()=>{await api?.cancelJob(j.id);await load();}}><Text style={[s.status,{color:C.rose,borderColor:C.rose+"55"}]}>إيقاف</Text></Pressable>}
    {j.status==="completed"&&<Pressable onPress={async()=>{try{const r=await api?.openJobSite(j.id);setAnswers(x=>[...x,{q:"افتح الموقع",a:r?.ok?"فُتح في متصفح الكمبيوتر: "+(r.url??""):r?.needsApproval?"تشغيل الموقع يحتاج موافقتك (ستظهر في الأعلى).":"تعذر فتحه."}]);await load();}catch(e){setError(e instanceof Error?e.message:"تعذر فتح الموقع")}}}><Text style={[s.status,{color:C.green,borderColor:C.green+"55"}]}>افتح الموقع</Text></Pressable>}</View>;})}
  </View>}
  <View style={s.card}><Text style={s.h2}>المهام</Text>
   {missions.length?missions.map(m=><View key={m.id} style={s.task}><View style={[s.taskDot,{backgroundColor:(STATUS[m.status]??["",C.soft])[1]}]}/><Text style={s.taskText} numberOfLines={2}>{m.goal.split("\n")[0]}</Text>{statusChip(m.status)}</View>):muted("لا توجد مهام.")}
  </View>
 </>;

 const appsTab=<>
  <View style={s.card}>
   <View style={s.between}><Text style={s.h2}>شاشة الكمبيوتر</Text><Switch value={live} onValueChange={toggleLive} trackColor={{true:C.purple,false:C.line}}/></View>
   {live&&frame?<Image source={{uri:frame}} style={s.screen} resizeMode="contain"/>:muted("فعّل البث لرؤية الشاشة الآن (كل ثانيتين).")}
  </View>
  <View style={s.card}>
   <Text style={s.h2}>الأعمال والإعلانات</Text>
   <View style={s.grid}>{[["المتاجر",biz?.stores?.length],["المنتجات",biz?.products?.length],["الطلبات",biz?.orders?.length],["المحتوى",biz?.content?.length],["الحملات",biz?.campaigns?.length],["عائد الإعلانات",ads?.roas?.toFixed?.(2)]].map(([l,v])=><View key={String(l)} style={s.tile}><Text style={s.muted}>{String(l)}</Text><Text style={s.tileValue}>{v??"—"}</Text></View>)}</View>
  </View>
  <View style={s.card}><Text style={s.h2}>أوامر سريعة</Text>
   {["شغّل اختبارات المشروع وأخبرني بالنتيجة","أعطني تقرير اليوم","افحص حالة Git للمشروع","التقط صورة للشاشة وصف ما تراه"].map(g=><Pressable key={g} style={s.ghost} onPress={()=>send(true,g)} disabled={busy}><Text style={s.bt}>{g}</Text></Pressable>)}
  </View>
 </>;

 const settingsTab=<>
  {devices.length>1&&<View style={s.card}><Text style={s.h2}>الأجهزة</Text>{devices.map((d,i)=><Pressable key={d.deviceId} style={[s.ghost,i===selected&&{borderColor:C.purple}]} onPress={()=>void save(devices,i)}><Text style={s.bt}>{d.name}</Text></Pressable>)}</View>}
  <View style={s.card}>
   <Text style={s.h2}>ربط الكمبيوتر</Text>
   {muted("على الكمبيوتر: صفحة الإعداد ← الهاتف و VS Code ← إنشاء رمز ربط. ثم امسح رمز QR الظاهر هناك. الاتصال مشفّر، والهاتف لا يقبل إلا شهادة كمبيوترك.")}
   <TextInput style={s.input} placeholder="اسم هذا الهاتف" placeholderTextColor={C.soft} value={pairName} onChangeText={setPairName}/>
   <Pressable style={s.start} onPress={()=>void startScan()} disabled={busy}><Text style={s.startText}>{busy?"جارٍ الربط…":"ربط بمسح QR"}</Text></Pressable>
   {muted("أو من خارج المنزل: عنوان Tailscale (https://…ts.net) والرمز:")}
   <TextInput style={s.input} placeholder="عنوان الكمبيوتر، مثل https://my-pc.tailnet.ts.net" placeholderTextColor={C.soft} autoCapitalize="none" autoCorrect={false} value={pairUrl} onChangeText={setPairUrl}/>
   <TextInput style={s.input} placeholder="رمز الربط مثل ABCD-EFGH" placeholderTextColor={C.soft} autoCapitalize="characters" value={pairCode} onChangeText={setPairCode}/>
   <Pressable style={s.ghost} onPress={pair} disabled={busy}><Text style={s.bt}>ربط بالعنوان والرمز</Text></Pressable>
  </View>
  {!!device&&LayanXNative&&<View style={s.card}>
   <View style={s.between}><Text style={s.h2}>المتابعة في الخلفية</Text><Switch value={watching} onValueChange={v=>void toggleWatch(v)} trackColor={{true:C.purple2,false:C.line}}/></View>
   {muted("إشعار فوري لكل موافقة (موافقة أو رفض بالبصمة من الإشعار نفسه)، وإشعار دائم للمهمة الجارية بمرحلتها وتقدمها، وتحديث الويدجت. يعمل والتطبيق مغلق، عبر شبكتك أو Tailscale فقط، بلا أي خادم سحابي.")}
   {!LayanXNative.ignoringBatteryOptimizations()&&<Pressable style={s.ghost} onPress={()=>void LayanXNative?.openBatterySettings()}><Text style={s.bt}>السماح بالعمل في الخلفية (توفير البطارية)</Text></Pressable>}
   {muted("أضف بلاطة «اسأل LayanX» من الإعدادات السريعة، وويدجت LayanX من الشاشة الرئيسية.")}
  </View>}
  {!!device&&<View style={s.card}>
   <Text style={s.h2}>المشروع</Text>
   <TextInput style={s.input} value={project} onChangeText={setProject} onEndEditing={async()=>{await SecureStore.setItemAsync(K.project,project.trim()||"default");await load()}} autoCapitalize="none"/>
   {muted("عناوين هذا الكمبيوتر: "+((device.urls??[device.url]).join("، ")))}
  </View>}
 </>;

 const tabs:Array<[Tab,string]>=[["home","الرئيسية"],["missions","المهام"],["apps","التطبيقات"],["settings","الإعدادات"]];
 return <SafeAreaView style={s.safe}>
  <Modal visible={scanning} animationType="slide" onRequestClose={()=>setScanning(false)}>
   <View style={{flex:1,backgroundColor:"#000"}}>
    <CameraView style={{flex:1}} facing="back" barcodeScannerSettings={{barcodeTypes:["qr"]}} onBarcodeScanned={r=>onScanned(r.data)}/>
    <View style={s.scanBar}><Text style={s.scanText}>وجّه الكاميرا إلى رمز QR في صفحة الإعداد على الكمبيوتر</Text>
     <Pressable style={s.ghost} onPress={()=>setScanning(false)}><Text style={s.bt}>إلغاء</Text></Pressable></View>
   </View>
  </Modal>
  <ScrollView contentContainerStyle={s.container} refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.purple} onRefresh={async()=>{setRefreshing(true);const c=api??await connect();await load(c);setRefreshing(false)}}/>}>
   {header}
   {!!error&&<Text style={s.err}>{error}</Text>}
   {tab==="home"&&(device?home:settingsTab)}
   {tab==="missions"&&missionsTab}
   {tab==="apps"&&appsTab}
   {tab==="settings"&&settingsTab}
  </ScrollView>
  <View style={s.tabbar}>
   {tabs.slice(0,2).map(([k,l])=><Pressable key={k} style={s.tabBtn} onPress={()=>setTab(k)}><Text style={[s.tabText,tab===k&&s.tabOn]}>{l}</Text>{k==="missions"&&approvals.length>0&&<View style={s.tabBadge}/>}</Pressable>)}
   <Pressable style={s.center} onPress={()=>{setTab("home");setTimeout(()=>input.current?.focus(),50);}}><Text style={s.centerText}>X</Text></Pressable>
   {tabs.slice(2).map(([k,l])=><Pressable key={k} style={s.tabBtn} onPress={()=>setTab(k)}><Text style={[s.tabText,tab===k&&s.tabOn]}>{l}</Text></Pressable>)}
  </View>
 </SafeAreaView>
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
 start:{backgroundColor:C.purple,borderRadius:12,padding:14,alignItems:"center",marginTop:12},startText:{color:"#fff",fontWeight:"800",fontSize:15},
 askLink:{color:"#B9B2FF",textAlign:"center",marginTop:10},
 apps:{flexDirection:"row-reverse",justifyContent:"space-between",marginBottom:14},
 app:{width:"23%",backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:14,paddingVertical:12,alignItems:"center",gap:6},
 appIcon:{width:40,height:40,borderRadius:11,alignItems:"center",justifyContent:"center"},appGlyph:{color:"#fff",fontWeight:"800",fontSize:16},appText:{color:C.ink,fontSize:12},
 input:{backgroundColor:"#0B1222",borderColor:C.line,borderWidth:1,borderRadius:10,color:C.ink,padding:12,marginTop:10,textAlign:"right"},
 row:{flexDirection:"row-reverse",gap:10,marginTop:10},between:{flexDirection:"row-reverse",justifyContent:"space-between",alignItems:"center"},
 ghost:{borderColor:C.line,borderWidth:1,borderRadius:10,padding:12,alignItems:"center",marginTop:8},bt:{color:C.ink,fontWeight:"600",textAlign:"center"},
 warn:{backgroundColor:C.amber,borderRadius:10,padding:12,alignItems:"center"},warnText:{color:"#2A1A02",fontWeight:"800"},
 task:{flexDirection:"row-reverse",alignItems:"center",gap:10,paddingVertical:10,borderTopColor:C.line,borderTopWidth:1},
 taskDot:{width:10,height:10,borderRadius:5},taskText:{flex:1,color:C.ink,textAlign:"right"},
 status:{fontSize:12,borderWidth:1,borderRadius:8,paddingHorizontal:8,paddingVertical:2,overflow:"hidden"},
 itemTitle:{color:C.ink,fontWeight:"700",textAlign:"right",marginBottom:4},
 q:{color:C.purple2,textAlign:"right",fontWeight:"600"},a:{color:C.ink,textAlign:"right",marginTop:4,lineHeight:21},
 screen:{width:"100%",aspectRatio:16/9,marginTop:10,borderRadius:10,backgroundColor:"#000"},
 grid:{flexDirection:"row-reverse",flexWrap:"wrap",gap:8,marginTop:6},tile:{width:"31%",backgroundColor:"#0B1222",borderRadius:10,padding:10},tileValue:{color:C.ink,fontSize:18,fontWeight:"700",textAlign:"right",marginTop:2},
 err:{color:C.rose,textAlign:"right",marginBottom:12},
 tabbar:{position:"absolute",left:0,right:0,bottom:0,flexDirection:"row-reverse",alignItems:"center",justifyContent:"space-around",backgroundColor:"#0E1428",borderTopColor:C.line,borderTopWidth:1,paddingBottom:18,paddingTop:8},
 tabBtn:{alignItems:"center",paddingHorizontal:6,paddingVertical:6},tabText:{color:C.soft,fontSize:12},tabOn:{color:C.purple2,fontWeight:"800"},
 tabBadge:{position:"absolute",top:2,right:0,width:8,height:8,borderRadius:4,backgroundColor:C.rose},
 scanBar:{position:"absolute",left:0,right:0,bottom:0,padding:20,backgroundColor:"#000000CC"},scanText:{color:"#fff",textAlign:"center",fontSize:15,marginBottom:6},
 center:{width:56,height:56,borderRadius:28,backgroundColor:C.blue,alignItems:"center",justifyContent:"center",marginTop:-26,borderWidth:4,borderColor:C.bg},centerText:{color:"#fff",fontSize:24,fontWeight:"900"}
});
