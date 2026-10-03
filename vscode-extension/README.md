# LayanX AI for VS Code

This extension makes the existing LayanX Agent Gateway available directly inside Visual Studio Code.

## What it provides

- LayanX Agent sidebar in the VS Code Activity Bar.
- Run natural-language goals against the existing `/v1/agent/gateway`.
- Automatically sends the current workspace and project ID as context.
- Explain selected code.
- Ask LayanX to fix selected code and verify the change.
- Health check.
- Start the local LayanX runtime in a visible VS Code terminal.
- API token stored with VS Code Secret Storage, not in workspace settings.

## Install locally

1. Open the `Layanx-Ai` repository in VS Code.
2. Press **F5** and choose **Run Extension** to launch an Extension Development Host.
3. In the development host, open the **LayanX** activity-bar view.
4. Start the runtime with **LayanX: Start Local Runtime**, or run `npm run api` in a terminal.
5. If `LAYANX_API_REQUIRE_TOKEN=true`, run **LayanX: Set API Token** once.
6. Set `layanx.projectId` only if you want a project ID different from the workspace folder name.

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

This integration is local-first. Remote API use still follows LayanX's existing API-token requirement.
