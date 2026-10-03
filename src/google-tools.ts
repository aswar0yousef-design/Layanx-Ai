import type {LayanXCore} from "./core/orchestrator.js";
import {createGoogleWorkspaceAdapter} from "./connectors/google-workspace.js";
export function registerGoogleWorkspaceTools(core:LayanXCore,options:Parameters<typeof createGoogleWorkspaceAdapter>[0]={}):void{
 const adapter=createGoogleWorkspaceAdapter(options);
 const defs=[
  ["google.gmail.search","search Gmail messages","search emails","L1_READ",false],["google.gmail.read","read a Gmail message","read email","L1_READ",false],["google.gmail.send","send an email through Gmail","send email","L4_EXECUTE",true],
  ["google.drive.list","list Google Drive files","list drive","L1_READ",false],["google.drive.folder.create","create a Google Drive folder","create drive folder","L3_MODIFY",false],["google.drive.file.organize","move a Google Drive file into a folder","organize drive file","L3_MODIFY",false],["google.sheets.create","create a Google Sheet","create spreadsheet","L3_MODIFY",false],["google.sheets.append","append rows to a Google Sheet","append sheet rows","L3_MODIFY",false],["google.sheets.read","read values from a Google Sheet","read sheet","L1_READ",false],["google.calendar.upcoming","read upcoming Google Calendar events","calendar upcoming","L1_READ",false],["google.merchant.accounts","list Merchant Center accounts","merchant accounts","L1_READ",false],["google.merchant.products","list Merchant Center products","merchant products","L1_READ",false]
 ] as const;
 for(const [name,description,action,permission,dangerous] of defs){core.tools.register({name,description,permission:permission as any,dangerous,actions:[action],tags:["google","workspace"]});core.toolAdapters.register(name,adapter);}
}