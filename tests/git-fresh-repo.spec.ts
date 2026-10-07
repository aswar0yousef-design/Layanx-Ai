// Git helpers must behave in a brand-new project: one commit, no main branch, clean tree.
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {GitCommitGenerator} from "../src/core/git-commit-generator.js";
import {PullRequestGenerator} from "../src/core/pr-generator.js";
import {SecurityReviewAgent} from "../src/core/security-review-agent.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-fresh-git-"));
const git=(...args:string[])=>{const r=spawnSync("git",args,{cwd:dir,encoding:"utf8"});if(r.status!==0)throw new Error("git "+args.join(" ")+": "+r.stderr);return r.stdout;};
try{
  git("init","-q","-b","work");
  git("config","user.email","test@layanx.local");git("config","user.name","LayanX Test");
  await writeFile(join(dir,"index.js"),"console.log('hello');\n");
  git("add",".");git("commit","-qm","first");

  const commits=new GitCommitGenerator(dir);
  let rejected=false;
  try{await commits.commit({missionId:"m",projectId:"p",message:"fixup! sneaky"});}catch{rejected=true;}
  if(!rejected)throw new Error("Fixup message must be rejected even when the tree is clean.");

  const review=await new SecurityReviewAgent(dir).review();
  if(!review.files.includes("index.js"))throw new Error("First commit must be reviewed against the empty tree.");

  const ok={branch:"work",commit:review.commit,files:[],findings:[],approved:true};
  const draft=await new PullRequestGenerator(dir).generate({missionId:"m",projectId:"p",baseBranch:"main",title:"t",goal:"g",codeReview:ok as never,securityReview:ok as never});
  if(draft.ready||!draft.blockers.some(b=>b.includes("was not found")))throw new Error("Missing base branch must become a blocker, not a crash.");
  console.log("Fresh-repo git helpers passed.");
}finally{await rm(dir,{recursive:true,force:true});}
