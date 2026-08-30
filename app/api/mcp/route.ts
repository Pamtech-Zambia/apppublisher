import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

const AUTHORITATIVE = new Set(['COMPILED_EVIDENCE', 'SOURCE_EVIDENCE', 'RUNTIME_EVIDENCE', 'PLAY_STATE_EVIDENCE']);
const HIGH_IMPACT = new Set(['privacy', 'security', 'data-safety', 'affiliation', 'audience', 'policy']);

type Evidence = { strength: string; source: string; detail: string; supports: boolean };
type Claim = { claim: string; claimType: string; evidence: Evidence[]; developerConfirmed?: boolean; prohibitedByPolicy?: boolean };

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function evaluateClaim(claim: Claim) {
  if (claim.prohibitedByPolicy) {
    return { ...claim, status: 'PROHIBITED', publishable: false, reason: 'Current policy marks this claim/use as prohibited.' };
  }
  const contradictedBy = claim.evidence.filter((e) => !e.supports && AUTHORITATIVE.has(e.strength));
  if (contradictedBy.length) {
    return { ...claim, status: 'CONTRADICTED', publishable: false, reason: `Contradicted by ${contradictedBy.map((e) => e.source).join(', ')}.` };
  }
  const verifiedBy = claim.evidence.filter((e) => e.supports && AUTHORITATIVE.has(e.strength));
  if (verifiedBy.length) {
    return { ...claim, status: 'VERIFIED', publishable: true, reason: `Verified by ${verifiedBy.map((e) => e.source).join(', ')}.` };
  }
  if (claim.developerConfirmed) {
    if (HIGH_IMPACT.has(claim.claimType) && claim.evidence.length === 0) {
      return { ...claim, status: 'UNVERIFIED', publishable: false, reason: 'High-impact claims require evidence, not confirmation alone.' };
    }
    return { ...claim, status: 'DEVELOPER_CONFIRMED', publishable: true, reason: 'Developer-confirmed and not contradicted by known evidence.' };
  }
  return { ...claim, status: 'UNVERIFIED', publishable: false, reason: 'No authoritative supporting evidence is available.' };
}

const evidenceSchema = z.object({
  strength: z.enum(['COMPILED_EVIDENCE', 'SOURCE_EVIDENCE', 'RUNTIME_EVIDENCE', 'PLAY_STATE_EVIDENCE', 'DEVELOPER_CONFIRMED', 'INFERRED', 'UNKNOWN']),
  source: z.string().min(1),
  detail: z.string().min(1),
  supports: z.boolean(),
});

const claimSchema = z.object({
  claim: z.string().min(1),
  claimType: z.enum(['feature', 'privacy', 'security', 'data-safety', 'affiliation', 'performance', 'audience', 'policy', 'other']),
  evidence: z.array(evidenceSchema),
  developerConfirmed: z.boolean().optional(),
  prohibitedByPolicy: z.boolean().optional(),
});

const handler = createMcpHandler((server) => {
  server.registerTool('play_connector_status', {
    title: 'Google Play Deployment Assistant status',
    description: 'Shows public test mode and safety boundaries.',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
  }, async () => text({
    service: 'Google Play Deployment Assistant',
    version: '0.5.1-test',
    mode: 'public-assistant-test',
    googlePlayWrites: false,
    productionPublishing: false,
    truthfulnessGate: true,
    principle: 'Inspect first. Suggest second. Ask only for unresolved facts. Never invent app behavior or declarations.',
  }));

  server.registerTool('play_store_listing_validate', {
    title: 'Validate Play Store listing',
    description: 'Checks baseline metadata lengths and flags claims that require evidence.',
    inputSchema: z.object({ title: z.string(), shortDescription: z.string(), fullDescription: z.string() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
  }, async ({ title, shortDescription, fullDescription }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (title.length < 1 || title.length > 30) errors.push('Title must be 1-30 characters.');
    if (shortDescription.length < 1 || shortDescription.length > 80) errors.push('Short description must be 1-80 characters.');
    if (fullDescription.length < 1 || fullDescription.length > 4000) errors.push('Full description must be 1-4000 characters.');
    const combined = `${title} ${shortDescription} ${fullDescription}`;
    if (/#1|number\s*1|best app|guaranteed|official/i.test(combined)) {
      warnings.push('Potentially unsupported ranking, superiority, guarantee, or affiliation claim detected; require evidence before publishing.');
    }
    return text({ valid: errors.length === 0, errors, warnings, truthRule: 'Passing metadata checks does not verify that claims are true.' });
  });

  server.registerTool('play_claims_evaluate', {
    title: 'Evaluate Play claims against evidence',
    description: 'Blocks unsupported, contradicted, or prohibited claims from publishable metadata.',
    inputSchema: z.object({ claims: z.array(claimSchema).min(1).max(300) }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
  }, async ({ claims }) => {
    const evaluated = claims.map((c) => evaluateClaim(c as Claim));
    const blockers = evaluated.filter((c) => c.status === 'CONTRADICTED' || c.status === 'PROHIBITED');
    const unresolved = evaluated.filter((c) => c.status === 'UNVERIFIED');
    return text({ evaluated, blockers, unresolved, readyForMetadataUse: blockers.length === 0 && unresolved.length === 0 });
  });

  server.registerTool('play_inspection_suggestions', {
    title: 'Suggest Play deployment work from inspected facts',
    description: 'Turns inspected app facts into blockers, required inputs, and recommendations without guessing.',
    inputSchema: z.object({
      packageName: z.string().optional(),
      appName: z.string().optional(),
      targetSdk: z.number().int().positive().optional(),
      hasAab: z.boolean().optional(),
      hasPrivacyPolicy: z.boolean().optional(),
      hasRealScreenshots: z.boolean().optional(),
      hasPlayIcon: z.boolean().optional(),
      requiresLogin: z.boolean().optional(),
      hasReviewerAccess: z.boolean().optional(),
      detectedAdsSdk: z.boolean().optional(),
      detectedAnalyticsSdk: z.boolean().optional(),
      requestedSensitivePermissions: z.array(z.string()).optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
  }, async (facts) => {
    const blockers: string[] = [];
    const requiredInput: string[] = [];
    const recommendations: string[] = [];
    if (facts.targetSdk != null && facts.targetSdk < 36) blockers.push('For standard mobile new apps/updates from 2026-08-31, verify/update target SDK against the current Google Play requirement before submission.');
    if (facts.hasAab === false) blockers.push('No Android App Bundle is available for the release.');
    if (facts.hasPrivacyPolicy === false) requiredInput.push('Privacy policy is missing or not established.');
    if (facts.requiresLogin && facts.hasReviewerAccess === false) blockers.push('App requires login but reviewer-access instructions/credentials are not established.');
    if (facts.hasRealScreenshots === false) recommendations.push('Capture real app UI screenshots; do not fabricate application screens.');
    if (facts.hasPlayIcon === false) recommendations.push('Prepare and validate a Google Play icon.');
    if (facts.detectedAdsSdk) requiredInput.push('Verify Ads declaration and Data Safety behavior from actual SDK/runtime evidence.');
    if (facts.detectedAnalyticsSdk) requiredInput.push('Verify analytics collection/sharing for Data Safety and privacy disclosures.');
    if (facts.requestedSensitivePermissions?.length) blockers.push(`Sensitive permissions require current-policy/use-case review: ${facts.requestedSensitivePermissions.join(', ')}`);
    return text({
      decision: blockers.length ? 'BLOCKED' : requiredInput.length ? 'NEEDS_INPUT' : 'PREPARE_FOR_VALIDATION',
      blockers,
      requiredInput,
      recommendations,
      principle: 'Do not infer declarations or claims merely to make the checklist green.',
    });
  });

  server.registerTool('play_app_evidence_summary', {
    title: 'Build app evidence summary',
    description: 'Separates verified app facts from inferred features and unresolved facts.',
    inputSchema: z.object({
      packageName: z.string().optional(),
      versionName: z.string().optional(),
      versionCode: z.number().int().optional(),
      minSdk: z.number().int().optional(),
      targetSdk: z.number().int().optional(),
      permissions: z.array(z.string()).default([]),
      dependencies: z.array(z.string()).default([]),
      observedFeatures: z.array(z.string()).default([]),
      inferredFeatures: z.array(z.string()).default([]),
      unknowns: z.array(z.string()).default([]),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
  }, async (facts) => text({
    verifiedFacts: {
      packageName: facts.packageName,
      versionName: facts.versionName,
      versionCode: facts.versionCode,
      minSdk: facts.minSdk,
      targetSdk: facts.targetSdk,
      permissions: facts.permissions,
      dependencies: facts.dependencies,
      observedFeatures: facts.observedFeatures,
    },
    inferredOnly: facts.inferredFeatures,
    unknowns: facts.unknowns,
    publishRule: 'Inferred-only features are suggestions, not publishable claims, until corroborated.',
  }));
});

export { handler as GET, handler as POST, handler as DELETE };
