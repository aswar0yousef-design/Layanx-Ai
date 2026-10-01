import {ProjectIsolation} from "../src/security/project-isolation.js";
import {ProjectWorkspaceManager} from "../src/core/project-workspace.js";
const isolation=new ProjectIsolation();
isolation.assertSameProject("p1",{projectId:"p1",resourceId:"m1"});
let blocked=false;try{isolation.assertSameProject("p1",{projectId:"p2",resourceId:"m2"});}catch{blocked=true;}
if(!blocked)throw new Error("Cross-project access was not blocked.");
const manager=new ProjectWorkspaceManager();
const ws=manager.create({id:"p1",name:"Project One",version:"1",status:"active",updatedAt:new Date().toISOString(),metadata:{}});
manager.attachSkill(ws.project.id,"skill:test");manager.setConfig(ws.project.id,"mode","safe");
if(!ws.skillIds.includes("skill:test")||ws.config.mode!=="safe")throw new Error("Workspace management failed.");
console.log("Project isolation test passed.");
