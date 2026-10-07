// Packs vscode-extension/ into an installable .vsix (a zip with a VSIX manifest). No network, no vsce.
//   node scripts/build-vsix.mjs   ->  vscode-extension/layanx-agent.vsix
import {readFileSync,readdirSync,statSync,writeFileSync} from "node:fs";
import {join,relative} from "node:path";
import {crc32,deflateRawSync} from "node:zlib";

const root=new URL("../vscode-extension/",import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1");
const pkg=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
const ignore=new Set([".vscodeignore","layanx-agent.vsix"]);
const files=[];
(function walk(dir){for(const name of readdirSync(dir)){const p=join(dir,name);if(ignore.has(name)||name.endsWith(".vsix"))continue;if(statSync(p).isDirectory())walk(p);else files.push(p);}})(root);

const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const manifest=`<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${esc(pkg.name)}" Version="${esc(pkg.version)}" Publisher="${esc(pkg.publisher)}" />
    <DisplayName>${esc(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${esc(pkg.description)}</Description>
    <Tags>${esc((pkg.keywords||["ai","agent"]).join(","))}</Tags>
    <Categories>${esc((pkg.categories||["Other"]).join(","))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${esc(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
`;
const types=`<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".svg" ContentType="image/svg+xml"/><Default Extension=".png" ContentType="image/png"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>
`;
const entries=[["[Content_Types].xml",Buffer.from(types)],["extension.vsixmanifest",Buffer.from(manifest)],...files.map(f=>["extension/"+relative(root,f).split("\\").join("/"),readFileSync(f)])];

// minimal ZIP writer (deflate)
const local=[],central=[];let offset=0;
for(const [name,data] of entries){
  const nameBuf=Buffer.from(name,"utf8"),comp=deflateRawSync(data),crc=crc32(data)>>>0;
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);h.writeUInt16LE(8,8);h.writeUInt32LE(0,10);
  h.writeUInt32LE(crc,14);h.writeUInt32LE(comp.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(nameBuf.length,26);h.writeUInt16LE(0,28);
  local.push(h,nameBuf,comp);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x0800,8);c.writeUInt16LE(8,10);c.writeUInt32LE(0,12);
  c.writeUInt32LE(crc,16);c.writeUInt32LE(comp.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(nameBuf.length,28);c.writeUInt32LE(offset,42);
  central.push(c,nameBuf);
  offset+=30+nameBuf.length+comp.length;
}
const cd=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
const out=join(root,"layanx-agent.vsix");
writeFileSync(out,Buffer.concat([...local,cd,end]));
console.log("built",out,entries.length,"files");
