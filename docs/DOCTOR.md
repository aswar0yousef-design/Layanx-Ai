# LayanX Provider Doctor

Run `npm run doctor` before real local model execution. It checks the configured Ollama endpoint and whether the configured model is installed. It never downloads a model and never prints API credentials.

For cloud or hybrid deployments, `layanx health` performs the live provider health check. A missing Ollama model is reported as a setup issue; it is never downloaded automatically.
