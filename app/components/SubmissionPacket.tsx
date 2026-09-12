'use client';

import { useMemo } from 'react';
import type { AnalysisResult } from '../../lib/play-analyzer';

type Props={analysis:AnalysisResult};
type Plan=AnalysisResult['listingPlan'] & {fullDescription?:string};

function download(name:string, content:string, type='text/plain'){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}

function copy(value:string){void navigator.clipboard?.writeText(value)}

export default function SubmissionPacket({analysis}:Props){
  const plan=analysis.listingPlan as Plan;
  const blockers=analysis.findings.filter(f=>f.severity==='BLOCKING');
  const required=analysis.findings.filter(f=>f.severity==='REQUIRED_INPUT');
  const risks=analysis.findings.filter(f=>f.severity==='REVIEW_RISK');
  const supported=plan.verifiedThemes;
  const listingReady=Boolean(plan.title&&plan.shortDescription&&plan.fullDescription&&blockers.length===0);
  const dataSignals=useMemo(()=>{
    const out:string[]=[];
    const sdk=analysis.sdkSignals.join(' ').toLowerCase();
    if(/admob|ads/.test(sdk))out.push('Advertising SDK signal detected — verify Ads declaration and ad-related data collection.');
    if(/analytics|appsflyer|adjust/.test(sdk))out.push('Analytics SDK signal detected — verify collected identifiers/events, purposes, retention and sharing.');
    if(/authentication|sign-in/.test(sdk))out.push('Authentication signal detected — verify account identifiers and account/data deletion flow.');
    if(/openai|gemini|hugging face|retrofit|okhttp/.test(sdk)||analysis.remoteHosts.length)out.push('Remote service signal detected — identify exactly what user data leaves the device and why.');
    if(analysis.permissions.some(p=>p.includes('LOCATION')))out.push('Location permission detected — document approximate/precise/background use and whether it is optional.');
    if(analysis.permissions.includes('android.permission.CAMERA'))out.push('Camera permission detected — document the user-facing feature and whether images leave the device.');
    if(analysis.permissions.includes('android.permission.RECORD_AUDIO'))out.push('Microphone permission detected — document the user-facing feature, storage/transmission and retention.');
    return out;
  },[analysis]);

  const packet={
    generatedAt:new Date().toISOString(),
    app:analysis.app,
    sourceType:analysis.sourceType,
    releaseDecision:blockers.length?'BLOCKED':required.length?'NEEDS_INPUT':'PREPARE_FOR_FINAL_VALIDATION',
    verifiedFacts:analysis.verifiedFacts,
    listing:{title:plan.title??null,shortDescription:plan.shortDescription??null,fullDescription:plan.fullDescription??null,supportedThemes:supported},
    blockers,
    requiredInput:required,
    reviewRisks:risks,
    sensitivePermissions:analysis.sensitivePermissions,
    dataSafetyInvestigation:dataSignals,
    developerQuestions:analysis.questions,
    screenshotPlan:plan.screenshotPlan,
    limitations:analysis.limitations,
  };

  return <section className="submissionPacket">
    <div className="packetHeader"><div><span className="eyebrow">Generated from this analysis</span><h2>Play submission packet</h2><p>The assistant has turned the inspected evidence into concrete release work. Claims that are not supported remain excluded.</p></div><button className="primaryButton" onClick={()=>download(`${analysis.app.packageName||'android-app'}-submission-packet.json`,JSON.stringify(packet,null,2),'application/json')}>Download packet</button></div>

    <div className="summaryGrid">
      <div className="summaryCard"><span>Release decision</span><strong>{packet.releaseDecision}</strong></div>
      <div className="summaryCard"><span>Hard blockers</span><strong>{blockers.length}</strong></div>
      <div className="summaryCard"><span>Required answers</span><strong>{required.length+analysis.questions.length}</strong></div>
      <div className="summaryCard"><span>Supported listing themes</span><strong>{supported.length}</strong></div>
    </div>

    <div className="twoCol">
      <article className="resultCard"><h3>Evidence-backed Play listing draft</h3>
        {plan.title?<><label>Title</label><div className="copyBox"><span>{plan.title}</span><button onClick={()=>copy(plan.title!)}>Copy</button></div></>:<p className="muted">App title was not established.</p>}
        {plan.shortDescription?<><label>Short description</label><div className="copyBox"><span>{plan.shortDescription}</span><button onClick={()=>copy(plan.shortDescription!)}>Copy</button></div></>:<div className="warningBox">No short description was generated because the scan did not establish enough corroborated user-facing functionality.</div>}
        {plan.fullDescription?<><label>Full description</label><div className="listingDraft"><pre>{plan.fullDescription}</pre><button onClick={()=>copy(plan.fullDescription!)}>Copy full description</button></div></>:<div className="warningBox">No full description was generated. The assistant will not turn inferred functionality into store claims.</div>}
        {supported.length>0&&<><h4>Claims supported by source evidence</h4><ul>{supported.map(x=><li key={x}>{x}</li>)}</ul></>}
        <p className="truthNote">Generated copy is a draft for the inspected release. Recheck it against the final runtime build before publishing.</p>
      </article>

      <article className="resultCard"><h3>What must be fixed or supplied</h3>
        {blockers.length===0&&required.length===0?<div className="successBox">No static blocker or required-input finding remains from this scan.</div>:null}
        {blockers.length>0&&<><h4>Blockers</h4><ol>{blockers.map(x=><li key={x.title}><strong>{x.title}:</strong> {x.detail}</li>)}</ol></>}
        {required.length>0&&<><h4>Missing evidence / input</h4><ol>{required.map(x=><li key={x.title}><strong>{x.title}:</strong> {x.detail}</li>)}</ol></>}
        {analysis.questions.length>0&&<><h4>Questions only the developer can answer safely</h4><ol>{analysis.questions.map(x=><li key={x}>{x}</li>)}</ol></>}
      </article>
    </div>

    <div className="twoCol">
      <article className="resultCard"><h3>Data Safety investigation</h3>{dataSignals.length?<ul>{dataSignals.map(x=><li key={x}>{x}</li>)}</ul>:<p className="muted">No obvious ads/analytics/auth/remote/location/camera/microphone signal was established. This does not prove that no data is collected.</p>}<p className="truthNote">These are evidence tasks, not final Data Safety answers. Backend and SDK runtime behavior must be confirmed.</p></article>
      <article className="resultCard"><h3>Screenshot production plan</h3><ol>{plan.screenshotPlan.map(x=><li key={x}>{x}</li>)}</ol><p className="truthNote">Use screenshots of the real release. Never depict a feature that is unavailable to users.</p></article>
    </div>

    {risks.length>0&&<article className="resultCard"><h3>Google Play review risks to investigate</h3><ul>{risks.map(x=><li key={x.title}><strong>{x.title}:</strong> {x.detail}</li>)}</ul></article>}
    <div className={listingReady?'successBox':'warningBox'}>{listingReady?'The static evidence supports a complete listing draft and no hard blocker is currently present. Continue through Data Safety, Play Console declarations, testing, reviewer access and final release validation.':'This release is not ready to call submission-ready yet. Resolve the blockers/unknowns above rather than filling gaps with assumptions.'}</div>
  </section>;
}
