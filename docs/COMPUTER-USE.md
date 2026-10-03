# LayanX Computer Use

LayanX now exposes guarded local desktop-control tools through the existing ToolRegistry and ExecutionRuntime.

## Tools
- `desktop.status` — detect the local backend.
- `desktop.screenshot` — capture the primary display as a bounded PNG.
- `desktop.mouse.move` — move the cursor.
- `desktop.mouse.click` — left/right click at coordinates.
- `desktop.keyboard.type` — type bounded text.
- `desktop.keyboard.press` — press an allowlisted key.

## Security boundary
Desktop mutation tools are `L4_EXECUTE` and marked dangerous. They therefore remain behind the existing mission permission, capability, Sentinel, approval, idempotency, audit, and verification pipeline. The adapter never accepts shell commands, executable code, or arbitrary scripts from the caller.

Coordinates are bounded to 0..20000 and text to 4000 characters. Keyboard keys are allowlisted. Screenshots are capped at 5 MiB.

## Backends
- Windows: PowerShell + User32 is used for mouse/keyboard and Windows Forms/System.Drawing for screenshots.
- Linux: `xdotool` is required for mouse/keyboard; `gnome-screenshot` is required for screenshots.
- macOS: the current adapter deliberately reports no ready mutation backend rather than silently attempting unsupported accessibility automation.

Remote phone access continues to use the existing authenticated Control Plane; the phone does not receive direct OS access.