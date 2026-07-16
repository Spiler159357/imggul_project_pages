import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const outputPath = path.join(projectRoot, 'public', 'build-version.json');

function resolveCommitSha() {
    const cloudflareCommitSha = process.env.CF_PAGES_COMMIT_SHA?.trim();
    if (cloudflareCommitSha) return cloudflareCommitSha;

    return execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8'
    }).trim();
}

const commitSha = resolveCommitSha();
if (!FULL_GIT_SHA_PATTERN.test(commitSha)) {
    throw new Error(`Invalid Git commit SHA: ${commitSha || '(empty)'}`);
}

const buildVersion = {
    commitSha: commitSha.toLowerCase(),
    version: commitSha.slice(0, 7).toLowerCase()
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(buildVersion)}\n`, { encoding: 'utf8' });

console.log(`Generated build version ${buildVersion.version}`);
