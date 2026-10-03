#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

// Read stdin from Antigravity hook invocation
let inputData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  runGate();
});

// Fallback in case stdin is not piped or already closed
setTimeout(() => {
  if (!gateExecuted) {
    runGate();
  }
}, 500);

let gateExecuted = false;
function runGate() {
  if (gateExecuted) return;
  gateExecuted = true;

  const projectRoot = path.resolve(__dirname, '..', '..');

  const steps = [
    { name: 'Lint', cmd: 'pnpm lint' },
    { name: 'Typecheck', cmd: 'pnpm check' },
    { name: 'Build', cmd: 'pnpm build' },
    { name: 'Unit Tests', cmd: 'pnpm test' },
  ];

  for (const step of steps) {
    try {
      execSync(step.cmd, {
        cwd: projectRoot,
        stdio: 'pipe',
        encoding: 'utf8',
        env: { ...process.env, CI: 'true' }
      });
    } catch (err) {
      const output = ((err.stdout || '') + '\n' + (err.stderr || '')).trim();
      const response = {
        decision: 'continue',
        reason: `Quality Gate Failed at "${step.name}" (${step.cmd}):\n${output.slice(0, 1500)}\n\nPlease fix all errors and warnings before completing the task.`
      };
      process.stdout.write(JSON.stringify(response));
      process.exit(0);
    }
  }

  process.stdout.write(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}
