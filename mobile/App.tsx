import React,{useEffect,useMemo,useState}from"react";
import{Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View}from"react-native";
import*as SecureStore from"expo-secure-store";
import{LayanXApi,MissionEvent}from"./src/api";
const K={url:"layanx.url",token:"layanx.token",project:"layanx.project",mission:"layanx.mission"};
export default function App(){
 const[url,setUrl]=useState(""),[token,setToken]=useState(""),[project,setProject]=useState("default"),[mission,setMission]=useState(""),[events,setEvents]=useState<MissionEvent[]>([]),[session,setSession]=useState<Record<string,unknown>|null>(null),[error,setError]=useState("");
 useEffect(()=>{(async()=>{setUrl(await SecureStore.getItemAsync(K.url)||"");setToken(await SecureStore.getItemAsync(K.token)||"");setProject(await SecureStore.getItemAsync(K.project)||"default");setMission(await SecureStore.getItemAsync(K.mission)||"")})()},[]);
 const api=useMemo(()=>url&&token?new LayanXApi(url,token):null,[url,token]);
 async function save(){await Promise.all([SecureStore.setItemAsync(K.url,url.trim()),SecureStore.setItemAsync(K.token,token.trim()),SecureStore.setItemAsync(K.project,project.trim()),SecureStore.setItemAsync(K.mission,mission.trim())])}
 async function refresh(){if(!api)return;setError("");try{await save();setSession(await api.session(project.trim(),mission.trim()||undefined));if(mission.trim())setEvents((await api.events(project.trim(),mission.trim())).events)}catch(e){setError(e instanceof Error?e.message:"Request failed")}}
 async function cancel(){if(!api||!mission.trim())return;setError("");try{await api.cancel(project.trim(),mission.trim());await refresh()}catch(e){setError(e instanceof Error?e.message:"Cancel failed")}}
 return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}>
  <Text style={s.title}>LayanX Remote</Text><Text style={s.sub}>Secure mission control</Text>
  <TextInput style={s.input} placeholder="API URL" placeholderTextColor="#799083" autoCapitalize="none" value={url} onChangeText={setUrl}/>
  <TextInput style={s.input} placeholder="Bearer token" placeholderTextColor="#799083" secureTextEntry value={token} onChangeText={setToken}/>
  <TextInput style={s.input} placeholder="Project ID" placeholderTextColor="#799083" value={project} onChangeText={setProject}/>
  <TextInput style={s.input} placeholder="Mission ID (optional)" placeholderTextColor="#799083" value={mission} onChangeText={setMission}/>
  <View style={s.row}><Pressable style={s.btn} onPress={refresh}><Text style={s.bt}>Refresh</Text></Pressable><Pressable style={s.danger} onPress={cancel}><Text style={s.bt}>Cancel</Text></Pressable></View>
  {!!error&&<Text style={s.err}>{error}</Text>}
  <Text style={s.section}>Session</Text><View style={s.card}><Text style={s.muted}>{session?JSON.stringify(session,null,2):"No session loaded."}</Text></View>
  <Text style={s.section}>Mission events</Text>{events.slice().reverse().map(e=><View style={s.event} key={e.id}><Text style={s.type}>{e.type}</Text><Text style={s.muted}>{new Date(e.timestamp).toLocaleString()}</Text>{e.message&&<Text style={s.msg}>{e.message}</Text>}</View>)}
 </ScrollView></SafeAreaView>
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:"#07150d"},container:{padding:20,gap:12},title:{color:"#fff",fontSize:30,fontWeight:"800"},sub:{color:"#9fb5a5"},input:{backgroundColor:"#10251a",color:"#fff",borderWidth:1,borderColor:"#254a34",borderRadius:12,padding:14},row:{flexDirection:"row",gap:10},btn:{flex:1,backgroundColor:"#1b5e20",padding:15,borderRadius:12,alignItems:"center"},danger:{flex:1,backgroundColor:"#8b2635",padding:15,borderRadius:12,alignItems:"center"},bt:{color:"#fff",fontWeight:"700"},err:{color:"#ff9d9d"},section:{color:"#d8c27a",fontSize:19,fontWeight:"800",marginTop:10},card:{backgroundColor:"#10251a",borderRadius:12,padding:14},event:{backgroundColor:"#10251a",borderRadius:12,padding:14,gap:5},type:{color:"#d8c27a",fontWeight:"800"},msg:{color:"#fff"},muted:{color:"#9fb5a5",fontSize:12}});
