---
trigger: always_on
---

# Quality Gate & Package Manager Policy

THE CODE MUST KNOW 0 ABOUT OUR SPECIFIC JSON CONFIG IDS OR NAMES LET CONFIG BBE FULLY STANDALONE

## 1. Package Manager Enforcement
- ALWAYS use `pnpm` for all dependency management, script running, and package execution.
- NEVER execute `npm`, `yarn`, `bun`, or `npx`. If a package runner is required, use `pnpm dlx`.

## 2. Post-Code-Change Quality Gate
After making ANY code changes or creating new files, you MUST sequentially run:
1. `pnpm lint` (Oxlint)
2. `pnpm check` (TypeScript `tsc --noEmit`)
3. `pnpm build` (Vite production build)
4. `pnpm test` (Vitest unit tests)

## 3. Zero Warnings & Zero Errors Mandate
- You MUST fix any issues discovered during lint, typecheck, build, or test execution.
- 0 warnings and 0 errors are strictly required before concluding any turn or declaring a task complete.

## 4. Mandatory Test Coverage for Feature Changes
- Whenever adding a new feature or editing an existing feature, ALWAYS add or update corresponding unit tests in `tests/unit/`.
- Ensure tests verify edge cases, user interactions, and regression prevention.
