'use client';

import { useState } from 'react';
import Analyzer from './Analyzer';
import PluginWorkspace from './PluginWorkspace';
import SubmissionPacket from './SubmissionPacket';
import type { AnalysisResult } from '../../lib/play-analyzer';

export default function AssistantApp(){
  const [analysis,setAnalysis]=useState<AnalysisResult|null>(null);
  const [generation,setGeneration]=useState(0);

  function accept(result:AnalysisResult){
    setAnalysis(result);
    setGeneration(value=>value+1);
  }

  return <>
    <Analyzer onAnalysis={accept}/>
    {analysis&&<SubmissionPacket key={`packet-${generation}`} analysis={analysis}/>} 
    <PluginWorkspace key={`workspace-${generation}`} analysis={analysis}/>
  </>;
}
