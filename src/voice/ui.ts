export function voiceUiHtml():string{
return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LayanX Voice</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
body{margin:0;background:#071019;color:#eef5f7;min-height:100vh;display:grid;place-items:center}
.card{width:min(760px,92vw);background:#0d1822;border:1px solid #1d3543;border-radius:24px;padding:28px;box-shadow:0 24px 80px #0008}
h1{margin:0 0 6px;font-size:30px}.muted{color:#91a6b2}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0}
input,button{font:inherit;border-radius:12px;border:1px solid #294553;background:#0a141c;color:#fff;padding:12px}
button{cursor:pointer}.primary{background:#0f6b55;border-color:#16896d}.danger{background:#6b2430}
.mic{width:150px;height:150px;border-radius:50%;display:block;margin:26px auto;font-size:42px}
.listening{box-shadow:0 0 0 12px #0f6b5544,0 0 55px #18a67c88}
.status{text-align:center;min-height:28px;color:#9fe5d2}
.panel{background:#08121a;border:1px solid #1b303c;border-radius:16px;padding:16px;margin-top:14px;white-space:pre-wrap}
audio{width:100%;margin-top:14px}
@media(max-width:600px){.grid{grid-template-columns:1fr}.card{padding:20px}}
</style></head>
<body><main class="card">
<h1>◉ LayanX Voice</h1><div class="muted">واجهة صوتية مباشرة فوق LayanX Runtime</div>
<div class="grid"><input id="project" placeholder="Project ID" value="default"><input id="token" placeholder="API Token" type="password"></div>
<button id="mic" class="mic primary">🎙️</button>
<div id="status" class="status">اضغط وتحدث</div>
<div id="transcript" class="panel">النص المسموع سيظهر هنا.</div>
<div id="result" class="panel">نتيجة المهمة ستظهر هنا.</div>
<audio id="player" controls></audio>
<script>
const mic=document.getElementById('mic'),status=document.getElementById('status'),project=document.getElementById('project'),token=document.getElementById('token'),transcript=document.getElementById('transcript'),resultBox=document.getElementById('result'),player=document.getElementById('player');
let recorder,chunks=[],stream;
function headers(){const t=token.value.trim();return t?{'Authorization':'Bearer '+t}:{}}
async function start(){stream=await navigator.mediaDevices.getUserMedia({audio:true});recorder=new MediaRecorder(stream);chunks=[];recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data);recorder.onstop=finish;recorder.start();mic.classList.add('listening');status.textContent='أستمع... تحدث الآن';}
async function stop(){if(recorder&&recorder.state!=='inactive')recorder.stop();mic.classList.remove('listening');status.textContent='أحوّل الصوت إلى نص...';}
async function finish(){stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});try{
 const h={...headers(),'content-type':blob.type||'audio/webm','x-layanx-filename':'voice.webm','x-layanx-language':'ar'};
 let r=await fetch('/v1/voice/transcribe',{method:'POST',headers:h,body:blob});if(!r.ok)throw new Error(await r.text());const tr=await r.json();transcript.textContent=tr.text;status.textContent='أنفّذ المهمة...';
 r=await fetch('/v1/agent/gateway',{method:'POST',headers:{...headers(),'content-type':'application/json'},body:JSON.stringify({goal:tr.text,projectId:project.value.trim()||'default',maxSteps:10})});
 const data=await r.json();if(!r.ok&&r.status!==202)throw new Error(data.error||JSON.stringify(data));resultBox.textContent=JSON.stringify(data,null,2);
 status.textContent=data.paused?'المهمة متوقفة بانتظار الموافقة.':'أجهز الرد الصوتي...';
 const reply=data.paused?'المهمة متوقفة وتحتاج إلى موافقتك.':data.completed?'تم تنفيذ المهمة بنجاح.':'انتهى التنفيذ ولم تكتمل المهمة. راجع التفاصيل في لوحة LayanX.';
 r=await fetch('/v1/voice/speak',{method:'POST',headers:{...headers(),'content-type':'application/json'},body:JSON.stringify({text:reply})});
 if(!r.ok)throw new Error(await r.text());player.src=URL.createObjectURL(await r.blob());await player.play().catch(()=>{});
 status.textContent='جاهز';}
catch(e){status.textContent='حدث خطأ';resultBox.textContent=String(e)}}
mic.onclick=()=>recorder&&recorder.state==='recording'?stop():start();
token.value=localStorage.getItem('layanx.voice.token')||'';token.onchange=()=>localStorage.setItem('layanx.voice.token',token.value);
</script></main></body></html>`;
}
