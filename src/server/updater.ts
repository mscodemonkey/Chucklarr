import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { env } from './env';
import type { UpdateStatus } from '../shared/types';

const execFileAsync = promisify(execFile);
const appRoot = process.cwd();
const updateStatePath = path.join(path.dirname(env.databasePath), 'update-state.json');
const githubApiBase = 'https://api.github.com';

let cachedStatus: UpdateStatus = {
  enabled: Boolean(env.updateRepository && env.updateBranch),
  checking: false,
  updating: false,
  updateAvailable: false,
  canAutoUpdate: env.allowAutoUpdate,
  repository: env.updateRepository,
  branch: env.updateBranch,
  currentSha: null,
  latestSha: null,
  latestUrl: null,
  checkedAt: null,
  message: null,
  error: null
};

type UpdateState = {
  installedSha?: string;
  installedAt?: string;
};

type GithubCommitResponse = {
  sha?: string;
  html_url?: string;
};

export function getUpdateStatus(): UpdateStatus {
  return { ...cachedStatus };
}

export async function refreshUpdateStatus(): Promise<UpdateStatus> {
  if (!cachedStatus.enabled) {
    cachedStatus = {
      ...cachedStatus,
      checking: false,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
      message: 'Update checks are not configured.',
      error: null
    };
    return getUpdateStatus();
  }

  cachedStatus = { ...cachedStatus, checking: true, error: null };

  try {
    const [state, buildRef, latestCommit] = await Promise.all([
      readUpdateState(),
      readBuildRef(),
      githubJson<GithubCommitResponse>(commitApiPath())
    ]);
    const currentSha = normaliseSha(state.installedSha) ?? normaliseSha(env.updateBuildRef) ?? normaliseSha(buildRef);
    const latestSha = normaliseSha(latestCommit.sha);
    const updateAvailable = Boolean(currentSha && latestSha && currentSha !== latestSha);
    const message = !currentSha
      ? 'This build does not include a Git commit SHA, so Chucklarr cannot safely compare it with GitHub.'
      : updateAvailable
        ? 'A newer Chucklarr build is available.'
        : 'Chucklarr is up to date.';

    cachedStatus = {
      ...cachedStatus,
      checking: false,
      updateAvailable,
      currentSha,
      latestSha,
      latestUrl: latestCommit.html_url ?? latestCommitUrl(latestSha),
      checkedAt: new Date().toISOString(),
      message,
      error: null
    };
  } catch (caught) {
    cachedStatus = {
      ...cachedStatus,
      checking: false,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
      message: null,
      error: caught instanceof Error ? caught.message : 'Unable to check for updates.'
    };
  }

  return getUpdateStatus();
}

export async function applyUpdate(): Promise<UpdateStatus> {
  if (!env.allowAutoUpdate) {
    throw new Error('Auto-update is disabled for this build.');
  }
  if (cachedStatus.updating) {
    return getUpdateStatus();
  }

  const status = cachedStatus.latestSha ? getUpdateStatus() : await refreshUpdateStatus();
  if (!status.latestSha) {
    throw new Error(status.error ?? 'No GitHub update target is available.');
  }
  if (!status.currentSha) {
    throw new Error('This build does not include a Git commit SHA, so auto-update cannot safely run.');
  }
  if (status.currentSha === status.latestSha) {
    return status;
  }

  cachedStatus = {
    ...cachedStatus,
    updating: true,
    message: 'Downloading and installing update.',
    error: null
  };

  const workDir = path.join('/tmp', `chucklarr-update-${Date.now()}`);
  const archivePath = path.join(workDir, 'source.tgz');
  const sourceDir = path.join(workDir, 'source');

  try {
    await fs.mkdir(sourceDir, { recursive: true });
    await downloadFile(tarballUrl(), archivePath);
    await run('tar', ['-xzf', archivePath, '-C', sourceDir, '--strip-components=1']);
    await run('npm', ['install'], sourceDir);
    await run('npm', ['run', 'build'], sourceDir);
    await run('npm', ['prune', '--omit=dev'], sourceDir);

    await replacePath(path.join(appRoot, 'dist'), path.join(sourceDir, 'dist'));
    await replacePath(path.join(appRoot, 'node_modules'), path.join(sourceDir, 'node_modules'));
    await fs.copyFile(path.join(sourceDir, 'package.json'), path.join(appRoot, 'package.json'));
    await fs.copyFile(path.join(sourceDir, 'package-lock.json'), path.join(appRoot, 'package-lock.json'));
    await writeUpdateState({ installedSha: status.latestSha, installedAt: new Date().toISOString() });

    cachedStatus = {
      ...cachedStatus,
      updating: false,
      updateAvailable: false,
      currentSha: status.latestSha,
      checkedAt: new Date().toISOString(),
      message: 'Update installed. Chucklarr is restarting.',
      error: null
    };
  } catch (caught) {
    cachedStatus = {
      ...cachedStatus,
      updating: false,
      error: caught instanceof Error ? caught.message : 'Unable to install update.',
      message: null
    };
    throw caught;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return getUpdateStatus();
}

function commitApiPath(): string {
  return `/repos/${env.updateRepository}/commits/${encodeURIComponent(env.updateBranch)}`;
}

function tarballUrl(): string {
  return `${githubApiBase}/repos/${env.updateRepository}/tarball/${encodeURIComponent(env.updateBranch)}`;
}

function latestCommitUrl(sha: string | null): string | null {
  return sha ? `https://github.com/${env.updateRepository}/commit/${sha}` : null;
}

function normaliseSha(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return /^[a-f0-9]{40}$/i.test(trimmed) ? trimmed : null;
}

async function readUpdateState(): Promise<UpdateState> {
  try {
    return JSON.parse(await fs.readFile(updateStatePath, 'utf8')) as UpdateState;
  } catch {
    return {};
  }
}

async function readBuildRef(): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(appRoot, 'build-ref'), 'utf8');
  } catch {
    return undefined;
  }
}

async function writeUpdateState(state: UpdateState): Promise<void> {
  await fs.mkdir(path.dirname(updateStatePath), { recursive: true });
  await fs.writeFile(updateStatePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function githubJson<T>(apiPath: string): Promise<T> {
  const response = await fetch(`${githubApiBase}${apiPath}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Chucklarr'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub update check failed (${response.status}).`);
  }

  return response.json() as Promise<T>;
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Chucklarr'
    }
  });

  if (!response.ok || !response.body) {
    throw new Error(`GitHub update download failed (${response.status}).`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, bytes);
}

async function replacePath(destination: string, source: string): Promise<void> {
  const backup = `${destination}.previous`;
  await fs.rm(backup, { recursive: true, force: true });
  await fs.rename(destination, backup).catch(() => undefined);
  await fs.cp(source, destination, { recursive: true });
  await fs.rm(backup, { recursive: true, force: true });
}

async function run(command: string, args: string[], cwd = appRoot): Promise<void> {
  try {
    await execFileAsync(command, args, {
      cwd,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        NODE_ENV: ''
      }
    });
  } catch (caught) {
    if (caught instanceof Error) {
      throw new Error(`${command} ${args.join(' ')} failed: ${caught.message}`);
    }
    throw caught;
  }
}
