# AGENTS.md

## Repo nature

This is not a software project. It is a scratch folder containing:

- `index.html` — a simple static test page ("mango 到此一游")
- `wind_wrfout_d02_2025-09-15_00:00:00` — a ~241 MB WRF model binary output file (typhoon: 桦加沙)

## What NOT to look for

- No `package.json`, `pyproject.toml`, `Cargo.toml`, or any build manifest
- No Makefile, CI config, lint/typecheck/test configs
- No source code directories
- Not a git repository

## Remote server context

The user maintains a remote Ubuntu 20.04 server at `haike@43.154.210.202` with passwordless SSH configured. A local copy of `index.html` may need to be uploaded to `/home/haike/test_web/` on that server to update the test page.

Use `scp` for uploads:
```bash
scp -o StrictHostKeyChecking=no local_file haike@43.154.210.202:/home/haike/test_web/index.html
```

Use base64 encoding via SSH when remote file writes with non-ASCII content risk garbling.

## Git workflow

- After every meaningful change: commit and push to `main` automatically.
- Tags must only be created when the user explicitly asks for it; do not auto-tag.

## User preferences

- Do NOT auto-push to GitHub after commits. Wait for explicit user request.
- Do NOT auto-deploy to remote server. Wait for explicit user request.
