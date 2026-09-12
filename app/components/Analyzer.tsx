'use client';

import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { analyzeCompiledArchive, analyzeSourceFiles, shouldReadAsText, type AnalysisResult } from '../../lib/play-analyzer';

type RepoResponse = {
  repository?: { owner: string; name: string; defaultBranch: string; visibility: string; htmlUrl?: string };
  inspectedTextFiles?: number;
  inspectedTextBytes?: number;
  result?: AnalysisResult;
  error?: string;
};

const severityOrder = { BLOCKING: 0, REQUIRED_INPUT: 1, REVIEW_RISK: 2, RECOMMENDATION: 3 } as const;

function bytesLabel(value?: number) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function analyzeLocalArchive(file: File): Promise<AnalysisResult> {
  const lower = file.name.toLowerCase();
  const kind = lower.endsWith('.apk') ? 'apk' : lower.endsWith('.aab') ? 'aab' : 'source-zip';
  if (file.size > 250 * 1024 * 1024) throw new Error('For browser safety, local archives are limited to 250 MB.');

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files);
  if (kind === 'apk' || kind === 'aab') return analyzeCompiledArchive(names, kind);

  const files: Record<string, string> = {};
  let totalBytes = 0;
  let count = 0;
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !shouldReadAsText(path) || count >= 1500) continue;
    const bytes = await entry.async('uint8array');
    if (bytes.byteLength > 1024 * 1024) continue;
    if (totalBytes + bytes.byteLength > 15 * 1024 * 1024) break;
    files[path] = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    totalBytes += bytes.byteLength;
    count += 1;
  }
  if (!Object.keys(files).length) throw new Error('No readable source/configuration files were found in this ZIP.');
  return analyzeSourceFiles(files, 'source-zip');
}

function ResultPanel({ result }: { result: AnalysisResult }) {
  const sortedFindings = useMemo(() => [...result.findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]), [result]);
  const blockers = result.findings.filter(f => f.severity === 'BLOCKING').length;
  const needsInput = result.findings.filter(f => f.severity === 'REQUIRED_INPUT').length;

  return <section className="results" aria-live="polite">
    <div className="summaryGrid">
      <div className="summaryCard"><span>Decision</span><strong>{blockers ? 'Blocked' : needsInput ? 'Needs input' : 'Prepare for validation'}</strong></div>
      <div className="summaryCard"><span>Source</span><strong>{result.sourceType}</strong></div>
      <div className="summaryCard"><span>Verified facts</span><strong>{result.verifiedFacts.length}</strong></div>
      <div className="summaryCard"><span>Open questions</span><strong>{result.questions.length}</strong></div>
    </div>

    <div className="resultCard">
      <h3>App identity</h3>
      <dl className="facts">
        <div><dt>Name</dt><dd>{result.app.appName ?? 'Unknown'}</dd></div>
        <div><dt>Package</dt><dd>{result.app.packageName ?? 'Unknown'}</dd></div>
        <div><dt>Version</dt><dd>{result.app.versionName ?? 'Unknown'}{result.app.versionCode != null ? ` (${result.app.versionCode})` : ''}</dd></div>
        <div><dt>SDK</dt><dd>{result.app.targetSdk != null ? `target ${result.app.targetSdk}` : 'target unknown'}{result.app.minSdk != null ? ` · min ${result.app.minSdk}` : ''}</dd></div>
      </dl>
    </div>

    <div className="resultCard">
      <h3>Submission findings</h3>
      {!sortedFindings.length && <p className="muted">No static-analysis blockers were identified. Runtime behavior and Play Console declarations still need validation.</p>}
      <div className="findingList">
        {sortedFindings.map((finding, i) => <article key={`${finding.title}-${i}`} className={`finding ${finding.severity.toLowerCase()}`}>
          <div className="findingTop"><span className="pill">{finding.severity.replace('_', ' ')}</span><strong>{finding.title}</strong></div>
          <p>{finding.detail}</p>
          {!!finding.evidence?.length && <details><summary>Evidence</summary><ul>{finding.evidence.map(e => <li key={e}>{e}</li>)}</ul></details>}
        </article>)}
      </div>
    </div>

    <div className="twoCol">
      <div className="resultCard">
        <h3>Verified evidence</h3>
        {result.verifiedFacts.length ? <ul>{result.verifiedFacts.map(x => <li key={x}>{x}</li>)}</ul> : <p className="muted">No publishable app facts were established from this input.</p>}
        {!!result.sdkSignals.length && <><h4>SDK/integration signals</h4><ul>{result.sdkSignals.map(x => <li key={x}>{x}</li>)}</ul></>}
        {!!result.remoteHosts.length && <><h4>Remote hosts</h4><ul>{result.remoteHosts.slice(0, 12).map(x => <li key={x}><code>{x}</code></li>)}</ul></>}
      </div>

      <div className="resultCard">
        <h3>Inferred — not publishable yet</h3>
        {result.inferredFeatures.length ? <ul>{result.inferredFeatures.map(x => <li key={x}>{x}</li>)}</ul> : <p className="muted">No feature hypotheses were produced.</p>}
        <p className="truthNote">These are investigation leads, not claims for the Play listing, until corroborated.</p>
      </div>
    </div>

    <div className="twoCol">
      <div className="resultCard">
        <h3>Questions we still need answered</h3>
        <ol>{result.questions.map(x => <li key={x}>{x}</li>)}</ol>
      </div>
      <div className="resultCard">
        <h3>Store listing plan</h3>
        <p><strong>Title:</strong> {result.listingPlan.title ?? 'Not enough evidence yet'}</p>
        <p><strong>Short description:</strong> {result.listingPlan.shortDescription ?? 'Not generated — verified user-facing value is not yet established.'}</p>
        <h4>Screenshot plan</h4>
        <ul>{result.listingPlan.screenshotPlan.map(x => <li key={x}>{x}</li>)}</ul>
      </div>
    </div>

    <div className="resultCard">
      <h3>Assets & privacy clues</h3>
      <div className="assetGrid">
        <div><strong>Icon candidates</strong><span>{result.assets.iconCandidates.length}</span></div>
        <div><strong>Screenshots found</strong><span>{result.assets.screenshots.length}</span></div>
        <div><strong>Feature graphics</strong><span>{result.assets.featureGraphics.length}</span></div>
        <div><strong>Privacy files</strong><span>{result.assets.privacyPolicyCandidates.length}</span></div>
      </div>
      {result.secretIndicators.count > 0 && <p className="dangerText">Potential secret indicators: {result.secretIndicators.count}. Values are intentionally never shown.</p>}
    </div>

    <details className="resultCard"><summary><strong>Analysis limitations</strong></summary><ul>{result.limitations.map(x => <li key={x}>{x}</li>)}</ul></details>
  </section>;
}

export default function Analyzer() {
  const [repoUrl, setRepoUrl] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [meta, setMeta] = useState<string>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function analyzeRepo() {
    setBusy(true); setError(''); setResult(null); setMeta('');
    try {
      const response = await fetch('/api/analyze/repo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: repoUrl.trim() }) });
      const data = await response.json() as RepoResponse;
      if (!response.ok || !data.result) throw new Error(data.error || 'Repository analysis failed.');
      setResult(data.result);
      setMeta(`${data.repository?.owner}/${data.repository?.name} · ${data.repository?.defaultBranch} · ${data.inspectedTextFiles} text files · ${bytesLabel(data.inspectedTextBytes)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Repository analysis failed.');
    } finally { setBusy(false); }
  }

  async function handleFile(file?: File) {
    if (!file) return;
    setBusy(true); setError(''); setResult(null); setMeta('');
    try {
      if (!/\.(zip|apk|aab)$/i.test(file.name)) throw new Error('Choose a source ZIP, APK, or AAB file.');
      const output = await analyzeLocalArchive(file);
      setResult(output);
      setMeta(`${file.name} · ${bytesLabel(file.size)} · analyzed locally in this browser`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Local analysis failed.');
    } finally { setBusy(false); }
  }

  return <div className="analyzerShell">
    <section className="inputPanel">
      <div className="inputCard">
        <span className="eyebrow">Option 1</span>
        <h2>Analyze a public GitHub repository</h2>
        <p>Paste the repository URL. We download only enough source/configuration text to build an evidence report.</p>
        <div className="row">
          <input value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repository" aria-label="Public GitHub repository URL" />
          <button onClick={analyzeRepo} disabled={busy || !repoUrl.trim()}>{busy ? 'Analyzing…' : 'Analyze repo'}</button>
        </div>
        <small>Public repositories only. Private repositories can be exported as a source ZIP and analyzed below.</small>
      </div>

      <div className="inputCard">
        <span className="eyebrow">Option 2</span>
        <h2>Inspect a source ZIP, APK, or AAB</h2>
        <p>The file is read locally in your browser. APK/AAB checks currently validate archive structure; compiled manifest facts remain unknown unless they can be proven.</p>
        <label className="uploadButton">
          <input type="file" accept=".zip,.apk,.aab,application/zip" onChange={e => handleFile(e.target.files?.[0])} />
          Choose file
        </label>
        <small>Browser safety limit: 250 MB. Secret values are never displayed.</small>
      </div>
    </section>

    {meta && <p className="metaLine">{meta}</p>}
    {error && <div className="errorBox" role="alert">{error}</div>}
    {busy && <div className="loadingBox">Inspecting evidence. We will mark anything we cannot prove as unknown.</div>}
    {result && <ResultPanel result={result} />}
  </div>;
}
