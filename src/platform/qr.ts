import {qrModules} from "../vendor/qrcode.js";

/** A QR code as a self-contained SVG (black on white, 4-module quiet zone), for the setup page. */
export function qrSvg(text:string,scale=6):string{
  const rows=qrModules(text) as boolean[][];
  const n=rows.length,quiet=4,size=(n+quiet*2)*scale;
  let path="";
  rows.forEach((row,r)=>row.forEach((dark,c)=>{if(dark)path+=`M${(c+quiet)*scale} ${(r+quiet)*scale}h${scale}v${scale}h-${scale}z`;}));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
export {qrModules};
