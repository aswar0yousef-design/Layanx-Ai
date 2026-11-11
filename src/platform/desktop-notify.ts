import {spawn} from "node:child_process";

/** Windows' own PowerShell identity: toasts need a registered application, and this one exists on every Windows PC. */
export const TOAST_APP_ID="{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
const SHOW=`
[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null
$xml=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$lines=$xml.GetElementsByTagName('text')
[void]$lines.Item(0).AppendChild($xml.CreateTextNode($env:LX_TOAST_TITLE))
[void]$lines.Item(1).AppendChild($xml.CreateTextNode($env:LX_TOAST_BODY))
$toast=[Windows.UI.Notifications.ToastNotification]::new($xml)
$toast.Tag=$env:LX_TOAST_TAG
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:LX_TOAST_APP).Show($toast)
`;
/** Shows a Windows notification. The text travels in environment variables, so no message can become a command. */
export function showDesktopNotification(title:string,body:string,tag="layanx"):Promise<boolean>{
  if(process.platform!=="win32"||process.env.LAYANX_DESKTOP_NOTIFY==="off")return Promise.resolve(false);
  return new Promise(resolve=>{
    const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",SHOW],{windowsHide:true,stdio:"ignore",
      env:{...process.env,LX_TOAST_TITLE:title.slice(0,120),LX_TOAST_BODY:body.slice(0,240),LX_TOAST_TAG:tag.replace(/[^\w-]/g,"").slice(0,16)||"layanx",LX_TOAST_APP:TOAST_APP_ID}});
    child.on("error",()=>resolve(false));
    child.on("close",code=>resolve(code===0));
  });
}

interface NotifiableJob{id:string;goal:string;projectId:string;outcome?:{status?:string}}
/** Wording comes from the job's recorded state: "finished" is only said when the checks passed. */
export function jobNotice(job:NotifiableJob,status:string):{title:string;body:string}|undefined{
  const goal=job.goal.split("\n")[0]!.slice(0,90);
  switch(status){
    case"completed":return job.outcome?.status==="verified"?{title:"اكتمل المشروع ونجحت فحوصه",body:goal}:{title:"انتهى المشروع دون إثبات كامل",body:goal};
    case"failed":return{title:"توقف المشروع قبل اكتماله",body:`${goal}. التفاصيل في ${job.projectId}/.layanx/HANDOFF.md`};
    case"budget_exhausted":return{title:"انتهى الوقت المخصص للمشروع",body:goal};
    case"waiting_approval":return{title:"المشروع ينتظر موافقتك",body:goal};
    default:return undefined;
  }
}
/** Each state is announced once per job: a job that polls while waiting must not raise a notification every time. */
export function jobNotifier(show:(title:string,body:string,tag:string)=>unknown=showDesktopNotification){
  const told=new Map<string,string>();
  return(job:NotifiableJob,status:string)=>{
    if(told.get(job.id)===status)return;
    const notice=jobNotice(job,status);
    if(!notice){if(status==="running")told.delete(job.id);return;}
    told.set(job.id,status);
    void Promise.resolve(show(notice.title,notice.body,job.id.slice(0,8))).catch(()=>undefined);
  };
}
