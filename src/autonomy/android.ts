import {spawn,execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Android Studio integration: native Android (Kotlin + Jetpack Compose, Gradle) projects that LayanX
 * builds, tests and installs with the project's own Gradle wrapper, and that open as they are in
 * Android Studio. Everything here is found on the PC (SDK, a JDK Gradle accepts, Android Studio,
 * a Gradle distribution already downloaded); nothing is installed.
 */

/** The Android SDK: ANDROID_HOME, ANDROID_SDK_ROOT, or where Android Studio puts it. */
export function androidSdkDir(env:NodeJS.ProcessEnv=process.env):string|undefined{
  const candidates=[env.ANDROID_HOME,env.ANDROID_SDK_ROOT,
    env.LOCALAPPDATA?path.join(env.LOCALAPPDATA,"Android","Sdk"):undefined,
    path.join(os.homedir(),"AppData","Local","Android","Sdk"),path.join(os.homedir(),"Library","Android","sdk"),path.join(os.homedir(),"Android","Sdk")];
  return candidates.find(c=>c&&fs.existsSync(path.join(c,"platforms")));
}

/** The major Java version of a JDK folder (from its "release" file), or undefined. */
export function jdkMajor(home:string):number|undefined{
  try{
    const m=/JAVA_VERSION="(\d+)(?:\.(\d+))?/.exec(fs.readFileSync(path.join(home,"release"),"utf8"));
    if(!m)return undefined;
    const major=Number(m[1]);return major===1?Number(m[2]):major;
  }catch{return undefined;}
}

const subdirs=(dir:string|undefined)=>{try{return dir?fs.readdirSync(dir).map(d=>path.join(dir,d)):[];}catch{return[];}};

/**
 * A JDK Gradle 8 can run on (17 to 24; 21 first). A newer default Java (25 here) makes Gradle fail
 * before it starts, so JAVA_HOME is used only when it is in range.
 */
export function androidJavaHome(env:NodeJS.ProcessEnv=process.env):string|undefined{
  const pf=[env.ProgramFiles,env["ProgramFiles(x86)"]].filter(Boolean) as string[];
  const candidates=[env.LAYANX_ANDROID_JAVA_HOME,env.JAVA_HOME,
    ...pf.flatMap(p=>["Microsoft","Eclipse Adoptium","Java","Zulu","Amazon Corretto","BellSoft"].flatMap(v=>subdirs(path.join(p,v)))),
    ...subdirs(path.join(os.homedir(),".jdks")),
    ...pf.map(p=>path.join(p,"Android","Android Studio","jbr"))].filter(Boolean) as string[];
  const usable=[...new Set(candidates.map(c=>path.resolve(c)))].map(home=>({home,major:jdkMajor(home)}))
    .filter((j):j is {home:string;major:number}=>j.major!==undefined&&j.major>=17&&j.major<=24);
  usable.sort((a,b)=>Math.abs(a.major-21)-Math.abs(b.major-21)||b.major-a.major);
  return usable[0]?.home;
}

/** Android Studio's launcher. */
export function androidStudioPath(env:NodeJS.ProcessEnv=process.env):string|undefined{
  const exe=process.platform==="win32"?path.join("bin","studio64.exe"):path.join("bin","studio.sh");
  const candidates=[env.LAYANX_ANDROID_STUDIO,
    ...[env.ProgramFiles,env["ProgramFiles(x86)"]].filter(Boolean).map(p=>path.join(p!,"Android","Android Studio",exe)),
    env.LOCALAPPDATA?path.join(env.LOCALAPPDATA,"Programs","Android Studio",exe):undefined,
    "/Applications/Android Studio.app/Contents/MacOS/studio","/opt/android-studio/bin/studio.sh"];
  return candidates.find(c=>c&&fs.existsSync(c));
}

/** The newest Gradle distribution already downloaded by a wrapper (used only to write a new project's wrapper). */
export function localGradle():{version:string;bin:string;home:string}|undefined{
  const dists=path.join(os.homedir(),".gradle","wrapper","dists");
  const found:{version:string;bin:string;home:string}[]=[];
  for(const d of subdirs(dists))for(const hash of subdirs(d))for(const g of subdirs(hash)){
    const m=/gradle-(\d+(?:\.\d+)+)$/.exec(path.basename(g));
    const bin=path.join(g,"bin",process.platform==="win32"?"gradle.bat":"gradle");
    if(m&&fs.existsSync(bin))found.push({version:m[1]!,bin,home:g});
  }
  const num=(v:string)=>v.split(".").map(Number);
  found.sort((a,b)=>{const x=num(a.version),y=num(b.version);for(let i=0;i<3;i++){const d=(y[i]??0)-(x[i]??0);if(d)return d;}return 0;});
  // AGP 8.11 needs Gradle 8.13 or newer, and Gradle 8 runs on the JDKs androidJavaHome finds.
  return found.find(f=>{const [maj,min]=num(f.version);return maj===8&&(min??0)>=13;});
}

/** True for a Gradle Android project (what Android Studio opens). */
export function isAndroidProject(dir:string):boolean{
  const has=(f:string)=>fs.existsSync(path.join(dir,f));
  if(!has("settings.gradle.kts")&&!has("settings.gradle"))return false;
  if(has(path.join("app","src","main","AndroidManifest.xml")))return true;
  for(const f of ["build.gradle.kts","build.gradle",path.join("app","build.gradle.kts"),path.join("app","build.gradle")]){
    try{if(/com\.android\.(application|library)/.test(fs.readFileSync(path.join(dir,f),"utf8")))return true;}catch{}
  }
  return false;
}

/** The app's applicationId from app/build.gradle(.kts), checked so it is safe to pass to adb. */
export function applicationId(dir:string):string|undefined{
  for(const f of [path.join("app","build.gradle.kts"),path.join("app","build.gradle")]){
    try{
      const m=/applicationId\s*=?\s*["']([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+)["']/.exec(fs.readFileSync(path.join(dir,f),"utf8"));
      if(m)return m[1];
    }catch{}
  }
  return undefined;
}

/** Environment for Gradle: a JDK it accepts and the SDK. Also writes local.properties (sdk.dir) when missing. */
export function androidEnv(dir:string,base:NodeJS.ProcessEnv):NodeJS.ProcessEnv{
  const env={...base};
  const java=androidJavaHome();const sdk=androidSdkDir();
  if(java)env.JAVA_HOME=java;
  if(sdk){env.ANDROID_HOME=sdk;env.ANDROID_SDK_ROOT=sdk;}
  const local=path.join(dir,"local.properties");
  if(sdk&&!fs.existsSync(local))try{fs.writeFileSync(local,`sdk.dir=${sdk.replace(/\\/g,"\\\\").replace(/:/g,"\\:")}\n`);}catch{}
  return env;
}

/** What the PC has for Android work, for "detect" and for the agent to read. */
export function androidToolchain(){
  const java=androidJavaHome(),sdk=androidSdkDir(),studio=androidStudioPath(),gradle=localGradle();
  return{androidStudio:studio??null,sdk:sdk??null,javaHome:java??null,javaVersion:java?jdkMajor(java)??null:null,localGradle:gradle?.version??null,avds:listAvds(sdk),
    ready:Boolean(java&&sdk)};
}

export function listAvds(sdk=androidSdkDir()):string[]{
  const emulator=sdk?path.join(sdk,"emulator",process.platform==="win32"?"emulator.exe":"emulator"):undefined;
  if(!emulator||!fs.existsSync(emulator))return[];
  try{return execFileSync(emulator,["-list-avds"],{encoding:"utf8",windowsHide:true,timeout:15_000}).split(/\r?\n/).map(s=>s.trim()).filter(s=>/^[\w.-]+$/.test(s));}catch{return[];}
}

/** Opens the project in Android Studio (a separate window the owner works in; LayanX does not wait for it). */
export function openInAndroidStudio(dir:string):{opened:boolean;studio?:string;reason?:string}{
  const studio=androidStudioPath();
  if(!studio)return{opened:false,reason:"Android Studio was not found. Install it from developer.android.com/studio, or set LAYANX_ANDROID_STUDIO to studio64.exe."};
  const child=spawn(studio,[dir],{detached:true,stdio:"ignore",windowsHide:false,env:androidEnv(dir,process.env)});
  child.on("error",()=>undefined);child.unref();
  return{opened:true,studio};
}

/** Starts an Android emulator (the named AVD, or the first one) and returns at once. */
export function startEmulator(avd?:string):{started:boolean;avd?:string;reason?:string}{
  const sdk=androidSdkDir();const avds=listAvds(sdk);
  const name=avd&&avds.includes(avd)?avd:avds[0];
  if(!sdk||!name)return{started:false,reason:avds.length?"Unknown AVD.":"No Android emulator (AVD) exists. Create one in Android Studio: Tools > Device Manager."};
  const child=spawn(path.join(sdk,"emulator",process.platform==="win32"?"emulator.exe":"emulator"),["-avd",name],{detached:true,stdio:"ignore"});
  child.on("error",()=>undefined);child.unref();
  return{started:true,avd:name};
}

/** adb from the SDK. */
export function adbPath():string|undefined{
  const sdk=androidSdkDir();
  const adb=sdk?path.join(sdk,"platform-tools",process.platform==="win32"?"adb.exe":"adb"):undefined;
  return adb&&fs.existsSync(adb)?adb:undefined;
}

// ---------------------------------------------------------------- the new-project template

const AGP="8.11.0",KOTLIN="2.1.20";

export function safePackageId(value:unknown,fallback:string):string{
  const v=typeof value==="string"?value.trim().toLowerCase():"";
  if(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5}$/.test(v)&&v.length<=100)return v;
  return fallback;
}
export function safeAppName(value:unknown):string{
  const v=typeof value==="string"?value.replace(/[\u0000-\u001f"\\<>&$`]/g,"").trim().slice(0,50):"";
  return v||"My App";
}

/** The files of a new Kotlin + Jetpack Compose app, opened as is by Android Studio. */
export function androidTemplateFiles(appName:string,packageId:string):Record<string,string>{
  const pkgPath=packageId.split(".").join("/");
  const xml=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/'/g,"\\'");
  return{
    "settings.gradle.kts":`pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "${appName.replace(/[^\w .-]/g,"").trim()||"app"}"
include(":app")
`,
    "build.gradle.kts":`plugins {
    id("com.android.application") version "${AGP}" apply false
    id("org.jetbrains.kotlin.android") version "${KOTLIN}" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "${KOTLIN}" apply false
}
`,
    "gradle.properties":`org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`,
    ".gitignore":`*.iml
.gradle/
/local.properties
/.idea/
.DS_Store
/build/
/app/build/
/captures/
.externalNativeBuild/
.cxx/
`,
    "app/build.gradle.kts":`plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "${packageId}"
    compileSdk = 36

    defaultConfig {
        applicationId = "${packageId}"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.02.00")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
}
`,
    "app/proguard-rules.pro":"# Project-specific ProGuard rules.\n",
    "app/src/main/AndroidManifest.xml":`<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.Material.Light.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
    "app/src/main/res/values/strings.xml":`<resources>
    <string name="app_name">${xml(appName)}</string>
</resources>
`,
    [`app/src/main/java/${pkgPath}/MainActivity.kt`]:`package ${packageId}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Home()
                }
            }
        }
    }
}

@Composable
fun Home() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium)
    }
}

@Preview(showBackground = true)
@Composable
fun HomePreview() {
    MaterialTheme { Home() }
}
`,
    [`app/src/test/java/${pkgPath}/ExampleUnitTest.kt`]:`package ${packageId}

import org.junit.Assert.assertEquals
import org.junit.Test

class ExampleUnitTest {
    @Test
    fun addition_isCorrect() {
        assertEquals(4, 2 + 2)
    }
}
`
  };
}

/** Writes the template (never over existing files) and the Gradle wrapper. */
export async function createAndroidProject(dir:string,options:{appName?:unknown;packageId?:unknown;projectId?:string},
  run:(cmd:{command:string;args:string[];label:string},cwd:string,timeoutMs:number,env:NodeJS.ProcessEnv)=>Promise<{exitCode:number|null;stdout:string;stderr:string;timedOut:boolean}>){
  if(isAndroidProject(dir))return{created:false,reason:"The folder already has an Android project.",toolchain:androidToolchain()};
  const appName=safeAppName(options.appName);
  const fallback="com.layanx."+((options.projectId??"app").toLowerCase().replace(/[^a-z0-9]/g,"").replace(/^[0-9]+/,"")||"app");
  const packageId=safePackageId(options.packageId,fallback);
  const files=androidTemplateFiles(appName,packageId);
  const written:string[]=[];
  for(const [rel,content] of Object.entries(files)){
    const target=path.join(dir,...rel.split("/"));
    if(fs.existsSync(target))continue;
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);written.push(rel);
  }
  const env=androidEnv(dir,process.env);
  const gradle=localGradle();
  let wrapper:{ok:boolean;detail:string};
  if(!env.JAVA_HOME||!androidJavaHome())wrapper={ok:false,detail:"No JDK 17-24 was found for Gradle (Android Studio's own JDK or a Microsoft/Adoptium JDK works)."};
  else if(!gradle)wrapper={ok:false,detail:"No Gradle 8.13+ download was found to write the wrapper: open the project in Android Studio once and it adds it."};
  else{
    // Gradle's own launcher jar, started with the JDK found above (no cmd.exe, so no quoting of paths with spaces).
    const cli=fs.readdirSync(path.join(gradle.home,"lib")).find(f=>/^gradle-(gradle-)?cli-main-.*\.jar$/.test(f))??fs.readdirSync(path.join(gradle.home,"lib")).find(f=>/^gradle-launcher-.*\.jar$/.test(f));
    const java=path.join(env.JAVA_HOME,"bin",process.platform==="win32"?"java.exe":"java");
    const cmd={command:java,args:["-Xmx256m","-Dorg.gradle.appname=gradle","-jar",path.join(gradle.home,"lib",cli??"missing.jar"),"wrapper","--gradle-version",gradle.version,"--distribution-type","bin","--offline","--no-daemon","--console=plain"],label:`gradle wrapper ${gradle.version}`};
    // The wrapper task needs only an empty build: write it in an empty folder (offline, no Android plugin
    // to resolve), then copy it in.
    const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-gradlew-"));
    fs.writeFileSync(path.join(scratch,"settings.gradle"),"rootProject.name = 'wrapper'\n");
    const r=await run(cmd,scratch,5*60_000,env);
    for(const rel of ["gradlew","gradlew.bat",path.join("gradle","wrapper","gradle-wrapper.jar"),path.join("gradle","wrapper","gradle-wrapper.properties")]){
      const from=path.join(scratch,rel),to=path.join(dir,rel);
      if(fs.existsSync(from)&&!fs.existsSync(to)){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);written.push(rel.replace(/\\/g,"/"));}
    }
    try{fs.rmSync(scratch,{recursive:true,force:true});}catch{}
    const ok=r.exitCode===0&&fs.existsSync(path.join(dir,process.platform==="win32"?"gradlew.bat":"gradlew"));
    wrapper={ok,detail:ok?`Gradle ${gradle.version} wrapper written`:(r.stderr||r.stdout).slice(-1500)};
  }
  return{created:true,appName,packageId,written,wrapper,toolchain:androidToolchain(),
    next:"Write the app's screens in app/src/main/java/"+packageId.split(".").join("/")+" (Kotlin, Jetpack Compose), then project.run task build (assembleDebug) and test. project.run task studio:open opens it in Android Studio."};
}
