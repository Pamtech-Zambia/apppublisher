'use client';

import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { shouldReadAsText, type AnalysisResult } from '../../lib/play-analyzer';
import { analyzeSourceFilesWithEvidence } from '../../lib/source-evidence';
import { analyzeParsedAndroid } from '../../lib/android-binary';

type RepoResponse = { repository?:{owner:string;name:string;defaultBranch:string;visibility:string;htmlUrl?:string}; inspectedTextFiles?:number; inspectedTextBytes?:number; result?:AnalysisResult; error?:string };
type Props = { onAnalysis?: (result: AnalysisResult) => void };
type AppInspectModule = typeof import('@h-t-m/app-inspect');
const severityOrder={BLOCKING:0,REQUIRED_INPUT:1,REVIEW_RISK:2,RECOMMENDATION:3} as const;
const bytesLabel=(v?:number)=>!v?'0 B':v<1024?`${v} B`:v<1048576?`${(v/1024).toFixed(1)} KB`:`${(v/1048576).toFixed(1)} MB`;

async function loadBrowserInspector():Promise<AppInspectModule>{
  // Load the package's published browser runtime directly from our own origin.
  // webpackIgnore is deliberate: rebundling this module rewrites its WASM path.
  const runtimeUrl='/vendor/app-inspect/index.js';
  return import(/* webpackIgnore: true */ runtimeUrl) as Promise<AppInspectModule>;
}

async function analyzeBinary(file: File, kind: 'apk'|'aab'): Promise<AnalysisResult> {
  const mod = await loadBrowserInspector();
  const parser = new mod.AppInfoParser(file);
  const parsed = await parser.parse();
  const pi = parsed.data?.platformInfo;
  if (pi && typeof mod.isAndroidInfo === 'function' && !mod.isAndroidInfo(pi)) {
    throw new Error(`The selected file was not decoded as an Android ${kind.toUpperCase()} package.`);
  }
  return analyzeParsedAndroid(parsed.data, parsed.warnings, kind);
}

async function analyzeLocalArchive(file:File):Promise<AnalysisResult>{
 const lower=file.name.toLowerCase(); const kind=lower.endsWith('.apk')?'apk':lower.endsWith('.aab')?'aab':'source-zip';
 if(file.size>500*1024*1024)throw new Error('For browser safety, local files are limited to 500 MB.');
 if(kind==='apk'||kind==='aab') return analyzeBinary(file, kind);
 const zip=await JSZip.loadAsync(await file.arrayBuffer());
 const files:Record<string,string>={};let total=0,count=0;
 for(const [path,entry] of Object.entries(zip.files)){if(entry.dir||!shouldReadAsText(path)||count>=2500)continue;const bytes=await entry.async('uint8array');if(bytes.byteLength>1024*1024)continue;if(total+bytes.byteLength>25*1024*1024)break;files[path]=new TextDecoder('utf-8',{fatal:false}).decode(bytes);total+=bytes.byteLength;count++;}
 if(!Object.keys(files).length)throw new Error('No readable source/configuration files were found in this ZIP.');
 return analyzeSourceFilesWithEvidence(files,'source-zip');
}

function downloadReport(result: AnalysisResult) {
  const blob = new Blob([JSON.stringify({generatedAt:new Date().toISOString(), result}, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${result.app.packageName || 'android-app'}-play-readiness.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function ResultPanel({result}:{result:AnalysisResult}){
 const sorted=useMemo(()=>[...result.findings].sort((a,b)=>severityOrder[a.severity]-severityOrder[b.severity]),[result]);
 const blockers=result.findings.filter(f=>f.severity==='BLOCKING').length, needs=result.findings.filter(f=>f.severity==='REQUIRED_INPUT').length;
 return <section className="results" aria-live="polite">
  <div className="summaryGrid"><div className="summaryCard"><span>Decision</span><strong>{blockers?'Blocked':needs?'Needs input':'Prepare for validation'}</strong></div><div className="summaryCard"><span>Source</span><strong>{result.sourceType.toUpperCase()}</strong></div><div className="summaryCard"><span>Verified facts</span><strong>{result.verifiedFacts.length}</strong></div><div className="summaryCard"><span>Open questions</span><strong>{result.questions.length}</strong></div></div>
  <div className="resultActions"><button className="primaryButton" onClick={()=>downloadReport(result)}>Download evidence report</button></div>
  <div className="resultCard"><h3>App identity</h3><dl className="facts"><div><dt>Name</dt><dd>{result.app.appName??'Unknown'}</dd></div><div><dt>Package</dt><dd>{result.app.packageName??'Unknown'}</dd></div><div><dt>Version</dt><dd>{result.app.versionName??'Unknown'}{result.app.versionCode!=null?` (${result.app.versionCode})`:''}</dd></div><div><dt>SDK</dt><dd>{result.app.targetSdk!=null?`target ${result.app.targetSdk}`:'target unknown'}{result.app.minSdk!=null?` · min ${result.app.minSdk}`:''}</dd></div></dl></div>
  <div className="resultCard"><h3>Submission findings</h3>{!sorted.length&&<p className="muted">No blocker was identified from the evidence available to this inspector. Runtime behavior and Play Console declarations still need validation.</p>}<div className="findingList">{sorted.map((f,i)=><article key={`${f.title}-${i}`} className={`finding ${f.severity.toLowerCase()}`}><div className="findingTop"><span className="pill">{f.severity.replace('_',' ')}</span><strong>{f.title}</strong></div><p>{f.detail}</p>{!!f.evidence?.length&&<details><summary>Evidence</summary><ul>{f.evidence.map(e=><li key={e}>{e}</li>)}</ul></details>}</article>)}</div></div>
  <div className="twoCol"><div className="resultCard"><h3>Verified evidence</h3>{result.verifiedFacts.length?<ul>{result.verifiedFacts.map(x=><li key={x}>{x}</li>)}</ul>:<p className="muted">No publishable app facts were established from this input.</p>}{!!result.sdkSignals.length&&<><h4>SDK/framework signals</h4><ul>{result.sdkSignals.map(x=><li key={x}>{x}</li>)}</ul></>}{!!result.remoteHosts.length&&<><h4>Remote hosts</h4><ul>{result.remoteHosts.slice(0,20).map(x=><li key={x}><code>{x}</code></li>)}</ul></>}</div><div className="resultCard"><h3>Inferred — not publishable yet</h3>{result.inferredFeatures.length?<ul>{result.inferredFeatures.map(x=><li key={x}>{x}</li>)}</ul>:<p className="muted">No unverified feature hypotheses were produced.</p>}<p className="truthNote">These are investigation leads, not claims for the Play listing, until corroborated.</p></div></div>
  {!!result.permissions.length&&<div className="resultCard"><h3>Compiled/declared Android permissions</h3><div className="permissionGrid">{result.permissions.map(p=><code key={p} className={result.sensitivePermissions.includes(p)?'permissionSensitive':''}>{p}</code>)}</div></div>}
  <div className="twoCol"><div className="resultCard"><h3>Questions we still need answered</h3><ol>{result.questions.map(x=><li key={x}>{x}</li>)}</ol></div><div className="resultCard"><h3>Store listing plan</h3><p><strong>Title:</strong> {result.listingPlan.title??'Not enough evidence yet'}</p><p><strong>Short description:</strong> {result.listingPlan.shortDescription??'Not generated — verified user-facing value is not yet established.'}</p><h4>Screenshot plan</h4><ul>{result.listingPlan.screenshotPlan.map(x=><li key={x}>{x}</li>)}</ul></div></div>
  <div className="resultCard"><h3>Assets & privacy clues</h3><div className="assetGrid"><div><strong>Icon evidence</strong><span>{result.assets.iconCandidates.length}</span></div><div><strong>Screenshots found</strong><span>{result.assets.screenshots.length}</span></div><div><strong>Feature graphics</strong><span>{result.assets.featureGraphics.length}</span></div><div><strong>Privacy files</strong><span>{result.assets.privacyPolicyCandidates.length}</span></div></div>{result.secretIndicators.count>0&&<p className="dangerText">Potential secret indicators: {result.secretIndicators.count}. Values are intentionally never shown.</p>}</div>
  <details className="resultCard"><summary><strong>Analysis limitations</strong></summary><ul>{result.limitations.map(x=><li key={x}>{x}</li>)}</ul></details>
 </section>;
}

export default function Analyzer({onAnalysis}:Props){
 const [repoUrl,setRepoUrl]=useState('');const [result,setResult]=useState<AnalysisResult|null>(null);const [meta,setMeta]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [stage,setStage]=useState('');
 function accept(output:AnalysisResult){setResult(output);onAnalysis?.(output)}
 async function analyzeRepo(){setBusy(true);setStage('Downloading and inspecting repository source…');setError('');setResult(null);setMeta('');try{const response=await fetch('/api/analyze/repo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:repoUrl.trim()})});const data=await response.json() as RepoResponse;if(!response.ok||!data.result)throw new Error(data.error||'Repository analysis failed.');accept(data.result);setMeta(`${data.repository?.owner}/${data.repository?.name} · ${data.repository?.defaultBranch} · ${data.inspectedTextFiles} text files · ${bytesLabel(data.inspectedTextBytes)}`)}catch(e){setError(e instanceof Error?e.message:'Repository analysis failed.')}finally{setBusy(false);setStage('')}}
 async function handleFile(file?:File){if(!file)return;setBusy(true);setError('');setResult(null);setMeta('');try{if(!/\.(zip|apk|aab)$/i.test(file.name))throw new Error('Choose a source ZIP, APK, or AAB file.');setStage(/\.(apk|aab)$/i.test(file.name)?'Decoding compiled Android package locally…':'Inspecting source archive locally…');const output=await analyzeLocalArchive(file);accept(output);setMeta(`${file.name} · ${bytesLabel(file.size)} · deep local browser inspection`)}catch(e){setError(e instanceof Error?e.message:'Local analysis failed.')}finally{setBusy(false);setStage('')}}
 return <div className="analyzerShell"><section className="inputPanel"><div className="inputCard"><span className="eyebrow">Option 1</span><h2>Analyze a public GitHub repository</h2><p>Paste the repository URL. The server inspects Android build files, manifest declarations, SDK integrations, network hosts, assets, privacy clues, and credential-risk indicators.</p><div className="row"><input value={repoUrl} onChange={e=>setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repository" aria-label="Public GitHub repository URL"/><button onClick={analyzeRepo} disabled={busy||!repoUrl.trim()}>{busy?'Analyzing…':'Analyze repo'}</button></div><small>Public repositories only. Private repositories can be exported as a source ZIP and analyzed below.</small></div><div className="inputCard"><span className="eyebrow">Option 2</span><h2>Deep-inspect an APK or AAB</h2><p>The compiled package is parsed locally in your browser. The inspector decodes Android metadata such as package/version, SDK levels, permissions, components, native ABI, resources, framework and signing evidence when available.</p><label className="uploadButton"><input type="file" accept=".zip,.apk,.aab,application/zip,application/vnd.android.package-archive" onChange={e=>handleFile(e.target.files?.[0])}/>Choose APK, AAB or source ZIP</label><small>Local build files are not uploaded to our server. Browser safety limit: 500 MB.</small></div></section>{meta&&<p className="metaLine">{meta}</p>}{error&&<div className="errorBox" role="alert">{error}</div>}{busy&&<div className="loadingBox">{stage||'Inspecting evidence…'} Anything that cannot be proved remains unknown.</div>}{result&&<ResultPanel result={result}/>}</div>;
}
