import type { AnalysisResult, Finding } from './play-analyzer';

const SENSITIVE = new Set([
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.READ_SMS',
  'android.permission.RECEIVE_SMS',
  'android.permission.SEND_SMS',
  'android.permission.READ_CALL_LOG',
  'android.permission.WRITE_CALL_LOG',
  'android.permission.READ_CONTACTS',
  'android.permission.WRITE_CONTACTS',
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  'android.permission.BODY_SENSORS',
  'android.permission.ACTIVITY_RECOGNITION',
  'android.permission.MANAGE_EXTERNAL_STORAGE',
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.QUERY_ALL_PACKAGES',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
]);

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : undefined;
}

function get(root: unknown, ...paths: string[]): unknown {
  for (const path of paths) {
    let value: unknown = root;
    let ok = true;
    for (const part of path.split('.')) {
      const o = obj(value);
      if (!o || !(part in o)) { ok = false; break; }
      value = o[part];
    }
    if (ok && value != null) return value;
  }
}

function str(root: unknown, ...paths: string[]): string | undefined {
  const value = get(root, ...paths);
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
}

function num(root: unknown, ...paths: string[]): number | undefined {
  const value = get(root, ...paths);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
}

function bool(root: unknown, ...paths: string[]): boolean | undefined {
  const value = get(root, ...paths);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
}

function arr(root: unknown, ...paths: string[]): unknown[] {
  const value = get(root, ...paths);
  return Array.isArray(value) ? value : [];
}

function nameOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const o = obj(value);
  if (!o) return undefined;
  for (const key of ['name', 'android:name', 'androidName', 'permission', 'value']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
}

function names(root: unknown, ...paths: string[]): string[] {
  const values = arr(root, ...paths).map(nameOf).filter((x): x is string => Boolean(x));
  return [...new Set(values)];
}

function components(root: unknown, key: string): Array<{name?: string; exported?: boolean}> {
  const values = arr(root, `manifest.${key}`, key, `manifest.application.${key}`);
  return values.map((value) => {
    const o = obj(value);
    return {
      name: nameOf(value),
      exported: o ? bool(o, 'exported', 'android:exported', 'androidExported') : undefined,
    };
  });
}

function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => typeof v === 'string' ? v : nameOf(v)).filter((x): x is string => Boolean(x));
  if (typeof value === 'string') return [value];
  return [];
}

function signingSummary(root: unknown): string[] {
  const signing = get(root, 'signing');
  const s = obj(signing);
  if (!s) return [];
  const out: string[] = [];
  const fingerprint = str(s, 'sha256Fingerprint', 'sha256', 'certificate.sha256');
  if (fingerprint) out.push(`Signing certificate SHA-256: ${fingerprint}`);
  const schemeValues = get(s, 'schemes', 'signatureSchemes');
  const schemes = asStrings(schemeValues);
  if (schemes.length) out.push(`Signature scheme(s): ${schemes.join(', ')}`);
  return out;
}

export function analyzeParsedAndroid(
  parsedData: unknown,
  parserWarnings: unknown,
  sourceType: 'apk' | 'aab',
): AnalysisResult {
  const platformInfo = get(parsedData, 'platformInfo') ?? parsedData;
  const manifest = get(platformInfo, 'manifest') ?? platformInfo;

  const packageName = str(manifest, 'package', 'packageName', 'applicationId');
  const versionName = str(manifest, 'versionName', 'android:versionName');
  const versionCode = num(manifest, 'versionCode', 'android:versionCode');
  const minSdk = num(manifest, 'minSdkVersion', 'usesSdk.minSdkVersion', 'minSdk');
  const targetSdk = num(manifest, 'targetSdkVersion', 'usesSdk.targetSdkVersion', 'targetSdk');
  const appName = str(parsedData, 'name', 'appName', 'label') || str(platformInfo, 'appName', 'label') || str(manifest, 'application.label');

  const permissions = [...new Set([
    ...names(manifest, 'usesPermissions', 'uses-permissions', 'usesPermission', 'permissions'),
    ...names(platformInfo, 'permissions', 'usesPermissions'),
  ])];
  const sensitivePermissions = permissions.filter(p => SENSITIVE.has(p));

  const activityList = components(platformInfo, 'activities');
  const serviceList = components(platformInfo, 'services');
  const receiverList = components(platformInfo, 'receivers');
  const providerList = components(platformInfo, 'providers');
  const featureList = [...new Set([
    ...names(manifest, 'usesFeatures', 'uses-features', 'features'),
    ...names(platformInfo, 'usesFeatures', 'features'),
  ])];

  const nativeAbi = [...new Set(asStrings(get(platformInfo, 'nativeAbi', 'nativeAbis', 'abis')))];
  const framework = str(parsedData, 'framework', 'framework.name') || str(platformInfo, 'framework', 'framework.name');
  const signingFacts = signingSummary(platformInfo);
  const warnings = Array.isArray(parserWarnings) ? parserWarnings.map(String) : parserWarnings ? [String(parserWarnings)] : [];

  const verifiedFacts: string[] = [];
  if (packageName) verifiedFacts.push(`Compiled package/application ID: ${packageName}`);
  if (appName) verifiedFacts.push(`Compiled app label: ${appName}`);
  if (versionName) verifiedFacts.push(`Compiled version name: ${versionName}`);
  if (versionCode != null) verifiedFacts.push(`Compiled version code: ${versionCode}`);
  if (minSdk != null) verifiedFacts.push(`Compiled minimum SDK: API ${minSdk}`);
  if (targetSdk != null) verifiedFacts.push(`Compiled target SDK: API ${targetSdk}`);
  if (permissions.length) verifiedFacts.push(`${permissions.length} compiled manifest permission declaration(s) detected.`);
  if (activityList.length) verifiedFacts.push(`${activityList.length} activity component(s) detected.`);
  if (serviceList.length) verifiedFacts.push(`${serviceList.length} service component(s) detected.`);
  if (receiverList.length) verifiedFacts.push(`${receiverList.length} receiver component(s) detected.`);
  if (providerList.length) verifiedFacts.push(`${providerList.length} provider component(s) detected.`);
  if (nativeAbi.length) verifiedFacts.push(`Native ABI(s): ${nativeAbi.join(', ')}`);
  if (framework) verifiedFacts.push(`Detected framework: ${framework}`);
  verifiedFacts.push(...signingFacts);

  const findings: Finding[] = [];
  const questions: string[] = [];

  if (!packageName) findings.push({ severity: 'BLOCKING', title: 'Compiled package ID could not be decoded', detail: 'The build cannot be safely matched to a Play Console app until its package/application ID is established.' });
  if (targetSdk == null) findings.push({ severity: 'REQUIRED_INPUT', title: 'Compiled target SDK not established', detail: 'The binary parser did not expose targetSdkVersion, so the current Play target API gate cannot be proven.' });
  else if (targetSdk < 36) findings.push({ severity: 'BLOCKING', title: 'Compiled target API below current standard mobile submission baseline', detail: `This ${sourceType.toUpperCase()} targets API ${targetSdk}. Standard mobile new apps and updates submitted from 31 August 2026 require API 36 or higher unless a current applicable exception or approved extension applies.` });

  if (sensitivePermissions.length) findings.push({ severity: 'REVIEW_RISK', title: 'Policy-sensitive permissions are present in the compiled app', detail: 'These permissions are not automatically violations, but their actual user-facing use and any required Play declaration/evidence must be verified.', evidence: sensitivePermissions });

  const exported = [...activityList, ...serviceList, ...receiverList, ...providerList].filter(c => c.exported === true && c.name).map(c => c.name!);
  if (exported.length) findings.push({ severity: 'REVIEW_RISK', title: 'Exported Android components detected', detail: 'Review whether each exported component is intentionally reachable and appropriately protected.', evidence: exported.slice(0, 20) });

  const debuggable = bool(manifest, 'application.debuggable', 'debuggable');
  if (debuggable === true) findings.push({ severity: 'BLOCKING', title: 'Compiled app is debuggable', detail: 'A production Play release should not ship with android:debuggable=true.' });

  const usesCleartext = bool(manifest, 'application.usesCleartextTraffic', 'usesCleartextTraffic');
  if (usesCleartext === true) findings.push({ severity: 'REVIEW_RISK', title: 'Cleartext network traffic is allowed', detail: 'Verify whether HTTP traffic is actually required and whether sensitive data could traverse cleartext connections.' });

  if (sourceType === 'apk' && signingFacts.length === 0) findings.push({ severity: 'REVIEW_RISK', title: 'APK signing evidence was not established', detail: 'The parser did not return signing details. Verify signing with Android/Play tooling before release.' });

  if (warnings.length) findings.push({ severity: 'REVIEW_RISK', title: 'Binary parser reported warnings', detail: 'Some data was extracted on a best-effort basis. Review parser warnings before relying on affected fields.', evidence: warnings.slice(0, 20) });

  questions.push('What user data is collected, shared, retained, or transmitted by this exact production build and its SDKs?');
  questions.push('What is the intended target audience/age range?');
  questions.push('Does this release require login, and if so are reviewer access instructions ready?');
  questions.push('Are ads, subscriptions, health, financial, user-generated-content, AI, or other policy-sensitive features active in this release?');

  const iconPresent = Boolean(get(parsedData, 'icon'));
  const inferredFeatures: string[] = [];
  if (permissions.includes('android.permission.CAMERA')) inferredFeatures.push('Camera functionality may be present; a permission declaration alone does not prove the feature.');
  if (permissions.some(p => p.includes('LOCATION'))) inferredFeatures.push('Location functionality may be present; verify the actual user-facing use.');
  if (permissions.includes('android.permission.RECORD_AUDIO')) inferredFeatures.push('Microphone/audio capture functionality may be present; verify the actual user-facing use.');

  return {
    sourceType,
    app: { appName, packageName, versionName, versionCode, minSdk, targetSdk },
    verifiedFacts,
    inferredFeatures,
    permissions,
    sensitivePermissions,
    sdkSignals: framework ? [`Framework: ${framework}`] : [],
    remoteHosts: [],
    assets: {
      iconCandidates: iconPresent ? ['Embedded application icon decoded from build'] : [],
      screenshots: [],
      featureGraphics: [],
      privacyPolicyCandidates: [],
    },
    secretIndicators: { count: 0, files: [] },
    findings,
    questions,
    listingPlan: {
      title: appName?.slice(0, 30),
      verifiedThemes: [],
      inferredThemes: inferredFeatures,
      screenshotPlan: [
        'Capture the real primary/home screen from this exact release.',
        'Capture each core user workflow only after the feature is verified.',
        'Do not generate or retouch UI in a way that changes what the app actually does.',
      ],
    },
    limitations: [
      'Compiled inspection establishes manifest/build/package facts but does not prove every runtime behavior or backend data flow.',
      'Data Safety, target audience, reviewer access, account deletion, and external backend behavior still require evidence or developer confirmation.',
      sourceType === 'aab' ? 'An AAB is an upload artifact; device-specific APK behavior is ultimately generated by Google Play and may require additional device/runtime testing.' : 'APK parsing does not replace final validation with Android build/signing tools and Google Play pre-launch reports.',
    ],
  };
}
