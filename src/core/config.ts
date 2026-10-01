export interface LayanXConfig{environment:"development"|"staging"|"production";dataDir:string;maxToolCalls:number;maxRuntimeMs:number;defaultPermission:"L1_READ"|"L2_ANALYZE"|"L3_MODIFY"|"L4_EXECUTE"|"L5_CRITICAL";}
export const defaultConfig:LayanXConfig={environment:"development",dataDir:"./data",maxToolCalls:100,maxRuntimeMs:60000,defaultPermission:"L1_READ"};
