# LayanX AI for VS Code

This extension makes the existing LayanX Agent Gateway available directly inside Visual Studio Code.

## What it provides

- LayanX Agent sidebar in the VS Code Activity Bar.
- Run natural-language goals through resumable missions and the existing Agent Gateway.
- Build/Repair Project workflow that reuses the existing project bootstrap, verification and autonomous repair engine.
- Live mission events, approval/resume, cancellation and repair controls.
- Automatically sends the current workspace and project ID as context.
- Explain selected code.
- Ask LayanX to fix selected code and verify the change.
- Health check.
- Start the local LayanX runtime in a visible VS Code terminal.
- Pairing-code connection; the device token is stored with VS Code Secret Storage, not in workspace settings.

## Install (Windows)

1. Start LayanX with `LayanX.cmd`.
2. Run `powershell -ExecutionPolicy Bypass -File scripts\windows\install-vscode-extension.ps1`
   (or in VS Code: Extensions › … › **Install from VSIX…** › `vscode-extension/layanx-agent.vsix`).
3. On the LayanX setup page: **Phone & VS Code › Create pairing code**.
4. In VS Code: `Ctrl+Shift+P` › **LayanX: Connect (Pairing Code)** and type the code.

VS Code gets its own device token (revocable from the setup page). The folder open in VS Code is
linked to its project ID automatically, so LayanX reads, edits, tests and commits exactly these files.

## Commands

- **LayanX: Run Goal**, **Build / Repair Project**, **Explain Selection**, **Fix Selection**
- **LayanX: Show Approvals**: approve or reject waiting actions without leaving VS Code
- **LayanX: Use This Folder as the Project**: re-link after renaming or moving the folder
- **LayanX: Health Check**, **LayanX: Start Local Runtime** (`npm run local`)

Rebuild the package after changing the extension: `npm run vsix`.

## Runtime model

The extension is intentionally thin. It does not create a second agent or duplicate tool execution.

VS Code -> LayanX extension -> local HTTP API -> Agent Gateway -> existing LayanX tools/permissions/approvals/verification -> workspace.

For actual file/code changes, the LayanX runtime must have access to the same workspace on the machine. The extension includes the workspace path in the goal context, but it does not bypass the runtime's project isolation or permission model.

## Configuration

- `layanx.apiBaseUrl`: default `http://127.0.0.1:3000`
- `layanx.projectId`: defaults to the current workspace folder name
- `layanx.runtimePath`: optional path to the LayanX-Ai runtime repository
- `layanx.runtimeCommand`: default `npm run api`
- `layanx.maxSteps`: default 10, maximum 25

## Project Builder lifecycle

The **Build / Repair Project** action is an orchestration UI only; it does not create a second agent engine. It uses the existing LayanX mission loop:

`inspect -> plan -> implement -> bootstrap/install -> verify -> repair on failure -> verify again -> complete/blocked`

Dangerous operations remain subject to the runtime permission and approval system. The VS Code extension can cancel a running mission or invoke the existing repair endpoint after a failed/blocked run.

This integration is local-first. Remote API use still follows LayanX's existing API-token requirement.
