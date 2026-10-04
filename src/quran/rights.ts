export type QuranRightsStatus="approved"|"pending"|"rejected";
export interface QuranRecitationLicense{recitationId:number;reciterName:string;status:QuranRightsStatus;allowedPlatforms:string[];allowsSocialVideo:boolean;proofUrl?:string;creditText:string;notes?:string;}
export class QuranRightsCatalog{
 private readonly licenses=new Map<number,QuranRecitationLicense>();
 register(license:QuranRecitationLicense){if(!license.recitationId||!license.reciterName.trim())throw new Error("quran_license_identity_required");if(license.status==="approved"&&(!license.allowsSocialVideo||!license.proofUrl))throw new Error("quran_approved_license_requires_social_permission_and_proof");this.licenses.set(license.recitationId,structuredClone(license));return structuredClone(license);}
 get(recitationId:number){const x=this.licenses.get(recitationId);return x?structuredClone(x):undefined;}
 assertPublishable(recitationId:number,platforms:string[]){const x=this.get(recitationId);if(!x)throw new Error("quran_recitation_license_missing");if(x.status!=="approved")throw new Error("quran_recitation_license_not_approved");if(!x.allowsSocialVideo)throw new Error("quran_recitation_social_video_not_permitted");for(const p of platforms)if(!x.allowedPlatforms.includes(p))throw new Error("quran_recitation_platform_not_permitted:"+p);if(!x.proofUrl)throw new Error("quran_recitation_license_proof_missing");return x;}
 snapshot(){return [...this.licenses.values()].map(x=>structuredClone(x));}
}
