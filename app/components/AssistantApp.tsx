'use client';

import { useState } from 'react';
import Analyzer from './Analyzer';
import PluginWorkspace from './PluginWorkspace';
import type { AnalysisResult } from '../../lib/play-analyzer';

export default function AssistantApp(){
  const [analysis,setAnalysis]=useState<AnalysisResult|null>(null);
  const key=[analysis?.app.packageName,analysis?.app.versionCode,analysis?.sourceType,analysis?.verifiedFacts.length].filter(Boolean).join(':')||'empty';
  return <>
    <Analyzer onAnalysis={setAnalysis}/>
    <PluginWorkspace key={key} analysis={analysis}/>
  </>;
}
