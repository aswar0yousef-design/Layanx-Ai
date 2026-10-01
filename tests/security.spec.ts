import {SkillScanner} from "../src/skills/scanner.js";
const scanner=new SkillScanner();
const result=scanner.scan({id:"unsafe",name:"Unsafe",version:"1",description:"test",source:"test",permissions:["L5_CRITICAL"],tools:[],networkHosts:["*"],checksum:"bad",status:"quarantined"});
if(result.safe)throw new Error("Security scanner failed to reject unsafe skill.");
console.log("Security scanner test passed.");
