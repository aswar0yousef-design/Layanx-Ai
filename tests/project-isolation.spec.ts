import {ProjectIsolation} from "../src/security/project-isolation.js";
import {resolve} from "node:path";
import {ProjectWorkspaceManager} from "../src/core/project-workspace.js";
const isolation=new ProjectIsolation();
isolation.assertSameProject("p1",{projectId:"p1",resourceId:"m1"});
if(isolation.normalize(" Project-A ")!=="Project-A")throw new Error("Project identity was not normalized.");
let invalid=false;try{isolation.normalize("../project");}catch{invalid=true;}
if(!invalid)throw new Error("Invalid project identity was accepted.");
let requestBlocked=false;try{isolation.assertRequestProject("project-a","project-b");}catch{requestBlocked=true;}
if(!requestBlocked)throw new Error("Cross-project tool request was not blocked.");
const root=resolve(process.cwd(),"isolation-root");
const expectedWorkspace=resolve(root,process.platform==="win32"?"project-a":"Project-A");
if(isolation.workspacePath(root,"Project-A")!==expectedWorkspace)throw new Error("Workspace path was not canonicalized.");
let blocked=false;try{isolation.assertSameProject("p1",{projectId:"p2",resourceId:"m2"});}catch{blocked=true;}
if(!blocked)throw new Error("Cross-project access was not blocked.");
const manager=new ProjectWorkspaceManager();
const ws=manager.create({id:"p1",name:"Project One",version:"1",status:"active",updatedAt:new Date().toISOString(),metadata:{}});
manager.attachSkill(ws.project.id,"skill:test");manager.setConfig(ws.project.id,"mode","safe");
if(!ws.skillIds.includes("skill:test")||ws.config.mode!=="safe")throw new Error("Workspace management failed.");
console.log("Project isolation test passed.");
