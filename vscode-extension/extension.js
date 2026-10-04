const vscode = require("vscode");

const API_PATH = "/v1/agent/gateway";

function activate(context) {
  const provider = new AgentViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("layanx.agent", provider),
    vscode.commands.registerCommand("layanx.openAgent", () => provider.reveal()),
    vscode.commands.registerCommand("layanx.runGoal", () => runGoal(context)),
    vscode.commands.registerCommand("layanx.buildProject", () => buildProject(context)),
    vscode.commands.registerCommand("layanx.explainSelection", () => runSelectionGoal(context, "Explain the selected code clearly, including risks and concrete improvement suggestions.")),
    vscode.commands.registerCommand("layanx.fixSelection", () => runSelectionGoal(context, "Inspect the selected code, identify the root cause of the problem, and fix it in the workspace. Verify the change with appropriate tests or checks.")),
    vscode.commands.registerCommand("layanx.health", () => healthCheck(context)),
    vscode.commands.registerCommand("layanx.startRuntime", () => startRuntime(context)),
    vscode.commands.registerCommand("layanx.setApiToken", () => setApiToken(context))
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = "$(hubot) LayanX";
  status.tooltip = "Open LayanX Agent";
  status.command = "layanx.openAgent";
  status.show();
  context.subscriptions.push(status);
}

function deactivate() {}

class AgentViewProvider {
  constructor(context) { this.context = context; this.view = undefined; }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = renderHtml();
    view.webview.onDidReceiveMessage(async (message) => {
      if (message.command === "run") {
        await executeInteractiveGoal(this.context, String(message.goal || ""), (update) => view.webview.postMessage(update));
      } else if (message.command === "build") {
        const goal = String(message.goal || "").trim();
        if (goal) await executeInteractiveGoal(this.context, [
          "Act as the project builder and repair agent.",
          "Inspect the workspace, plan changes, implement the requested application, install required dependencies with existing project tools, run applicable tests/typecheck/build checks, repair failures, and verify final state.",
          "Preserve unrelated work and do not bypass LayanX permissions or approvals.",
          "",
          goal
        ].join("\n"), (update) => view.webview.postMessage(update));
      } else if (message.command === "approve") {
        await resumeApprovedGoal(this.context, String(message.missionId || ""), Number(message.toolIndex), String(message.approvalId || ""), String(message.projectId || ""), (update) => view.webview.postMessage(update));
      } else if (message.command === "cancel") {
        const result = await cancelMission(this.context, String(message.missionId || ""), String(message.projectId || ""));
        view.webview.postMessage({ command: "result", ...result });
      } else if (message.command === "repair") {
        const result = await repairMission(this.context, String(message.missionId || ""), String(message.projectId || ""));
        view.webview.postMessage({ command: "result", ...result, repair: true });
      } else if (message.command === "health") {
        const result = await request(this.context, "/v1/health", "GET");
        view.webview.postMessage({ command: "health", ...result });
      }
    });
  }
  reveal() { if (this.view) this.view.show?.(true); }
}

async function buildProject(context) {
  const goal = await vscode.window.showInputBox({
    title: "LayanX Project Builder",
    prompt: "Describe the application you want LayanX to build in the current workspace.",
    placeHolder: "Build an app, install dependencies, test it, repair failures, and verify it.",
    ignoreFocusOut: true
  });
  if (!goal?.trim()) return;
  const structured = [
    "Act as the project builder and repair agent for the current workspace.",
    "Inspect the existing workspace before changing files and preserve unrelated work.",
    "Plan the implementation before modifying files.",
    "Use existing LayanX workspace/bootstrap tools for project setup and dependencies.",
    "Run applicable test, typecheck, and build verification after implementation.",
    "If verification fails, diagnose the root cause, repair the workspace, and rerun verification.",
    "Do not report completion until final verification passes or an explicit blocker/approval is reached.",
    "",
    "Application request:",
    goal.trim()
  ].join("\n");
  const result = await executeInteractiveGoal(context, structured, (update) => {
    if (update.command === "approval") vscode.window.showWarningMessage("LayanX Project Builder is waiting for approval.");
  });
  if (result.ok) vscode.window.showInformationMessage(result.completed ? "LayanX Project Builder completed and verified the project." : "LayanX Project Builder paused; approval or repair may be required.");
  else vscode.window.showErrorMessage("LayanX Project Builder: " + result.error);
}

async function runGoal(context) {
  const goal = await vscode.window.showInputBox({
    title: "LayanX Agent",
    prompt: "What should LayanX do in the current project?",
    placeHolder: "Inspect the project, find the failing test, fix it, and verify the result.",
    ignoreFocusOut: true
  });
  if (!goal?.trim()) return;
  const result = await executeInteractiveGoal(context, goal.trim(), (update) => { if (update.command === "approval") vscode.window.showWarningMessage("LayanX is waiting for approval."); });
  if (result.ok) vscode.window.showInformationMessage(result.completed ? "LayanX completed the goal." : "LayanX paused; inspect the result for required approval.");
  else vscode.window.showErrorMessage("LayanX: " + result.error);
}

async function runSelectionGoal(context, instruction) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const selection = editor.document.getText(editor.selection);
  if (!selection.trim()) return;
  const relative = vscode.workspace.asRelativePath(editor.document.uri);
  const goal = [
    instruction,
    "",
    "Current file: " + relative,
    "Selection:",
    "<selection>",
    selection.slice(0, 12000),
    "</selection>",
    "",
    "Work in the current VS Code workspace. Do not modify unrelated files."
  ].join("\n");
  const result = await executeGoal(context, goal);
  if (result.ok) vscode.window.showInformationMessage(result.completed ? "LayanX completed the selection task." : "LayanX paused for approval.");
  else vscode.window.showErrorMessage("LayanX: " + result.error);
}

async function executeInteractiveGoal(context, goal, onUpdate) {
  if (!goal.trim()) return { ok: false, error: "Goal is required." };
  const config = vscode.workspace.getConfiguration("layanx");
  const projectId = getProjectId(config);
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  const enrichedGoal = [goal.trim(), "", "VS Code context:", "- Project ID: " + projectId, "- Workspace: " + workspacePath,
    "- The request originated inside VS Code.", "- Use existing LayanX tools, permissions and approvals; do not bypass them.",
    "- Change only the current project workspace and verify before reporting completion."].join("\n");
  const created = await request(context, "/v1/missions", "POST", {goal: enrichedGoal, projectId});
  if (!created.ok || !created.mission?.id) return created;
  const missionId = created.mission.id;
  onUpdate?.({command:"mission",missionId,projectId,status:"running"});
  return executeMissionLoop(context, missionId, projectId, {}, onUpdate);
}

async function executeMissionLoop(context, missionId, projectId, approvalIds, onUpdate) {
  const config = vscode.workspace.getConfiguration("layanx");
  let after = "";
  let loopResult;
  const loopPromise = request(context, "/v1/missions/" + encodeURIComponent(missionId) + "/agent-loop", "POST", {
    projectId, maxSteps: clamp(Number(config.get("maxSteps", 10)), 1, 25), agentId:"core", approvalIds
  });
  while (true) {
    const events = await request(context, "/v1/missions/" + encodeURIComponent(missionId) + "/events?projectId=" + encodeURIComponent(projectId) + (after ? "&after=" + encodeURIComponent(after) : ""), "GET");
    if (events.ok && Array.isArray(events.events)) {
      for (const event of events.events) { onUpdate?.({command:"event",event}); after = event.id || after; }
    }
    const settled = await Promise.race([loopPromise.then(value => ({done:true,value})), new Promise(resolve => setTimeout(() => resolve({done:false}), 700))]);
    if (settled.done) { loopResult = settled.value; break; }
  }
  const result = loopResult || {ok:false,error:"Agent loop ended without a result."};
  if (result.ok && result.paused) onUpdate?.({command:"approval",missionId,projectId,toolIndex:result.nextToolIndex,approvalId:result.approvalId});
  else onUpdate?.({command:"result",...result});
  return result;
}

async function resumeApprovedGoal(context, missionId, toolIndex, approvalId, projectId, onUpdate) {
  if (!missionId || !projectId || !approvalId || !Number.isInteger(toolIndex)) return {ok:false,error:"Approval resume data is incomplete."};
  return executeMissionLoop(context, missionId, projectId, {[toolIndex]:approvalId}, onUpdate);
}

async function cancelMission(context, missionId, projectId) {
  if (!missionId || !projectId) return {ok:false,error:"Mission cancellation data is incomplete."};
  return request(context, "/v1/missions/" + encodeURIComponent(missionId) + "/cancel", "POST", {projectId});
}

async function repairMission(context, missionId, projectId) {
  if (!missionId || !projectId) return {ok:false,error:"Mission repair data is incomplete."};
  return request(context, "/v1/missions/" + encodeURIComponent(missionId) + "/repair", "POST", {
    projectId, maxRepairAttempts: 3, agentId:"core"
  });
}

async function executeGoal(context, goal) {
  if (!goal.trim()) return { ok: false, error: "Goal is required." };
  const config = vscode.workspace.getConfiguration("layanx");
  const projectId = getProjectId(config);
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  const enrichedGoal = [
    goal.trim(),
    "",
    "VS Code context:",
    "- Project ID: " + projectId,
    "- Workspace: " + workspacePath,
    "- The request originated inside VS Code.",
    "- Use the existing LayanX tools and permissions; do not bypass approval or safety controls.",
    "- If code/files must be changed, make the changes in this workspace and verify them before reporting completion."
  ].join("\n");
  return request(context, API_PATH, "POST", {
    goal: enrichedGoal,
    projectId,
    maxSteps: clamp(Number(config.get("maxSteps", 10)), 1, 25),
    agentId: "core"
  });
}

async function healthCheck(context) {
  const result = await request(context, "/v1/health", "GET");
  if (result.ok) vscode.window.showInformationMessage("LayanX runtime is healthy.");
  else vscode.window.showErrorMessage("LayanX health check failed: " + result.error);
}

async function startRuntime(context) {
  const config = vscode.workspace.getConfiguration("layanx");
  const configured = String(config.get("runtimePath", "") || "").trim();
  const cwd = configured || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    vscode.window.showErrorMessage("Open a workspace or configure layanx.runtimePath first.");
    return;
  }
  const command = String(config.get("runtimeCommand", "npm run api"));
  const terminal = vscode.window.createTerminal({ name: "LayanX Runtime", cwd });
  terminal.show(true);
  terminal.sendText(command, true);
  vscode.window.showInformationMessage("LayanX runtime start command sent to the terminal.");
}

async function setApiToken(context) {
  const token = await vscode.window.showInputBox({
    title: "LayanX API Token",
    prompt: "Enter the local LayanX API token. It will be stored in VS Code Secret Storage.",
    password: true,
    ignoreFocusOut: true
  });
  if (token === undefined) return;
  if (!token.trim()) {
    await context.secrets.delete("layanx.apiToken");
    vscode.window.showInformationMessage("LayanX API token cleared.");
    return;
  }
  await context.secrets.store("layanx.apiToken", token.trim());
  vscode.window.showInformationMessage("LayanX API token stored securely in VS Code.");
}

function getProjectId(config) {
  const configured = String(config.get("projectId", "") || "").trim();
  if (configured) return configured;
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? folder.name : "default";
}

async function request(context, path, method, payload) {
  const config = vscode.workspace.getConfiguration("layanx");
  const base = String(config.get("apiBaseUrl", "http://127.0.0.1:3000")).replace(/\/$/, "");
  const token = await context.secrets.get("layanx.apiToken");
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  try {
    const response = await fetch(base + path, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(payload)
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) return { ok: false, status: response.status, error: data?.error || "HTTP " + response.status, data };
    return { ok: true, status: response.status, ...data };
  } catch (error) {
    return {
      ok: false,
      error: "Cannot reach LayanX at " + base + ". Start the runtime or check layanx.apiBaseUrl.",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function clamp(value, min, max) {
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), min), max) : min;
}

function renderHtml() {
  const nonce = String(Date.now());
  const html = [
    "<!doctype html>",
    "<html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'\">",
    "<style>body{font-family:var(--vscode-font-family);padding:10px}h3{margin:0 0 10px}textarea{width:100%;min-height:110px;box-sizing:border-box;resize:vertical}button{width:100%;margin-top:8px;padding:7px}#result{white-space:pre-wrap;margin-top:12px}.small{opacity:.75;font-size:11px}</style>",
    "</head><body><h3>LayanX Agent</h3>",
    "<div class=\"small\">Local-first agent with live mission progress, approvals, repair and verification.</div>",
    "<textarea id=\"goal\" placeholder=\"Tell LayanX what to build, fix, test or verify...\"></textarea>",
    "<button id=\"run\">Run with LayanX</button><button id=\"build\">Build / Repair Project</button><button id=\"approve\" style=\"display:none\">Approve and Continue</button><button id=\"repair\" style=\"display:none\">Run Repair</button><button id=\"cancel\" style=\"display:none\">Cancel Mission</button><button id=\"health\">Health Check</button>",
    "<div id=\"result\"></div>",
    "<script nonce=\"" + nonce + "\">",
    "const vscode=acquireVsCodeApi();const goal=document.getElementById(\"goal\");const result=document.getElementById(\"result\");const approve=document.getElementById(\"approve\");const repair=document.getElementById(\"repair\");const cancel=document.getElementById(\"cancel\");let state={};",
    "function show(m){if(m.missionId)state={...state,...m};if(m.command===\"mission\"){state=m;result.textContent=\"Mission \"+m.missionId+\" started.\\n\";}if(m.command===\"event\"){result.textContent+=\"\\n[\"+(m.event.type||\"event\")+\" ] \"+JSON.stringify(m.event.data||m.event);result.scrollTop=result.scrollHeight;}if(m.command===\"approval\"){state={...state,...m};approve.style.display=\"block\";repair.style.display=\"none\";cancel.style.display=\"block\";result.textContent+=\"\\nApproval required for tool #\"+m.toolIndex+\".\";}if(m.command===\"result\"){approve.style.display=\"none\";cancel.style.display=\"none\";repair.style.display=(m.ok===false||m.completed===false)?\"block\":\"none\";result.textContent+=\"\\n\"+(m.ok?(m.completed?\"Completed.\":\"Paused/blocked.\"):\"Error: \"+m.error)+\"\\n\"+JSON.stringify(m,null,2);result.scrollTop=result.scrollHeight;}if(m.command===\"health\"){result.textContent=m.ok?JSON.stringify(m,null,2):\"Error: \"+m.error;}}",
    "document.getElementById(\"run\").addEventListener(\"click\",()=>{approve.style.display=\"none\";repair.style.display=\"none\";cancel.style.display=\"none\";result.textContent=\"Starting mission...\";vscode.postMessage({command:\"run\",goal:goal.value});});",
    "document.getElementById(\"build\").addEventListener(\"click\",()=>{approve.style.display=\"none\";repair.style.display=\"none\";cancel.style.display=\"none\";result.textContent=\"Starting project builder...\";vscode.postMessage({command:\"build\",goal:goal.value});});",
    "approve.addEventListener(\"click\",()=>{approve.style.display=\"none\";result.textContent+=\"\\nResuming approved mission...\";vscode.postMessage({command:\"approve\",...state});});",
    "repair.addEventListener(\"click\",()=>{repair.style.display=\"none\";result.textContent+=\"\\nStarting repair loop...\";vscode.postMessage({command:\"repair\",...state});});",
    "cancel.addEventListener(\"click\",()=>{cancel.style.display=\"none\";vscode.postMessage({command:\"cancel\",...state});});",
    "document.getElementById(\"health\").addEventListener(\"click\",()=>{result.textContent=\"Checking...\";vscode.postMessage({command:\"health\"});});",
    "window.addEventListener(\"message\",event=>show(event.data));",
    "</script></body></html>"
  ];
  return html.join("");
}

module.exports = { activate, deactivate };
