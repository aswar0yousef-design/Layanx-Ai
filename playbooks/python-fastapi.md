---
title: Python API with FastAPI
tags: [python, fastapi, api, backend, pydantic, rest, خادم]
stacks: [python]
---
1. app/main.py creates FastAPI(); routers in app/routers/<resource>.py; schemas with pydantic models.
2. Validate with pydantic models (never read raw dicts); return proper status codes.
3. Database through SQLAlchemy/SQLModel with parameters; no f-string SQL.
4. Settings with pydantic-settings from environment variables; DEBUG off by default.
5. CORS with an explicit list of origins.
6. Tests: pytest with fastapi.testclient.TestClient for success, validation and auth failure.
Checks: python -m pytest -q.
