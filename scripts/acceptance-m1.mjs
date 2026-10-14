import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = ['WORLD_REPO', 'WORLD_SHA', 'OBSERVATION_REPO', 'OBSERVATION_SHA'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  throw new Error(`Missing required acceptance inputs: ${missing.join(', ')}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function head(repo) {
  const result = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`Cannot resolve HEAD in ${repo}: ${result.stderr}`);
  return result.stdout.trim();
}

function assertClean(repo, label) {
  const result = spawnSync('git', ['-C', repo, 'status', '--porcelain=v1', '--untracked-files=all'], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`Cannot inspect ${label} worktree: ${result.stderr}`);
  if (result.stdout.trim()) throw new Error(`${label} worktree is not clean; exact HEAD alone would not identify the tested source`);
}

for (const [repoName, shaName] of [['WORLD_REPO', 'WORLD_SHA'], ['OBSERVATION_REPO', 'OBSERVATION_SHA']]) {
  const actual = head(process.env[repoName]);
  if (actual !== process.env[shaName]) {
    throw new Error(`${repoName} HEAD mismatch: expected ${process.env[shaName]}, found ${actual}`);
  }
  assertClean(process.env[repoName], repoName);
}

const frontendSha = head(root);
assertClean(root, 'Frontend');
console.log(JSON.stringify({event: 'acceptance-inputs', frontendSha, worldSha: process.env.WORLD_SHA, observationSha: process.env.OBSERVATION_SHA}));
run('node', ['scripts/build.js'], {cwd: root});

const python = process.env.WORLD_PYTHON || 'python3';
run(python, ['scripts/m1-world-acceptance.py'], {
  cwd: root,
  env: {
    ...process.env,
    FRONTEND_ROOT: root,
    FRONTEND_SHA: frontendSha,
  },
});
