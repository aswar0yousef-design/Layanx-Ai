# LayanX Creator Engine

Creator Engine adds a local-first production layer without duplicating the existing Business/Media/Social systems.

## Pipeline
1. creator.plan turns a topic into a structured project and scene plan.
2. creator.generate_assets invokes a configured local visual executable for each scene and an optional local TTS executable. Arguments are passed without a shell and support {prompt}, {output}, {duration}, {aspect}, {text}, and {audio} placeholders.
3. creator.render uses FFmpeg directly (no shell) to produce MP4.
4. Existing content.publish remains the only social publishing path.

## Local-first dependencies
- LLM: existing LayanX model router; no extra dependency.
- TTS: optional local executable through LAYANX_TTS_EXECUTABLE.
- Visual generation: optional ComfyUI endpoint through LAYANX_COMFYUI_URL.
- Rendering: FFmpeg installed locally.
- Publishing: existing OAuth/native social connectors.

## Safety
No credentials are stored by Creator Engine. Rendering uses spawn() with argument arrays rather than shell commands. Output and scene assets are confined to the configured creator workspace. Publishing remains behind the existing LayanX permission/approval pipeline.

The current engine deliberately does not claim that a local MP4 is automatically publishable: a public media URL or a configured upload connector is still required by platform APIs.
