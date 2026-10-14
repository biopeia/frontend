import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'WORLD_REPO', 'WORLD_SHA', 'WORLD_M1_BIN', 'WORLD_PROFILE',
  'OBSERVATION_REPO', 'OBSERVATION_SHA', 'ORGANISM_REPO',
  'EMBODIMENT_REPO', 'ENVIRONMENT_REPO', 'MODALITY_REPO',
];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing live acceptance inputs: ${missing.join(', ')}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`git -C ${repo} ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

const frontendSha = git(root, 'rev-parse', 'HEAD');
if (git(root, 'status', '--porcelain=v1', '--untracked-files=all')) throw new Error('Frontend must be clean');
for (const [repoName, shaName] of [['WORLD_REPO', 'WORLD_SHA']]) {
  const repo = process.env[repoName];
  if (git(repo, 'rev-parse', 'HEAD') !== process.env[shaName]) throw new Error(`${repoName} HEAD mismatch`);
  if (git(repo, 'status', '--porcelain=v1', '--untracked-files=all')) throw new Error(`${repoName} must be clean`);
}

const pinnedObservation = process.env.OBSERVATION_SHA;
if (!/^[a-f0-9]{40}$/.test(pinnedObservation) || git(process.env.OBSERVATION_REPO, 'cat-file', '-e', `${pinnedObservation}^{commit}`) !== '') {
  throw new Error('Pinned Observation commit is not available in the supplied clone');
}
for (const name of ['ORGANISM_REPO', 'EMBODIMENT_REPO', 'ENVIRONMENT_REPO', 'MODALITY_REPO']) {
  if (!git(process.env[name], 'rev-parse', '--git-dir')) throw new Error(`${name} is not a Git checkout`);
}

console.log(JSON.stringify({event: 'acceptance-inputs', frontend_sha: frontendSha, world_sha: process.env.WORLD_SHA,
  observation_pinned_sha: pinnedObservation, world_m1_bin: process.env.WORLD_M1_BIN,
  world_profile: process.env.WORLD_PROFILE, cycles: 20}));
run('node', ['scripts/build.js'], {cwd: root});
run(process.env.WORLD_PYTHON || 'python3', ['scripts/m1-live-session-acceptance.py'], {
  cwd: root,
  env: {...process.env, FRONTEND_ROOT: root, FRONTEND_SHA: frontendSha, MIN_BROWSER_COMMITS: '2'},
});
