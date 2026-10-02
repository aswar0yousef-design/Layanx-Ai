import {SecurityReviewAgent} from "../src/core/security-review-agent.js";

const agent=new SecurityReviewAgent(process.cwd());
const review=await agent.review("HEAD~1");
if(!review.branch||!review.commit)throw new Error("Security review did not identify Git state.");
if(!Array.isArray(review.findings))throw new Error("Security findings must be an array.");
console.log("Security review agent tests passed.");
