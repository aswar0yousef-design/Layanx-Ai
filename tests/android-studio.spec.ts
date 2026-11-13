import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const {androidTemplateFiles,applicationId,isAndroidProject,jdkMajor,safeAppName,safePackageId}=await import("../src/autonomy/android.js");
const {commandFor,detectProject,emptyProjectReason}=await import("../src/autonomy/project-runner.js");
const {ANDROID_GOAL}=await import("../src/autonomy/supervisor.js");

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-android-spec-"));
const write=(dir:string,files:Record<string,string>)=>{for(const [rel,c] of Object.entries(files)){const t=path.join(dir,...rel.split("/"));fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,c);}};

// ---------- the template is a real Android Studio project, with safe names ----------
const app=path.join(root,"expenses");
write(app,androidTemplateFiles("Expenses","com.layanx.expenses"));
assert.equal(isAndroidProject(app),true);
assert.equal(applicationId(app),"com.layanx.expenses");
assert.ok(fs.existsSync(path.join(app,"app","src","main","java","com","layanx","expenses","MainActivity.kt")));
assert.ok(fs.existsSync(path.join(app,"app","src","test","java","com","layanx","expenses","ExampleUnitTest.kt")),"unit tests exist for the test task");
assert.match(fs.readFileSync(path.join(app,"app","build.gradle.kts"),"utf8"),/compose = true/);
assert.equal(safePackageId("Com.My.App","x.y"),"com.my.app");
assert.equal(safePackageId("bad id; rm -rf","com.layanx.app"),"com.layanx.app","an unsafe id falls back");
assert.equal(safePackageId("single","com.layanx.app"),"com.layanx.app");
assert.equal(safeAppName('My "App" $(x)'),"My App (x)");
assert.equal(safeAppName(""),"My App");
const arabic=androidTemplateFiles("مصروفاتي & co","com.layanx.m")["app/src/main/res/values/strings.xml"]!;
assert.match(arabic,/مصروفاتي &amp; co/,"the name is XML-escaped");

// ---------- detection and commands ----------
const info=detectProject(app);
assert.equal(info.stack,"android");
for(const t of ["install","test","build","lint","studio:open","emulator:start","device:run"])assert.ok(info.tasks.includes(t),t);
assert.ok(!info.tasks.includes("typecheck"),"no task that Android cannot run");
assert.throws(()=>commandFor(info,"build"),/Gradle wrapper/,"no wrapper: a clear message, not a cryptic failure");
fs.writeFileSync(path.join(app,"gradlew.bat"),"@echo off\r\n");fs.writeFileSync(path.join(app,"gradlew"),"#!/bin/sh\n");
const build=commandFor(info,"build");
assert.match(build.label,/gradlew(\.bat)? assembleDebug/);
assert.match(commandFor(info,"test").label,/testDebugUnitTest/);
assert.match(commandFor(info,"lint").label,/lintDebug/);
assert.match(commandFor(info,"device:run").label,/installDebug/);
assert.throws(()=>commandFor(info,"typecheck"),/not available for Android/);

// a plain Gradle (non-Android) project, a Flutter project and an empty folder are not Android
const plain=path.join(root,"plain");write(plain,{"settings.gradle.kts":"rootProject.name=\"x\"\n","build.gradle.kts":"plugins { java }\n"});
assert.equal(isAndroidProject(plain),false);
const flutter=path.join(root,"flutter");write(flutter,{"pubspec.yaml":"name: x\n","android/settings.gradle":"","android/app/src/main/AndroidManifest.xml":"<manifest/>"});
assert.equal(detectProject(flutter).stack,"flutter");
process.env.LAYANX_WORKSPACE_ROOT=root;
assert.match(emptyProjectReason("empty-one",{task:"build"})??"",/android:create/,"an empty folder points to android:create");

// ---------- a JDK Gradle accepts ----------
const jdk=(v:string)=>{const d=fs.mkdtempSync(path.join(root,"jdk-"));fs.writeFileSync(path.join(d,"release"),`JAVA_VERSION="${v}"\n`);return d;};
assert.equal(jdkMajor(jdk("21.0.13")),21);
assert.equal(jdkMajor(jdk("1.8.0_402")),8);
assert.equal(jdkMajor(path.join(root,"nothing")),undefined);

// ---------- Android goals ----------
assert.ok(ANDROID_GOAL.test("اريد بناء تطبيق اندرويد للقيام بعمل محاسب مصروفات"));
assert.ok(ANDROID_GOAL.test("build an Android app for notes"));
assert.ok(!ANDROID_GOAL.test("build a web shop with a cart"));

console.log("android-studio: template, detection, Gradle commands, JDK choice, Android goals");
