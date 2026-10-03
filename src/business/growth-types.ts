export type GrowthExperimentStatus="planned"|"running"|"completed"|"stopped";
export type GrowthStage="attention"|"intent"|"visit"|"cart"|"checkout"|"purchase"|"repeat";
export interface GrowthMetric{experimentId:string;date:string;impressions:number;views:number;completedViews:number;shares:number;saves:number;profileVisits:number;productVisits:number;addToCart:number;checkouts:number;purchases:number;revenue:number;repeatPurchases:number;currency:string;}
export interface GrowthExperiment{id:string;projectId:string;storeId?:string;productId?:string;name:string;hypothesis:string;channel:string;format:string;angle:string;status:GrowthExperimentStatus;createdAt:string;startedAt?:string;endedAt?:string;notes?:string;}
export interface GrowthAction{id:string;experimentId?:string;priority:"high"|"medium"|"low";stage:GrowthStage;action:string;reason:string;status:"open"|"done"|"dismissed";createdAt:string;}
export interface GrowthSnapshot{experiments:GrowthExperiment[];metrics:GrowthMetric[];actions:GrowthAction[];updatedAt:string;version:1;}
