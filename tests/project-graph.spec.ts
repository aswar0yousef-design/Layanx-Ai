import {mkdtemp,writeFile,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ProjectGraph} from "../src/core/project-graph.js";

const root=await mkdtemp(join(tmpdir(),"layanx-graph-"));
await mkdir(join(root,"demo","src"),{recursive:true});
await mkdir(join(root,"demo","tests"),{recursive:true});
await writeFile(join(root,"demo","package.json"),JSON.stringify({dependencies:{pg:"1.0.0"},devDependencies:{tsx:"2.0.0"}}));
await writeFile(join(root,"demo","src","main.ts"),'import {service} from "./service.js";\nconst app={get(){return service}};');
await writeFile(join(root,"demo","src","service.ts"),'export const service="ok";');
await writeFile(join(root,"demo","tests","service.test.ts"),'import {service} from "../src/service.js"; console.log(service);');

const graph=await new ProjectGraph({root}).scan("demo");
if(!graph.nodes.some(node=>node.path==="src/main.ts"&&node.kind==="entry"))throw new Error("Entry point not detected.");
if(!graph.edges.some(edge=>edge.from==="src/main.ts"&&edge.to==="src/service.ts"&&edge.kind==="import"))throw new Error("Import edge not detected.");
if(!graph.tests.includes("tests/service.test.ts"))throw new Error("Test node not detected.");
if(!graph.edges.some(edge=>edge.from==="tests/service.test.ts"&&edge.to==="src/service.ts"&&edge.kind==="test"))throw new Error("Test edge not detected.");
if(graph.dependencies.pg!=="1.0.0")throw new Error("Package dependency graph not detected.");
console.log("Project graph tests passed.");
