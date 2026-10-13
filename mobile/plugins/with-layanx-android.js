const {withAndroidManifest}=require("expo/config-plugins");

/**
 * The phone talks to the owner's PC at its home-network address (http://192.168.x.x:port) or over
 * Tailscale. Android blocks plain HTTP in release builds unless the app allows it. Everything the app
 * sends over that connection is already encrypted end to end (AES-256-GCM with a key agreed with the PC
 * key pinned from the QR code; see src/security/phone-link.ts), so plain HTTP carries only ciphertext.
 */
module.exports=function withLayanxAndroid(config){
  return withAndroidManifest(config,c=>{
    const app=c.modResults.manifest.application?.[0];
    if(app)app.$["android:usesCleartextTraffic"]="true";
    return c;
  });
};
