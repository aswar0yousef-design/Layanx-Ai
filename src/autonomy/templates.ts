import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

/**
 * Starter kits LayanX begins a project from, so a professional result does not depend on a model writing
 * hundreds of lines of design from nothing. Each kit is original code shipped with LayanX (templates/<name>).
 * Copying never overwrites a file that already exists.
 */
export const TEMPLATES_DIR=fileURLToPath(new URL("../../templates/",import.meta.url));
export const KITS:Record<string,{dir:string;about:string;next:string}>={
  dashboard:{dir:"dashboard-kit",
    about:"React 18 + Vite 6 + Tailwind 4 + framer-motion + lucide-react glass dashboard: sidebar, top bar, KPI cards, revenue chart, drag-and-drop pipeline, task board, Arabic/English (RTL).",
    next:"Read KIT.md. Then project.run install, test and build. Fit it to the goal: tokens in src/index.css, words in src/i18n.js (en + ar), data in src/data.js, pages in src/pages and PAGES in src/App.jsx, menu in NAV (src/components/Shell.jsx)."},
};
const SKIP=new Set(["node_modules","dist",".vite"]);

export function copyKit(name:string,target:string):{template:string;written:string[];kept:string[];about:string;next:string}{
  const kit=KITS[name];
  if(!kit)throw new Error(`Unknown template "${name}". Available: ${Object.keys(KITS).join(", ")}.`);
  const source=path.join(TEMPLATES_DIR,kit.dir);
  if(!fs.existsSync(source))throw new Error(`The ${name} template is missing from this LayanX install.`);
  const written:string[]=[],kept:string[]=[];
  const walk=(dir:string,rel:string)=>{
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(SKIP.has(entry.name))continue;
      const from=path.join(dir,entry.name),relPath=rel?`${rel}/${entry.name}`:entry.name,to=path.join(target,...relPath.split("/"));
      if(entry.isDirectory()){walk(from,relPath);continue;}
      if(!entry.isFile())continue;
      if(fs.existsSync(to)){kept.push(relPath);continue;}
      fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);written.push(relPath);
    }
  };
  fs.mkdirSync(target,{recursive:true});
  walk(source,"");
  return{template:name,written,kept,about:kit.about,next:kit.next};
}
