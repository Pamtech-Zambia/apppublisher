import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { inspectPublicRepository } from '../../../lib/repository-inspector';

const AUTHORITATIVE = new Set(['COMPILED_EVIDENCE', 'SOURCE_EVIDENCE', 'RUNTIME_EVIDENCE', 'PLAY_STATE_EVIDENCE']);
const HIGH_IMPACT = new Set(['privacy', 'security', 'data-safety', 'affiliation', 'audience', 'policy']);

type Evidence = { strength: string; source: string; detail: string; supports: boolean };
type Claim = { claim: string; claimType: string; evidence: Evidence[]; developerConfirmed?: boolean; prohibitedByPolicy?: boolean };

function text(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }; }

function evaluateClaim(claim: Claim) {
  if (claim.prohibitedByPolicy) return { ...claim, status: 'PROHIBITED', publishable: false, reason: 'Current policy marks this claim/use as prohibited.' };
  const contradictedBy = claim.evidence.filter((e) => !e.supports && AUTHORITATIVE.has(e.strength));
  if (contradictedBy.length) return { ...claim, status: 'CONTRADICTED', publishable: false, reason: `Contradicted by ${contradictedBy.map((e) => e.source).join(', ')}.` };
  const verifiedBy = claim.evidence.filter((e) => e.supports && AUTHORITATIVE.has(e.strength));
  if (verifiedBy.length) return { ...claim, status: 'VERIFIED', publishable: true, reason: `Verified by ${verifiedBy.map((e) => e.source).join(', ')}.` };
  if (claim.developerConfirmed) {
    if (HIGH_IMPACT.has(claim.claimType) && claim.evidence.length === 0) return { ...claim, status: 'UNVERIFIED', publishable: false, reason: 'High-impact claims require evidence, not confirmation alone.' };
    return { ...claim, status: 'DEVELOPER_CONFIRMED', publishable: true, reason: 'Developer-confirmed and not contradicted by known evidence.' };
  }
  return { ...claim, status: 'UNVERIFIED', publishable: false, reason: 'No authoritative supporting evidence is available.' };
}

const evidenceSchema = z.object({
  strength: z.enum(['COMPILED_EVIDENCE','SOURCE_EVIDENCE','RUNTIME_EVIDENCE','PLAY_STATE_EVIDENCE','DEVELOPER_CONFIRMED','INFERRED','UNKNOWN']),
  source: z.string().min(1), detail: z.string().min(1), supports: z.boolean(),
});
const claimSchema = z.object({
  claim: z.string().min(1),
  claimType: z.enum(['feature','privacy','security','data-safety','affiliation','performance','audience','policy','other']),
  evidence: z.array(evidenceSchema), developerConfirmed: z.boolean().optional(), prohibitedByPolicy: z.boolean().optional(),
});
const readOnlyClosed = { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false } as const;
const readOnlyOpen = { readOnlyHint: true, idempotentHint: true, openWorldHint: true, destructiveHint: false } as const;

function rejectionCategory(notice: string) {
  const t = notice.toLowerCase();
  if (/data safety|data collection|data shared/.test(t)) return { category: 'Data Safety / privacy', action: 'Compare the notice with SDK/runtime evidence, privacy policy, and Data Safety answers. Correct the underlying mismatch before resubmission.' };
  if (/permission|sms|call log|background location|accessibility/.test(t)) return { category: 'Sensitive permission', action: 'Identify the exact permission, prove the qualifying core use case or remove it, then update declarations/evidence.' };
  if (/target api|target sdk/.test(t)) return { category: 'Target API', action: 'Update the release build to the required target API unless an applicable current exception/extension exists.' };
  if (/metadata|description|screenshot|icon|store listing/.test(t)) return { category: 'Store metadata', action: 'Find the unsupported or misleading asset/claim, align it with actual functionality, and replace it with truthful metadata.' };
  if (/deceptive|misleading|hidden|review|behavior/.test(t)) return { category: 'Deceptive behavior / review integrity', action: 'Do not hide functionality or create reviewer-only behavior. Correct product behavior and declarations, then provide factual evidence.' };
  if (/app access|login|credential/.test(t)) return { category: 'App access', action: 'Provide working reviewer instructions/credentials for the actual production-like app experience.' };
  return { category: 'Needs policy mapping', action: 'Preserve the exact notice, identify the policy/category, affected release and evidence before deciding on a fix or appeal.' };
}

const handler = createMcpHandler((server) => {
  server.registerTool('play_connector_status', {
    title: 'Google Play Deployment Assistant status',
    description: 'Shows website/plugin parity and public safety boundaries.',
    annotations: readOnlyClosed,
  }, async () => text({ service:'Google Play Deployment Assistant', version:'0.6.0', mode:'public-assistant', websiteAndPluginParity:true, googlePlayWrites:false, productionPublishing:false, truthfulnessGate:true, principle:'Inspect first. Suggest second. Ask only for unresolved facts. Never invent app behavior or declarations.' }));

  server.registerTool('play_analyze_public_repository', {
    title: 'Analyze a public Android GitHub repository',
    description: 'Inspects a public GitHub repository for Android build identity, SDK levels, permissions, integrations, privacy clues, assets, blockers, questions, and listing suggestions. Inference is kept separate from verified evidence.',
    inputSchema: z.object({ repositoryUrl: z.string().url() }),
    annotations: readOnlyOpen,
  }, async ({repositoryUrl}) => text(await inspectPublicRepository(repositoryUrl)));

  server.registerTool('play_store_listing_validate', {
    title:'Validate Play Store listing', description:'Checks baseline metadata lengths and flags risky claims that require evidence.',
    inputSchema:z.object({title:z.string(),shortDescription:z.string(),fullDescription:z.string()}), annotations:readOnlyClosed,
  }, async ({title,shortDescription,fullDescription})=>{const errors:string[]=[];const warnings:string[]=[];if(title.length<1||title.length>30)errors.push('Title must be 1-30 characters.');if(shortDescription.length<1||shortDescription.length>80)errors.push('Short description must be 1-80 characters.');if(fullDescription.length<1||fullDescription.length>4000)errors.push('Full description must be 1-4000 characters.');const combined=`${title} ${shortDescription} ${fullDescription}`;if(/#1|number\s*1|best app|guaranteed|official|100% secure|bank.?grade|completely offline/i.test(combined))warnings.push('Potential ranking, affiliation, guarantee, security, or absolute-functionality claim detected; require evidence before publishing.');return text({valid:errors.length===0,errors,warnings,truthRule:'Passing metadata checks does not verify that claims are true.'});});

  server.registerTool('play_claims_evaluate', {
    title:'Evaluate Play claims against evidence', description:'Blocks unsupported, contradicted, or prohibited claims from publishable metadata.',
    inputSchema:z.object({claims:z.array(claimSchema).min(1).max(300)}), annotations:readOnlyClosed,
  }, async ({claims})=>{const evaluated=claims.map(c=>evaluateClaim(c as Claim));const blockers=evaluated.filter(c=>c.status==='CONTRADICTED'||c.status==='PROHIBITED');const unresolved=evaluated.filter(c=>c.status==='UNVERIFIED');return text({evaluated,blockers,unresolved,readyForMetadataUse:blockers.length===0&&unresolved.length===0});});

  server.registerTool('play_inspection_suggestions', {
    title:'Suggest Play deployment work from inspected facts', description:'Turns inspected app facts into blockers, required inputs, and recommendations without guessing.',
    inputSchema:z.object({packageName:z.string().optional(),appName:z.string().optional(),targetSdk:z.number().int().positive().optional(),hasAab:z.boolean().optional(),hasPrivacyPolicy:z.boolean().optional(),hasRealScreenshots:z.boolean().optional(),hasPlayIcon:z.boolean().optional(),requiresLogin:z.boolean().optional(),hasReviewerAccess:z.boolean().optional(),detectedAdsSdk:z.boolean().optional(),detectedAnalyticsSdk:z.boolean().optional(),requestedSensitivePermissions:z.array(z.string()).optional()}), annotations:readOnlyClosed,
  }, async facts=>{const blockers:string[]=[];const requiredInput:string[]=[];const recommendations:string[]=[];if(facts.targetSdk!=null&&facts.targetSdk<36)blockers.push('For standard mobile new apps/updates from 2026-08-31, verify/update target SDK against the current Google Play requirement before submission.');if(facts.hasAab===false)blockers.push('No Android App Bundle is available for the release.');if(facts.hasPrivacyPolicy===false)requiredInput.push('Privacy policy is missing or not established.');if(facts.requiresLogin&&facts.hasReviewerAccess===false)blockers.push('App requires login but reviewer-access instructions/credentials are not established.');if(facts.hasRealScreenshots===false)recommendations.push('Capture real app UI screenshots; do not fabricate application screens.');if(facts.hasPlayIcon===false)recommendations.push('Prepare and validate a Google Play icon.');if(facts.detectedAdsSdk)requiredInput.push('Verify Ads declaration and Data Safety behavior from actual SDK/runtime evidence.');if(facts.detectedAnalyticsSdk)requiredInput.push('Verify analytics collection/sharing for Data Safety and privacy disclosures.');if(facts.requestedSensitivePermissions?.length)blockers.push(`Sensitive permissions require current-policy/use-case review: ${facts.requestedSensitivePermissions.join(', ')}`);return text({decision:blockers.length?'BLOCKED':requiredInput.length?'NEEDS_INPUT':'PREPARE_FOR_VALIDATION',blockers,requiredInput,recommendations,principle:'Do not infer declarations or claims merely to make the checklist green.'});});

  server.registerTool('play_app_evidence_summary', {
    title:'Build app evidence summary', description:'Separates verified app facts from inferred features and unresolved facts.',
    inputSchema:z.object({packageName:z.string().optional(),versionName:z.string().optional(),versionCode:z.number().int().optional(),minSdk:z.number().int().optional(),targetSdk:z.number().int().optional(),permissions:z.array(z.string()).default([]),dependencies:z.array(z.string()).default([]),observedFeatures:z.array(z.string()).default([]),inferredFeatures:z.array(z.string()).default([]),unknowns:z.array(z.string()).default([])}), annotations:readOnlyClosed,
  }, async facts=>text({verifiedFacts:{packageName:facts.packageName,versionName:facts.versionName,versionCode:facts.versionCode,minSdk:facts.minSdk,targetSdk:facts.targetSdk,permissions:facts.permissions,dependencies:facts.dependencies,observedFeatures:facts.observedFeatures},inferredOnly:facts.inferredFeatures,unknowns:facts.unknowns,publishRule:'Inferred-only features are suggestions, not publishable claims, until corroborated.'}));

  server.registerTool('play_data_safety_questions', {
    title:'Prepare Data Safety evidence questions', description:'Builds an evidence questionnaire from known app behaviors without inventing Data Safety answers.',
    inputSchema:z.object({ads:z.boolean().default(false),analytics:z.boolean().default(false),authentication:z.boolean().default(false),remoteApisOrAi:z.boolean().default(false),location:z.boolean().default(false),health:z.boolean().default(false),financial:z.boolean().default(false),accountDeletionEstablished:z.boolean().default(false)}), annotations:readOnlyClosed,
  }, async f=>{const questions:string[]=[];if(f.ads)questions.push('What ad SDK is used, what identifiers/data does it collect, and is advertising personalized?');if(f.analytics)questions.push('What analytics data and identifiers are collected, retained, or shared?');if(f.authentication)questions.push('What account identifiers are processed and can users delete accounts/data?');if(f.remoteApisOrAi)questions.push('What user data is sent to remote APIs/AI services and why?');if(f.location)questions.push('Is location approximate/precise/background, optional or required, and what feature needs it?');if(f.health)questions.push('Which health data types are handled and which current Google Play health requirements apply?');if(f.financial)questions.push('What financial functionality/data is handled and which declaration applies?');const blockers=[] as string[];if(f.authentication&&!f.accountDeletionEstablished)blockers.push('Account functionality is present but the account/data deletion mechanism is not established.');return text({questions,blockers,rule:'Data Safety must reflect actual production collection, sharing, processing, retention, and SDK behavior.'});});

  server.registerTool('play_policy_readiness', {
    title:'Check Play policy readiness inputs', description:'Evaluates target SDK, privacy, reviewer access, declarations, and testing readiness without claiming Google approval.',
    inputSchema:z.object({targetSdk:z.number().int().optional(),privacyPolicyConfirmed:z.boolean().default(false),requiresLogin:z.boolean().default(false),reviewerAccessConfirmed:z.boolean().default(false),targetAudienceReviewed:z.boolean().default(false),contentRatingReviewed:z.boolean().default(false),testingRequirementReviewed:z.boolean().default(false)}), annotations:readOnlyClosed,
  }, async f=>{const blockers:string[]=[];if(f.targetSdk!=null&&f.targetSdk<36)blockers.push('Standard mobile new apps/updates should be checked against the API 36 submission baseline effective 2026-08-31.');if(!f.privacyPolicyConfirmed)blockers.push('Public privacy-policy status is not confirmed.');if(f.requiresLogin&&!f.reviewerAccessConfirmed)blockers.push('Login is required but reviewer access is not confirmed.');if(!f.targetAudienceReviewed)blockers.push('Target audience/content declaration is not confirmed.');if(!f.contentRatingReviewed)blockers.push('Content rating/applicable declarations are not confirmed.');if(!f.testingRequirementReviewed)blockers.push('Testing/production-access requirements are not confirmed.');return text({readyForFinalValidation:blockers.length===0,blockers,caveat:'Recheck current Google Play policy immediately before submission; this does not predict Google’s proprietary review outcome.'});});

  server.registerTool('play_rejection_triage', {
    title:'Triage a Google Play rejection notice', description:'Classifies an exact rejection notice and suggests a truth-preserving remediation path.',
    inputSchema:z.object({notice:z.string().min(1)}), annotations:readOnlyClosed,
  }, async ({notice})=>text({...rejectionCategory(notice),rule:'Preserve the exact notice. Fix the underlying product/declaration problem; never hide functionality or falsify information to pass review.'}));

  server.registerTool('play_creative_asset_plan', {
    title:'Prepare truthful Play creative assets', description:'Returns Google Play asset preparation guidance. Screenshots representing app functionality must come from real app UI.',
    inputSchema:z.object({appName:z.string().min(1),hasApprovedLogo:z.boolean().default(false),hasRealScreenshots:z.boolean().default(false),screenshotCount:z.number().int().nonnegative().default(0),tagline:z.string().optional()}), annotations:readOnlyClosed,
  }, async f=>text({icon:{size:'512x512',action:f.hasApprovedLogo?'Adapt the approved logo without inventing branding.':'Create an original simple app icon concept; do not imitate another brand.'},featureGraphic:{size:'1024x500',tagline:f.tagline||'Use only a concise, verified value proposition.'},screenshots:{sourceRequired:'Real app UI',status:f.hasRealScreenshots?'Real screenshot source available.':'Real screenshots are still required.',recommendedSet:f.screenshotCount>=4?'Existing set can be reviewed for truthfulness and quality.':'Capture several real primary user journeys.'},rule:'Never generate fake UI or future functionality and present it as a screenshot.'}));

  server.registerTool('play_release_readiness', {
    title:'Check release preparation', description:'Checks material release prerequisites before a Google Play validation/commit step.',
    inputSchema:z.object({aabMatchesSource:z.boolean(),versionCodeIncreased:z.boolean(),targetSdkCurrent:z.boolean(),signingConfirmed:z.boolean(),listingTruthful:z.boolean(),screenshotsReal:z.boolean(),privacyAndDataSafetyAligned:z.boolean(),sensitivePermissionsResolved:z.boolean(),reviewerAccessReady:z.boolean(),testingRequirementsSatisfied:z.boolean(),declarationsComplete:z.boolean(),materialClaimsResolved:z.boolean()}), annotations:readOnlyClosed,
  }, async f=>{const labels:Record<string,string>={aabMatchesSource:'AAB/source correspondence',versionCodeIncreased:'Version code progression',targetSdkCurrent:'Target SDK requirement',signingConfirmed:'Signing / Play App Signing',listingTruthful:'Truthful store listing',screenshotsReal:'Real screenshots',privacyAndDataSafetyAligned:'Privacy/Data Safety alignment',sensitivePermissionsResolved:'Sensitive permissions',reviewerAccessReady:'Reviewer access',testingRequirementsSatisfied:'Testing/production access',declarationsComplete:'Play declarations',materialClaimsResolved:'Unresolved material claims'};const unresolved=Object.entries(f).filter(([,v])=>!v).map(([k])=>labels[k]||k);return text({readyForPlayEditValidation:unresolved.length===0,unresolved,rule:'Do not commit/publish while known blockers or unresolved material claims remain.'});});
});

export { handler as GET, handler as POST, handler as DELETE };
