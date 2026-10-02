import type {AgentContract,AgentProfile} from "./contracts.js";

export class AgentManager {
  private readonly contracts=new Map<string,AgentContract>();

  register(contract:AgentContract):void {
    if(this.contracts.has(contract.agentId)) throw new Error("Agent already registered.");
    this.contracts.set(contract.agentId,contract);
  }

  get(agentId:string):AgentContract {
    const contract=this.contracts.get(agentId);
    if(!contract) throw new Error(`Unknown agent: ${agentId}`);
    return contract;
  }

  list():AgentContract[]{return [...this.contracts.values()];}

  profile(agentId:string):AgentProfile|undefined{return this.get(agentId).profile;}

  findByRole(role:AgentProfile["role"]):AgentContract[]{return this.list().filter(agent=>agent.profile?.role===role);}
}
