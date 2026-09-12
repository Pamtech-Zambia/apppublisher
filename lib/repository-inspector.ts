import JSZip from 'jszip';
import { shouldReadAsText, type AnalysisResult } from './play-analyzer';
import { analyzeSourceFilesWithEvidence } from './source-evidence';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_FILES = 2000;

export type RepositoryInspection = {
  repository: { owner: string; name: string; defaultBranch: string; visibility: string; htmlUrl?: string };
  inspectedTextFiles: number;
  inspectedTextBytes: number;
  result: AnalysisResult;
};

function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
    return { owner, repo };
  } catch { return null; }
}

async function githubJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Google-Play-Deployment-Assistant', 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. Public repositories are supported without authentication.`);
  return response.json();
}

export async function inspectPublicRepository(repoUrl: string): Promise<RepositoryInspection> {
  const parsed = parseGitHubRepo(repoUrl);
  if (!parsed) throw new Error('Enter a public GitHub repository URL such as https://github.com/owner/repository.');
  const metadata = await githubJson(`https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`);
  if (metadata.private) throw new Error('This repository is private. Export it as a source ZIP and use the website local-file analyzer.');
  const branch = metadata.default_branch;
  if (!branch || typeof branch !== 'string') throw new Error('Could not determine the repository default branch.');

  const archiveUrl = `https://codeload.github.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/zip/refs/heads/${encodeURIComponent(branch)}`;
  const response = await fetch(archiveUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not download repository archive (HTTP ${response.status}).`);
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength && declaredLength > MAX_ARCHIVE_BYTES) throw new Error('Repository archive is larger than the 50 MB online-analysis limit. Export it as a source ZIP and analyze it locally in the browser.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Repository archive is larger than the 50 MB online-analysis limit.');

  const zip = await JSZip.loadAsync(bytes);
  const files: Record<string,string> = {};
  let totalTextBytes = 0, fileCount = 0;
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !shouldReadAsText(path) || fileCount >= MAX_TEXT_FILES) continue;
    const data = await entry.async('uint8array');
    if (data.byteLength > MAX_TEXT_FILE_BYTES) continue;
    if (totalTextBytes + data.byteLength > MAX_TOTAL_TEXT_BYTES) break;
    files[path] = new TextDecoder('utf-8', { fatal: false }).decode(data);
    totalTextBytes += data.byteLength;
    fileCount += 1;
  }
  if (!Object.keys(files).length) throw new Error('No readable Android/source configuration files were found in the repository archive.');

  return {
    repository: { owner: parsed.owner, name: parsed.repo, defaultBranch: branch, visibility: 'public', htmlUrl: metadata.html_url },
    inspectedTextFiles: fileCount,
    inspectedTextBytes: totalTextBytes,
    result: analyzeSourceFilesWithEvidence(files, 'repository'),
  };
}
