import {ModelRegistry} from "../src/models/registry.js";
import {ModelExecutionRouter,ModelProviderRegistry} from "../src/core/model-execution.js";
import {TaskDecomposer} from "../src/core/task-decomposition.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

function setup(output:string){
 const models=new ModelRegistry();
 models.register({id:"planner",provider:"fake",capabilities:["reasoning"],local:true,enabled:true,priority:1});
 const providers=new ModelProviderRegistry();
 const provider:ModelProviderAdapter={
  name:"fake",
  async health(){return{provider:"fake",available:true,updatedAt:new Date().toISOString()};},
  async generate(model){return{modelId:model.id,provider:model.provider,output};}
 };
 providers.register(provider);
 return new TaskDecomposer(new ModelExecutionRouter(models,providers));
}

const decomposer=setup(JSON.stringify({tasks:[
 {id:"inspect",description:"Inspect the project",capability:"reasoning",permission:"L2_ANALYZE",dependencies:[],successCriteria:["project understood"]},
 {id:"change",description:"Implement the change",capability:"coding",permission:"L3_MODIFY",dependencies:["inspect"],successCriteria:["change implemented"]},
 {id:"verify",description:"Verify the change",capability:"reasoning",permission:"L2_ANALYZE",dependencies:["change"],successCriteria:["verification passes"]}
]}));
const plan=await decomposer.decompose("Improve the project.");
if(plan.tasks.length!==3||plan.tasks[1]?.dependencies[0]!=="inspect")throw new Error("Task decomposition parsing failed.");

const cyclic=setup(JSON.stringify({tasks:[
 {id:"a",description:"A",capability:"reasoning",permission:"L1_READ",dependencies:["b"],successCriteria:["done"]},
 {id:"b",description:"B",capability:"reasoning",permission:"L1_READ",dependencies:["a"],successCriteria:["done"]}
]}));
try{await cyclic.decompose("cycle");throw new Error("Expected dependency cycle rejection.");}
catch(error){if(!(error instanceof Error)||!error.message.includes("cycle"))throw error;}

const unknown=setup(JSON.stringify({tasks:[
 {id:"a",description:"A",capability:"reasoning",permission:"L1_READ",dependencies:["missing"],successCriteria:["done"]}
]}));
try{await unknown.decompose("unknown dependency");throw new Error("Expected unknown dependency rejection.");}
catch(error){if(!(error instanceof Error)||!error.message.includes("unknown dependency"))throw error;}

console.log("Task decomposition validation tests passed.");