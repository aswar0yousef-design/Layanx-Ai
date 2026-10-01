import {LayanXCore} from "./core/orchestrator.js";
const core=new LayanXCore();
console.log(JSON.stringify({system:"LayanX AI",status:"foundation-ready",mission:core.startMission("Bootstrap LayanX AI foundation")},null,2));
