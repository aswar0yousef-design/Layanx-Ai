# Jarvis on Windows: connect it to LayanX through MCP

## Purpose

LayanX remains the orchestrator: it owns the conversation, task planning, project boundaries, permission checks, approvals, verification, recovery, memory, and audit trail. A separate Jarvis installation can contribute tools through the standard Model Context Protocol (MCP). Do not copy a second full agent runtime into `src/` or run two agents against the desktop at once.

The first candidate to try is [yhongm/jarvis](https://github.com/yhongm/jarvis), whose README documents a Windows installer and an MCP server command:

`powershell
JarvisAgent --mcp --config "$env:LOCALAPPDATA\Jarvis\config.toml"
`

Use the actual executable path and config location from the installation. Other Jarvis repositories need a native MCP server mode or their own adapter; a Windows installer alone does not make a project MCP-compatible.

## 1. Verify the Jarvis installation

Open PowerShell and find the executable if it is not on PATH:

`powershell
Get-Command JarvisAgent.exe -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty Source

Get-ChildItem "$env:LOCALAPPDATA\Programs", "$env:ProgramFiles" -Filter "JarvisAgent.exe" -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 5 -ExpandProperty FullName
`

Test the installed binary with its documented MCP arguments. Substitute your real executable and config paths:

`powershell
& "C:\FULL\PATH\TO\JarvisAgent.exe" --mcp --config "$env:LOCALAPPDATA\Jarvis\config.toml"
`

An MCP stdio server must keep protocol messages on standard output; diagnostics should go to standard error. If this command exits immediately, fix the Jarvis installation/configuration first and read its error output before connecting it to LayanX.

## 2. Add it to LayanX

1. Start LayanX with `LayanX.cmd` and open its local Control Center.
2. Go to **Integrations → MCP** and add a **stdio** server.
3. Use a stable id such as `jarvis-win`, the actual absolute path to `JarvisAgent.exe` as the command, and these arguments:
   - `--mcp`
   - `--config`
   - the full path to Jarvis's `config.toml`
4. Keep the server disabled until LayanX has validated the configuration and you approve it. For an absolute local executable, an exact npm package version is not needed; LayanX treats it as an owner-selected local program.
5. Approve/connect the server and inspect **connected**, **error**, and the returned tool names in the MCP list.

Equivalent server configuration (illustrative only; replace all paths and add it through the Control Center where possible):

`json
{
  "id": "jarvis-win",
  "name": "Jarvis on this Windows PC",
  "transport": "stdio",
  "command": "C:\\FULL\\PATH\\TO\\JarvisAgent.exe",
  "args": [
    "--mcp",
    "--config",
    "C:\\Users\\YOUR_USER\\AppData\\Local\\Jarvis\\config.toml"
  ],
  "enabled": false,
  "approved": false,
  "addedAt": "SET-BY-LAYANX"
}
`

LayanX persists MCP configuration in its local data directory, not in the project repository. Do not put access tokens, passwords, or API keys in the command line or this JSON; use LayanX's secret store and the supported `envFromSecrets` field if the server requires a secret.

## 3. Verify an end-to-end connection

After approval, check the MCP server list in the Control Center. Connected tools are namespaced as `mcp.jarvis-win.<tool>`. New MCP tools are treated as dangerous by default and require LayanX's normal approval flow. Only mark a tool as safe/read-only after inspecting what it does.

Check in this order:

1. The server reports connected and its tool list is non-empty.
2. A harmless read-only Jarvis tool returns a real result.
3. LayanX records the tool call and result in its own task history.
4. A modifying tool pauses for owner approval; disabling the MCP server removes its tools from LayanX.

If it does not connect, check the absolute executable path, the config path, whether the Jarvis command supports stdio MCP, and the Jarvis stderr output. LayanX's MCP timeout/error status should be reported as a connection failure, not a successful integration.

## Limits and safety

- This connects only the tools that Jarvis actually exposes over MCP. It does not automatically import every Python skill or desktop feature from a different repository.
- Do not grant overlapping mouse/keyboard automation to two active agents. Use LayanX as the one owner of desktop missions and call the other agent's non-overlapping tools through MCP.
- Keep LayanX's approval controls enabled. Never classify file writes, shell execution, messaging, payments, or desktop mutation as safe just to avoid approval prompts.
- A connected server is not proof that every upstream feature works. Test each capability with a bounded acceptance case and record failures before calling it ready.

## References

- [yhongm/jarvis README and MCP usage](https://github.com/yhongm/jarvis)
- [LayanX MCP client](../src/mcp/client.ts)
- [LayanX MCP manager and owner approval](../src/mcp/manager.ts)
- [LayanX Windows setup guide](./WINDOWS-AR.md)
