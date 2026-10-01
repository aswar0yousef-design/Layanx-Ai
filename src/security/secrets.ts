export interface SecretReference{id:string;name:string;scope:string;expiresAt:string;}
export interface SecretBroker{resolve(reference:SecretReference):Promise<string>;}
export class EphemeralSecretBroker implements SecretBroker{
 constructor(private readonly resolver:(reference:SecretReference)=>Promise<string>){}
 async resolve(reference:SecretReference){if(Date.parse(reference.expiresAt)<=Date.now())throw new Error("Secret reference expired.");return this.resolver(reference);}
}
