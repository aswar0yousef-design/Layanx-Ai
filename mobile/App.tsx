import React,{useEffect,useMemo,useState}from"react";
import{Linking,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View}from"react-native";
import*as SecureStore from"expo-secure-store";
import{LayanXApi,MissionEvent}from"./src/api";
const K={url:"layanx.url",token:"layanx.token",project:"layanx.project",mission:"layanx.mission"};
export default function App(){
 const[url,setUrl]=useState(""),[token,setToken]=useState(""),[project,setProject]=useState("default"),[mission,setMission]=useState(""),[events,setEvents]=useState<MissionEvent[]>([]);
 const[session,setSession]=useState<any>(null),[business,setBusiness]=useState<any>(null),[ads,setAds]=useState<any>(null),[connections,setConnections]=useState<any[]>([]),[error,setError]=useState("");
 useEffect(()=>{(async()=>{setUrl(await SecureStore.getItemAsync(K.url)||"");setToken(await SecureStore.getItemAsync(K.token)||"");setProject(await SecureStore.getItemAsync(K.project)||"default");setMission(await SecureStore.getItemAsync(K.mission)||"")})()},[]);
 const api=useMemo(()=>url&&token?new LayanXApi(url,token):null,[url,token]);
 async function save(){await Promise.all([SecureStore.setItemAsync(K.url,url.trim()),SecureStore.setItemAsync(K.token,token.trim()),SecureStore.setItemAsync(K.project,project.trim()),SecureStore.setItemAsync(K.mission,mission.trim())])}
 async function refresh(){if(!api)return;setError("");try{await save();const[b,a,oc]=await Promise.all([api.business(),api.ads(),api.oauthConnections()]);setBusiness(b.business);setAds(a.dashboard);setConnections(oc.connections??[]);setSession(await api.session(project.trim(),mission.trim()||undefined));if(mission.trim())setEvents((await api.events(project.trim(),mission.trim())).events)}catch(e){setError(e instanceof Error?e.message:"Request failed")}}
 async function connect(provider:string){if(!api)return;setError("");try{const r=await api.oauthConnect(provider,project.trim()||"default");await Linking.openURL(r.authorizationUrl);}catch(e){setError(e instanceof Error?e.message:"Connection failed")}}
 async function cancel(){if(!api||!mission.trim())return;setError("");try{await api.cancel(project.trim(),mission.trim());await refresh()}catch(e){setError(e instanceof Error?e.message:"Cancel failed")}}
 return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}>
  <Text style={s.title}>LayanX AI</Text><Text style={s.sub}>Business + Mission Control</Text>
  <TextInput style={s.input} placeholder="API URL" placeholderTextColor="#799083" autoCapitalize="none" value={url} onChangeText={setUrl}/>
  <TextInput style={s.input} placeholder="Bearer token" placeholderTextColor="#799083" secureTextEntry value={token} onChangeText={setToken}/>
  <View style={s.row}><TextInput style={[s.input,s.half]} placeholder="Project ID" placeholderTextColor="#799083" value={project} onChangeText={setProject}/><TextInput style={[s.input,s.half]} placeholder="Mission ID" placeholderTextColor="#799083" value={mission} onChangeText={setMission}/></View>
  <View style={s.row}><Pressable style={s.btn} onPress={refresh}><Text style={s.bt}>Refresh</Text></Pressable><Pressable style={s.danger} onPress={cancel}><Text style={s.bt}>Cancel Mission</Text></Pressable></View>
  {!!error&&<Text style={s.err}>{error}</Text>}
  <Text style={s.section}>Connections</Text>
  <View style={s.card}>
   {["meta","tiktok","youtube","linkedin","x"].map(provider=>{const current=connections.find(x=>x.provider===provider);return <View style={s.connection} key={provider}><View style={{flex:1}}><Text style={s.big}>{provider}</Text><Text style={s.muted}>{current?current.accountId+" · connected":"Not connected"}</Text></View><Pressable style={s.smallBtn} onPress={()=>connect(provider)}><Text style={s.bt}>{current?"Reconnect":"Connect"}</Text></Pressable></View>})}
  </View>
  <Text style={s.section}>Business Overview</Text>
  <View style={s.grid}>
   <Card label="Stores" value={business?.stores}/><Card label="Products" value={business?.products}/><Card label="Orders" value={business?.orders}/><Card label="Order Value" value={business?.orderValue}/><Card label="Content" value={business?.content}/><Card label="Published" value={business?.publishedContent}/><Card label="Scheduled" value={business?.scheduledContent}/><Card label="Campaigns" value={business?.campaigns}/>
  </View>
  <Text style={s.section}>Paid Ads</Text><View style={s.card}><Text style={s.big}>{ads?.roas?.toFixed?.(2)??"0.00"} ROAS</Text><Text style={s.muted}>Spend {ads?.spend??0} · Revenue {ads?.revenue??0} · Conversions {ads?.conversions??0}</Text><Text style={s.muted}>{ads?.activeCampaigns??0} active campaigns</Text></View>
  <Text style={s.section}>Mission Session</Text><View style={s.card}><Text style={s.muted}>{session?JSON.stringify(session,null,2):"No session loaded."}</Text></View>
  <Text style={s.section}>Mission Events</Text>{events.slice().reverse().map(e=><View style={s.event} key={e.id}><Text style={s.type}>{e.type}</Text><Text style={s.muted}>{new Date(e.timestamp).toLocaleString()}</Text>{e.message&&<Text style={s.msg}>{e.message}</Text>}</View>)}
 </ScrollView></SafeAreaView>
}
function Card({label,value}:{label:string;value:any}){return <View style={s.small}><Text style={s.muted}>{label}</Text><Text style={s.big}>{value??"—"}</Text></View>}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:"#07150d"},container:{padding:20,gap:12},title:{color:"#fff",fontSize:30,fontWeight:"800"},sub:{color:"#9fb5a5"},input:{flex:1,backgroundColor:"#10251a",color:"#fff",borderWidth:1,borderColor:"#254a34",borderRadius:12,padding:14},half:{minWidth:0},row:{flexDirection:"row",gap:10},btn:{flex:1,backgroundColor:"#1b5e20",padding:15,borderRadius:12,alignItems:"center"},danger:{flex:1,backgroundColor:"#8b2635",padding:15,borderRadius:12,alignItems:"center"},bt:{color:"#fff",fontWeight:"700"},err:{color:"#ff9d9d"},section:{color:"#d8c27a",fontSize:19,fontWeight:"800",marginTop:10},grid:{flexDirection:"row",flexWrap:"wrap",gap:10},small:{width:"47%",backgroundColor:"#10251a",borderRadius:12,padding:14},card:{backgroundColor:"#10251a",borderRadius:12,padding:14,gap:6},event:{backgroundColor:"#10251a",borderRadius:12,padding:14,gap:5},connection:{flexDirection:"row",alignItems:"center",paddingVertical:10,borderBottomWidth:1,borderBottomColor:"#254a34"},smallBtn:{backgroundColor:"#1b5e20",paddingVertical:9,paddingHorizontal:12,borderRadius:10},type:{color:"#d8c27a",fontWeight:"800"},msg:{color:"#fff"},big:{color:"#fff",fontSize:20,fontWeight:"800"},muted:{color:"#9fb5a5",fontSize:12}});
