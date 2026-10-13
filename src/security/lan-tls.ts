import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {writeFileAtomic} from "../platform/paths.js";

/**
 * The phone talks to this PC over the home network. Plain HTTP would carry the
 * phone's device token in the clear, so the gateway also speaks TLS on the same
 * port with a certificate made here, once per installation.
 *
 * Nobody signs it: the phone pins it instead. The QR code shown on this PC
 * carries the certificate's SHA-256 fingerprint next to the pairing code, the
 * phone accepts exactly that certificate and nothing else, so a device on the
 * same Wi-Fi cannot sit in the middle even before pairing finishes.
 *
 * Node has no API that writes X.509, and Windows has no openssl, so the
 * certificate is built here with a small DER encoder (ECDSA P-256, SHA-256).
 */
export interface LanCertificate{
  key:string;
  cert:string;
  /** SHA-256 of the certificate (DER), lowercase hex. */
  fingerprint:string;
  /** The same fingerprint, base64url (43 characters): what the QR code carries. */
  pin:string;
  notAfter:Date;
}

const VALID_DAYS=3650;
const RENEW_DAYS=30;

// ---------- DER ----------
function len(n:number):Buffer{
  if(n<0x80)return Buffer.from([n]);
  const bytes:number[]=[];
  for(let v=n;v>0;v=Math.floor(v/256))bytes.unshift(v&0xff);
  return Buffer.from([0x80|bytes.length,...bytes]);
}
const der=(tag:number,...parts:Buffer[])=>{const body=Buffer.concat(parts);return Buffer.concat([Buffer.from([tag]),len(body.length),body]);};
const seq=(...parts:Buffer[])=>der(0x30,...parts);
const set=(...parts:Buffer[])=>der(0x31,...parts);
const octets=(value:Buffer)=>der(0x04,value);
const bits=(value:Buffer,unused=0)=>der(0x03,Buffer.from([unused]),value);
const utf8=(value:string)=>der(0x0c,Buffer.from(value,"utf8"));
const explicit=(n:number,value:Buffer)=>der(0xa0+n,value);
function integer(value:Buffer):Buffer{
  let v=value;
  while(v.length>1&&v[0]===0&&((v[1] as number)&0x80)===0)v=v.subarray(1);
  if(((v[0] as number)&0x80)!==0)v=Buffer.concat([Buffer.from([0]),v]);
  return der(0x02,v);
}
function oid(dotted:string):Buffer{
  const parts=dotted.split(".").map(Number);
  const out:number[]=[40*(parts[0] as number)+(parts[1] as number)];
  for(const part of parts.slice(2)){
    const chunk:number[]=[];
    let v=part;
    do{chunk.unshift(v&0x7f);v=Math.floor(v/128);}while(v>0);
    for(let i=0;i<chunk.length-1;i++)chunk[i]=(chunk[i] as number)|0x80;
    out.push(...chunk);
  }
  return der(0x06,Buffer.from(out));
}
function time(date:Date):Buffer{
  const iso=date.toISOString().replace(/[-:T]/g,"").slice(0,14)+"Z"; // YYYYMMDDHHMMSSZ
  return date.getUTCFullYear()<2050?der(0x17,Buffer.from(iso.slice(2),"ascii")):der(0x18,Buffer.from(iso,"ascii"));
}
function ipBytes(ip:string):Buffer|null{
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)){const parts=ip.split(".").map(Number);return parts.every(p=>p<=255)?Buffer.from(parts):null;}
  return null;
}

const ECDSA_SHA256="1.2.840.10045.4.3.2";

/** Builds a self-signed server certificate. Exported for tests. */
export function buildCertificate(privateKey:crypto.KeyObject,publicKey:crypto.KeyObject,options:{commonName:string;dnsNames:string[];ips:string[];notBefore:Date;notAfter:Date;serial?:Buffer}):Buffer{
  const serial=Buffer.from(options.serial??crypto.randomBytes(16));
  serial[0]=(serial[0] as number)&0x7f;
  const name=seq(set(seq(oid("2.5.4.3"),utf8(options.commonName))));
  const alg=seq(oid(ECDSA_SHA256));
  const altNames=[
    ...options.dnsNames.filter(n=>/^[a-z0-9.-]{1,253}$/i.test(n)).map(n=>der(0x82,Buffer.from(n,"ascii"))),
    ...options.ips.map(ipBytes).filter((b):b is Buffer=>!!b).map(b=>der(0x87,b))
  ];
  const ext=(id:string,critical:boolean,value:Buffer)=>seq(oid(id),...(critical?[der(0x01,Buffer.from([0xff]))]:[]),octets(value));
  const extensions=[
    ext("2.5.29.19",true,seq()),                                  // basicConstraints: not a CA
    ext("2.5.29.15",true,bits(Buffer.from([0x80]),7)),             // keyUsage: digitalSignature
    ext("2.5.29.37",false,seq(oid("1.3.6.1.5.5.7.3.1"))),          // extKeyUsage: serverAuth
    ...(altNames.length?[ext("2.5.29.17",false,seq(...altNames))]:[]) // subjectAltName
  ];
  const tbs=seq(
    explicit(0,integer(Buffer.from([2]))),
    integer(serial),
    alg,
    name,
    seq(time(options.notBefore),time(options.notAfter)),
    name,
    publicKey.export({type:"spki",format:"der"}),
    explicit(3,seq(...extensions))
  );
  const signature=crypto.sign("sha256",tbs,{key:privateKey,dsaEncoding:"der"});
  return seq(tbs,alg,bits(signature));
}

const pem=(label:string,body:Buffer)=>`-----BEGIN ${label}-----\n${body.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;
const pemBody=(text:string)=>Buffer.from(text.replace(/-----[^-]+-----/g,"").replace(/\s+/g,""),"base64");

export function certificateFingerprint(certPem:string):{fingerprint:string;pin:string}{
  const digest=crypto.createHash("sha256").update(pemBody(certPem)).digest();
  return{fingerprint:digest.toString("hex"),pin:digest.toString("base64url")};
}

function load(keyFile:string,certFile:string,now:Date):LanCertificate|null{
  try{
    const key=fs.readFileSync(keyFile,"utf8"),cert=fs.readFileSync(certFile,"utf8");
    const x509=new crypto.X509Certificate(cert);
    const privateKey=crypto.createPrivateKey(key);
    if(!x509.checkPrivateKey(privateKey))return null;
    const notAfter=new Date(x509.validTo);
    if(!(notAfter.getTime()-now.getTime()>RENEW_DAYS*86400_000))return null;
    return{key,cert,notAfter,...certificateFingerprint(cert)};
  }catch{return null;}
}

/**
 * The certificate of this installation: loaded from `dir`, or made once and kept there.
 * A new one (and so a new fingerprint: phones must pair again) is made only when the
 * files are missing, damaged, or about to expire.
 */
export function ensureLanCertificate(dir:string,options:{installId?:string;now?:()=>Date}={}):LanCertificate{
  const now=(options.now??(()=>new Date()))();
  const keyFile=path.join(dir,"lan-key.pem"),certFile=path.join(dir,"lan-cert.pem");
  const existing=load(keyFile,certFile,now);
  if(existing)return existing;
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const {privateKey,publicKey}=crypto.generateKeyPairSync("ec",{namedCurve:"P-256"});
  const host=os.hostname().toLowerCase();
  const body=buildCertificate(privateKey,publicKey,{
    commonName:`LayanX ${options.installId??host}`.slice(0,64),
    dnsNames:["localhost",host,host+".local"],
    ips:["127.0.0.1"],
    notBefore:new Date(now.getTime()-86400_000),
    notAfter:new Date(now.getTime()+VALID_DAYS*86400_000)
  });
  const key=privateKey.export({type:"pkcs8",format:"pem"}).toString();
  const cert=pem("CERTIFICATE",body);
  writeFileAtomic(keyFile,key);
  writeFileAtomic(certFile,cert);
  return{key,cert,notAfter:new Date(new crypto.X509Certificate(cert).validTo),...certificateFingerprint(cert)};
}
