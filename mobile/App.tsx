import React,{useEffect,useMemo,useState}from"react";
import{Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View}from"react-native";
import*as SecureStore from"expo-secure-store";
import{DeviceIdentity,LayanXApi,MissionEvent}from"./src/api";

type Device={name:string;url:string;token:string;deviceId:string};
const K={devices:"layanx.devices",selected:"layanx.selected",project:"layanx.project",mission:"layanx.mission"};

export default function App(){
 const[devices,setDevices]=useState<Device[]>([]),[selected,setSelected]=useState(0),[deviceName,setDeviceName]=useState("My LayanX"),[deviceUrl,setDeviceUrl]=useState(""),[deviceToken,setDeviceToken]=useState("");
 const[project,setProject]=useState("default"),[mission,setMission]=useState(""),[events,setEvents]=useState<MissionEvent[]>([]);
 const[session,setSession]=useState<any>(null),[business,setBusiness]=useState<any>(null),[ads,setAds]=useState<any>(null),[connections,setConnections]=useState<any[]>([]),[error,setError]=useState(""),[status,setStatus]=useState("Not connected");
 useEffect(()=>{(async()=>{try{
   const raw=await SecureStore.getItemAsync(K.devices);const saved=raw?JSON.parse(raw):[];
   setDevices(Array.isArray(saved)?saved:[]);
   setSelected(Number(await SecureStore.getItemAsync(K.selected)||"0"));
   setProject(await SecureStore.getItemAsync(K.project)||"default");setMission(await SecureStore.getItemAsync(K.mission)||"");
 }catch(e){setError("Could not load saved devices")}})()},[]);
 const device=devices[selected];
 const api=useMemo(()=>device?new LayanXApi(device.url,device.token):null,[device]);
 async function persist(next=devices,nextSelected=selected){await SecureStore.setItemAsync(K.devices,JSON.stringify(next));await SecureStore.setItemAsync(K.selected,String(nextSelected));await SecureStore.setItemAsync(K.project,project.trim());await SecureStore.setItemAsync(K.mission,mission.trim())}
 async function addDevice(){
   setError("");setStatus("Pairing…");
   if(!deviceUrl.trim()||!deviceToken.trim()){setError("Device URL and token are required");return}
   try{
     const candidate=new LayanXApi(deviceUrl.trim().replace(/\/$/,""),deviceToken.trim());
     const identity=(await candidate.identity()).device;
     const d:Device={name:deviceName.trim()||identity.name,url:deviceUrl.trim().replace(/\/$/,""),token:deviceToken.trim(),deviceId:identity.deviceId};
     const index=devices.findIndex(x=>x.deviceId===d.deviceId);const next=[...devices];
     if(index>=0)next[index]=d;else next.push(d);
     const nextSelected=index>=0?index:next.length-1;
     setDevices(next);setSelected(nextSelected);setDeviceName("");setDeviceUrl("");setDeviceToken("");await persist(next,nextSelected);
     setStatus("Paired: "+d.name);
   }catch(e){setStatus("Pairing failed");setError(e instanceof Error?e.message:"Unable to pair device")}
 }
 async function refresh(){
   if(!api){setError("Add a LayanX device first");return}
   setError("");setStatus("Connecting…");
   try{
    await persist();const id=await api.identity();setStatus("🟢 "+id.device.name+" · "+id.device.deviceId);
    const[b,a,oc]=await Promise.all([api.business(),api.ads(),api.oauthConnections()]);
    setBusiness(b.business);setAds(a.dashboard);setConnections(oc.connections??[]);
    setSession(await api.session(project.trim(),mission.trim()||undefined));
    if(mission.trim())setEvents((await api.events(project.trim(),mission.trim())).events);
   }catch(e){setStatus("🔴 Connection failed");setError(e instanceof Error?e.message:"Request failed")}
 }
 async function cancel(){if(!api||!mission.trim())return;try{await api.cancel(project.trim(),mission.trim());await refresh()}catch(e){setError(e instanceof Error?e.message:"Cancel failed")}}
 function select(i:number){setSelected(i);setStatus("Selected: "+devices[i].name);void persist(devices,i)}
 return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}>
  <Text style={s.title}>LayanX Remote</Text><Text style={s.sub}>Control any paired LayanX Agent</Text>
  <Text style={s.section}>Devices</Text>
  {devices.map((d,i)=><Pressable key={d.deviceId} style={[s.card,i===selected&&s.selected]} onPress={()=>select(i)}><Text style={s.big}>{i===selected?"✓ ":""}{d.name}</Text><Text style={s.muted}>{d.deviceId} · {d.url}</Text></Pressable>)}
  <View style={s.card}><Text style={s.big}>Add / Pair Device</Text>
   <TextInput style={s.input} placeholder="Device name" placeholderTextColor="#799083" value={deviceName} onChangeText={setDeviceName}/>
   <TextInput style={s.input} placeholder="API URL (e.g. http://192.168.1.20:3000)" placeholderTextColor="#799083" autoCapitalize="none" value={deviceUrl} onChangeText={setDeviceUrl}/>
   <TextInput style={s.input} placeholder="Bearer token" placeholderTextColor="#799083" secureTextEntry value={deviceToken} onChangeText={setDeviceToken}/>
   <Pressable style={s.btn} onPress={addDevice}><Text style={s.bt}>Pair / Verify Device</Text></Pressable>
  </View>
  {!!device&&<><Text style={s.muted}>{status}</Text>
   <View style={s.row}><TextInput style={[s.input,s.half]} placeholder="Project ID" placeholderTextColor="#799083" value={project} onChangeText={setProject}/><TextInput style={[s.input,s.half]} placeholder="Mission ID" placeholderTextColor="#799083" value={mission} onChangeText={setMission}/></View>
   <View style={s.row}><Pressable style={s.btn} onPress={refresh}><Text style={s.bt}>Refresh / Control</Text></Pressable><Pressable style={s.danger} onPress={cancel}><Text style={s.bt}>Cancel Mission</Text></Pressable></View>
   {!!error&&<Text style={s.err}>{error}</Text>}
   <Text style={s.section}>Connections</Text><View style={s.card}>{connections.map((x:any)=><Text key={x.id??x.accountId} style={s.muted}>{x.provider} · {x.accountId} · connected</Text>)}</View>
   <Text style={s.section}>Business Overview</Text><View style={s.grid}><Card label="Stores" value={business?.stores}/><Card label="Products" value={business?.products}/><Card label="Orders" value={business?.orders}/><Card label="Order Value" value={business?.orderValue}/><Card label="Content" value={business?.content}/><Card label="Published" value={business?.publishedContent}/><Card label="Scheduled" value={business?.scheduledContent}/><Card label="Campaigns" value={business?.campaigns}/></View>
   <Text style={s.section}>Paid Ads</Text><View style={s.card}><Text style={s.big}>{ads?.roas?.toFixed?.(2)??"0.00"} ROAS</Text><Text style={s.muted}>Spend {ads?.spend??0} · Revenue {ads?.revenue??0} · Conversions {ads?.conversions??0}</Text></View>
   <Text style={s.section}>Mission Session</Text><View style={s.card}><Text style={s.muted}>{session?JSON.stringify(session,null,2):"No session loaded."}</Text></View>
   <Text style={s.section}>Mission Events</Text>{events.slice().reverse().map(e=><View style={s.event} key={e.id}><Text style={s.type}>{e.type}</Text><Text style={s.muted}>{new Date(e.timestamp).toLocaleString()}</Text>{e.message&&<Text style={s.msg}>{e.message}</Text>}</View>)}
  </>}
 </ScrollView></SafeAreaView>
}
function Card({label,value}:{label:string;value:any}){return <View style={s.small}><Text style={s.muted}>{label}</Text><Text style={s.big}>{value??"—"}</Text></View>}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:"#07150d"},container:{padding:20,gap:12},title:{color:"#fff",fontSize:30,fontWeight:"800"},sub:{color:"#9fb5a5"},input:{backgroundColor:"#10251a",color:"#fff",borderWidth:1,borderColor:"#254a34",borderRadius:12,padding:14},half:{flex:1,minWidth:0},row:{flexDirection:"row",gap:10},btn:{flex:1,backgroundColor:"#1b5e20",padding:15,borderRadius:12,alignItems:"center"},danger:{flex:1,backgroundColor:"#8b2635",padding:15,borderRadius:12,alignItems:"center"},bt:{color:"#fff",fontWeight:"700"},err:{color:"#ff9d9d"},section:{color:"#d8c27a",fontSize:19,fontWeight:"800",marginTop:10},grid:{flexDirection:"row",flexWrap:"wrap",gap:10},small:{width:"47%",backgroundColor:"#10251a",borderRadius:12,padding:14},card:{backgroundColor:"#10251a",borderRadius:12,padding:14,gap:7},selected:{borderWidth:1,borderColor:"#d8c27a"},event:{backgroundColor:"#10251a",borderRadius:12,padding:14,gap:5},type:{color:"#d8c27a",fontWeight:"800"},msg:{color:"#fff"},big:{color:"#fff",fontSize:17,fontWeight:"800"},muted:{color:"#9fb5a5",fontSize:12}});
