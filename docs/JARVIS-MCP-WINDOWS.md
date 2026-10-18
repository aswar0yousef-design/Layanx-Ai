# Jarvis on Windows: connect it to LayanX through MCP

## Goal

Keep LayanX as the only orchestrator for missions, approvals, project isolation, verification, recovery, memory, and audit. A separate Jarvis installation may contribute tools through the Model Context Protocol (MCP). Do not copy a second full agent runtime into src/ or let two agents control the same mouse and keyboard at once.

The yhongm/jarvis repository documents a Windows x64 installer and a stdio MCP-server mode. An installer being available does not mean Jarvis is installed on this PC, configured, or connected.

## 1. Find and verify Jarvis

Run PowerShell:

~~~powershell
Get-Command JarvisAgent.exe -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty Source

Get-ChildItem "$env:LOCALAPPDATA\Programs" -Filter "JarvisAgent.exe" -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 5 -ExpandProperty FullName
~~~

If the executable is not found, install Jarvis from its official releases at https://github.com/yhongm/jarvis/releases. Check the actual executable path and its user configuration file. The README documents the default Windows data directory as:

~~~text
%LOCALAPPDATA%\Jarvis\config.toml
~~~

Test the installed command with the real path on the PC:

~~~powershell
& "C:\FULL\PATH\TO\JarvisAgent.exe" --mcp --config "$env:LOCALAPPDATA\Jarvis\config.toml"
~~~

The process must remain running and speak MCP over standard input/output. Protocol messages belong on stdout; diagnostics belong on stderr. If the command exits, fix the path or configuration before adding it to LayanX.

## 2. Add it to LayanX

1. Start LayanX with LayanX.cmd and open the local Control Center.
2. Open Integrations → MCP and choose a stdio server.
3. Use a stable id such as jarvis-win. Set command to the actual absolute path to JarvisAgent.exe. Add --mcp, --config, and the full configuration path as separate arguments.
4. Add the server in the disabled/unapproved state first. Inspect the command and configuration, then explicitly approve/connect it.
5. Verify that status becomes connected and LayanX lists the tools Jarvis actually exposes.

Example configuration for understanding only. Replace the paths and add it through the Control Center where possible:

~~~json
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
  "approved": false
}
~~~

Do not put passwords, API keys, or access tokens in the command line or configuration. Use LayanX's secret store and its supported envFromSecrets mechanism when the server requires secrets.

## 3. Acceptance test

Perform these checks in order:

1. Connection: MCP status is connected and the server tool list is non-empty.
2. Read-only call: invoke a harmless read-only tool and confirm it returns a real result.
3. LayanX orchestration: ask LayanX to call that tool and inspect the mission result and audit trail.
4. Approval gate: call a tool that changes a file or interacts with the desktop; verify LayanX asks for approval.
5. Disable: disable the MCP server and verify its tools are no longer available to missions.

A server appearing in the list is not proof that it works. A successful harmless tool call is the first end-to-end proof. Every high-impact tool must still pass through LayanX's existing approval and project-isolation controls.

## Limits

- MCP exposes only tools that the Jarvis server publishes; it does not automatically import every Python package, skill, or feature from another repository.
- Use LayanX as the only desktop orchestrator. Do not enable overlapping keyboard/mouse control from another agent at the same time.
- Review every tool before marking it read-only/safe. File writes, shell execution, messaging, payments, publishing, and desktop changes must not be marked safe just to bypass approval prompts.
- Cloud services still need their own credentials, permissions, and successful connection tests. A UI or config entry alone does not mean an integration is operational.

## References

- Jarvis source and MCP usage: https://github.com/yhongm/jarvis
- Jarvis official releases: https://github.com/yhongm/jarvis/releases
- LayanX MCP client: ../src/mcp/client.ts
- LayanX MCP manager and approvals: ../src/mcp/manager.ts
- LayanX Windows setup: ./WINDOWS-AR.md
