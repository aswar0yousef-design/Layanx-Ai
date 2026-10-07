import React,{useCallback,useEffect,useMemo,useRef,useState}from"react";
import{Alert,Image,Pressable,RefreshControl,SafeAreaView,ScrollView,StyleSheet,Switch,Text,TextInput,View}from"react-native";
import*as SecureStore from"expo-secure-store";
import{LayanXApi,type Approval,type Job,type MissionSummary}from"./src/api";

/**
 * A device = one paired computer. `urls` holds every address of that computer
 * (home Wi-Fi, Tailscale, tunnel). The app tries them in order and remembers the
 * one that answered, so the same pairing works at home and away.
 */
type Device={name:string;url:string;urls?:string[];token:string;deviceId:string};
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
  const urls=[d.url,...(d.urls??[])].filter((u,i,a)=>u&&a.indexOf(u)===i);
  for(const url of urls){
   const candidate=new LayanXApi(url,d.token);
   try{
    await candidate.identity(6000);
    let known=d.urls??[];
    try{const who=await candidate.whoami();if(who.addresses?.length)known=who.addresses;}catch{}
    const updated={...d,url,urls:[...new Set([url,...known])]};
    const next=devices.map(x=>x.deviceId===d.deviceId?updated:x);
    if(JSON.stringify(next)!==JSON.stringify(devices))await save(next,selected);
    setApi(candidate);setOnline("yes");return candidate;
   }catch{}
  }
  setApi(null);setOnline("no");setError("لا يمكن الوصول إلى الكمبيوتر. تأكد أنه يعمل، وأن Tailscale متصل على الهاتف والكمبيوتر إذا كنت خارج المنزل.");return null;
 },[device,devices,selected]);

 const load=useCallback(async(client:LayanXApi|null=api)=>{
  if(!client)return;
  try{
   const p=project.trim()||"default";
   const[a,m]=await Promise.all([client.approvals(p),client.missions(p)]);
   setApprovals((a.approvals??[]).filter(x=>(x as any).pending??!x.approved));
   setMissions((m.missions??[]).slice().sort((x,y)=>Date.parse(y.createdAt??"0")-Date.parse(x.createdAt??"0")).slice(0,12));
   const jb=await client.jobs(p).catch(()=>null);if(jb)setJobs(jb.jobs.slice(0,8));
   const[b,ad]=await Promise.all([client.business().catch(()=>null),client.ads().catch(()=>null)]);setBiz(b?.business??null);setAds(ad?.dashboard??null);
  }catch(e){setError(e instanceof Error?e.message:"تعذر التحديث")}
 },[api,project]);

 useEffect(()=>{if(device)void connect(device).then(c=>load(c));},[device?.deviceId]);
 useEffect(()=>{if(online!=="yes")return;const id=setInterval(()=>void load(),8000);return()=>clearInterval(id);},[online,load]);
 useEffect(()=>()=>{if(liveTimer.current)clearInterval(liveTimer.current)},[]);

 async function pair(){
  setError("");if(!pairUrl.trim()||!pairCode.trim()){setError("أدخل عنوان الكمبيوتر ورمز الربط");return}
  setBusy(true);
  try{
   const url=pairUrl.trim().replace(/\/$/,"");
   const paired=await LayanXApi.pair(url,pairCode.trim(),pairName.trim()||"هاتف");
   const client=new LayanXApi(url,paired.deviceToken);
   const identity=(await client.identity()).device;
   let urls:string[]=[url];try{const who=await client.whoami();if(who.addresses?.length)urls=[...new Set([url,...who.addresses])];}catch{}
   const d:Device={name:identity.name||pairName,url,urls,token:paired.deviceToken,deviceId:identity.deviceId};
   const i=devices.findIndex(x=>x.deviceId===d.deviceId);const next=[...devices];if(i>=0)next[i]=d;else next.push(d);
   await save(next,i>=0?i:next.length-1);setPairCode("");setPairUrl("");setTab("home");
  }catch(e){setError(e instanceof Error?e.message:"فشل الربط")}finally{setBusy(false)}
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

 async function decide(a:Approval,action:"approve"|"revoke"){
  if(!api)return;const p=project.trim()||"default";
  const go=async()=>{try{
   await api.decide(a.id,action,p);
   if(action==="approve"){const m=await api.mission(a.missionId,p);const idx=m.mission.tools?.findIndex(t=>t.tool===a.tool&&t.action===a.action)??-1;if(idx>=0){setBusy(true);const r=await api.resume(a.missionId,p,{[idx]:a.id});setAnswers(x=>[...x,{q:"موافقة: "+(a.tool??""),a:r.completed?"اكتملت المهمة بعد موافقتك.":r.paused?"تحتاج موافقة أخرى.":"توقف التنفيذ: "+(r.reason??r.status??"")}]);}}
   await load();
  }catch(e){setError(e instanceof Error?e.message:"تعذر تنفيذ القرار")}finally{setBusy(false)}};
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
  <View style={s.row}><Pressable style={[s.warn,{flex:1}]} onPress={()=>decide(a,"approve")}><Text style={s.warnText}>موافقة</Text></Pressable><Pressable style={[s.ghost,{flex:1}]} onPress={()=>decide(a,"revoke")}><Text style={[s.bt,{color:C.rose}]}>رفض</Text></Pressable></View>
 </View>);

 const home=<>
  {approvalCards}
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
    <View style={{flex:1}}><Text style={s.taskText} numberOfLines={2}>{j.goal.split("\n")[0]}</Text><Text style={s.muted}>{done}/{j.milestones.length} مراحل · {({planning:"يخطط",running:"يعمل",waiting_approval:"ينتظر موافقتك",verifying:"تحقق نهائي",completed:"اكتملت",failed:"توقفت",cancelled:"أُلغيت",budget_exhausted:"انتهى الوقت"} as Record<string,string>)[j.status]??j.status}</Text></View>
    {["planning","running","waiting_approval","verifying"].includes(j.status)&&<Pressable onPress={async()=>{await api?.cancelJob(j.id);await load();}}><Text style={[s.status,{color:C.rose,borderColor:C.rose+"55"}]}>إيقاف</Text></Pressable>}</View>;})}
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
   {muted("على الكمبيوتر: صفحة الإعداد ← الهاتف و VS Code ← إنشاء رمز ربط. ثم أدخل العنوان والرمز الظاهرين هناك.")}
   <TextInput style={s.input} placeholder="اسم هذا الهاتف" placeholderTextColor={C.soft} value={pairName} onChangeText={setPairName}/>
   <TextInput style={s.input} placeholder="عنوان الكمبيوتر، مثل https://my-pc.tailnet.ts.net" placeholderTextColor={C.soft} autoCapitalize="none" autoCorrect={false} value={pairUrl} onChangeText={setPairUrl}/>
   <TextInput style={s.input} placeholder="رمز الربط مثل ABCD-EFGH" placeholderTextColor={C.soft} autoCapitalize="characters" value={pairCode} onChangeText={setPairCode}/>
   <Pressable style={s.start} onPress={pair} disabled={busy}><Text style={s.startText}>{busy?"جارٍ الربط…":"ربط"}</Text></Pressable>
  </View>
  {!!device&&<View style={s.card}>
   <Text style={s.h2}>المشروع</Text>
   <TextInput style={s.input} value={project} onChangeText={setProject} onEndEditing={async()=>{await SecureStore.setItemAsync(K.project,project.trim()||"default");await load()}} autoCapitalize="none"/>
   {muted("عناوين هذا الكمبيوتر: "+((device.urls??[device.url]).join("، ")))}
  </View>}
 </>;

 const tabs:Array<[Tab,string]>=[["home","الرئيسية"],["missions","المهام"],["apps","التطبيقات"],["settings","الإعدادات"]];
 return <SafeAreaView style={s.safe}>
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
 center:{width:56,height:56,borderRadius:28,backgroundColor:C.blue,alignItems:"center",justifyContent:"center",marginTop:-26,borderWidth:4,borderColor:C.bg},centerText:{color:"#fff",fontSize:24,fontWeight:"900"}
});
