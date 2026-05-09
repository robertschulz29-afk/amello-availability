# Project Context

## What this project is
The app is compares prices for hotel rooms from different sources providing reports. in  addition it is an information base for hotels

## Tech stack
- Frontend: React/Next.js
- Backend: Node
- Database: Supabase
- Hosting: Vercel

## Project structure
```
/
├── src/          # Main source code
├── public/       # Static assets
├── tests/        # Test files
└── docs/         # Documentation
```

## Key conventions
- [e.g. Use TypeScript strict mode]
- [e.g. Functional components only, no classes]
- [e.g. Tailwind for styling, no inline styles]
- [e.g. All API calls go through /src/lib/api.ts]

## Current state
- [What's already built and working]
- [What's in progress]
- [Known issues or constraints]

## Definition of done
A feature is complete when:
1. It works as described in the spec
2. Edge cases are handled (empty states, errors)
3. No console errors or warnings
4. Code passes the automatic code review (see below)

---

## Automatic code review on commit

**Every time a git commit is made, automatically invoke the code-reviewer agent on all changed files before confirming the commit is done.**

### How to do this
1. Run `git diff HEAD` (or `git diff --cached` if files are already staged) to get the list of changed files
2. Pass those files to the code-reviewer agent
3. If the verdict is ✅ LGTM — confirm the commit and continue
4. If the verdict is 🔁 FIX AND RESUBMIT — surface the issues to the user and do not proceed until they are resolved or explicitly dismissed
5. If the verdict is 💬 NEEDS DISCUSSION — pause and present the open question to the user before continuing

### Scope
- Review only the files changed in the current commit (not the entire codebase)
- Focus areas: bugs & correctness, security, performance, style & consistency
- Skip generated files, lock files, and files in `node_modules/`, `dist/`, `.next/`, or similar build output folders

### Override
If the user explicitly says "skip review" or "commit without review", respect that and commit immediately without invoking the reviewer.
