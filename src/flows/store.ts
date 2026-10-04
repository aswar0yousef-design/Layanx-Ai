import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import type {FlowDefinition,FlowExecution} from "./types.js";

interface State{flows:FlowDefinition[];executions:FlowExecution[];}
export class FlowStore{
 private state:State={flows:[],executions:[]};
 private loaded=false;
 constructor(private readonly path=process.env.LAYANX_FLOW_STORAGE_PATH??".layanx/flows.json"){}
 private async ensure(){if(this.loaded)return;this.loaded=true;try{const raw=await readFile(this.path,"utf8");this.state=JSON.parse(raw) as State;}catch{this.state={flows:[],executions:[]};}}
 private async persist(){await mkdir(dirname(this.path),{recursive:true});await writeFile(this.path,JSON.stringify(this.state,null,2),"utf8");}
 async listFlows(projectId?:string){await this.ensure();return this.state.flows.filter(x=>!projectId||x.projectId===projectId);}
 async getFlow(id:string){await this.ensure();return this.state.flows.find(x=>x.id===id);}
 async saveFlow(flow:FlowDefinition){await this.ensure();const i=this.state.flows.findIndex(x=>x.id===flow.id);if(i>=0)this.state.flows[i]=flow;else this.state.flows.push(flow);await this.persist();return flow;}
 async deleteFlow(id:string){await this.ensure();this.state.flows=this.state.flows.filter(x=>x.id!==id);await this.persist();}
 async listExecutions(projectId?:string){await this.ensure();return this.state.executions.filter(x=>!projectId||x.projectId===projectId).slice(-200);}
 async saveExecution(execution:FlowExecution){await this.ensure();const i=this.state.executions.findIndex(x=>x.id===execution.id);if(i>=0)this.state.executions[i]=execution;else this.state.executions.push(execution);this.state.executions=this.state.executions.slice(-1000);await this.persist();return execution;}
}
