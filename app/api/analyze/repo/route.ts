import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { analyzeSourceFiles, shouldReadAsText } from '../../../../lib/play-analyzer';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_TEXT_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_FILES = 1200;

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
  } catch {
    return null;
  }
}

async function githubJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Google-Play-Deployment-Assistant',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. Public repositories are supported without authentication.`);
  return response.json();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = parseGitHubRepo(String(body?.url ?? ''));
    if (!parsed) {
      return NextResponse.json({ error: 'Enter a public GitHub repository URL such as https://github.com/owner/repository.' }, { status: 400 });
    }

    const metadata = await githubJson(`https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`);
    const branch = metadata.default_branch;
    if (!branch || typeof branch !== 'string') throw new Error('Could not determine the repository default branch.');

    const archiveUrl = `https://codeload.github.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/zip/refs/heads/${encodeURIComponent(branch)}`;
    const response = await fetch(archiveUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not download repository archive (HTTP ${response.status}).`);
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength && declaredLength > MAX_ARCHIVE_BYTES) throw new Error('Repository archive is larger than the 30 MB website analysis limit. Upload a smaller source ZIP or inspect a reduced branch/export.');

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Repository archive is larger than the 30 MB website analysis limit.');

    const zip = await JSZip.loadAsync(bytes);
    const files: Record<string, string> = {};
    let totalTextBytes = 0;
    let fileCount = 0;

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

    const result = analyzeSourceFiles(files, 'repository');
    return NextResponse.json({
      repository: {
        owner: parsed.owner,
        name: parsed.repo,
        defaultBranch: branch,
        visibility: metadata.private ? 'private' : 'public',
        htmlUrl: metadata.html_url,
      },
      inspectedTextFiles: fileCount,
      inspectedTextBytes: totalTextBytes,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Repository analysis failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
