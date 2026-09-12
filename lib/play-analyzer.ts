export type Severity = 'BLOCKING' | 'REQUIRED_INPUT' | 'REVIEW_RISK' | 'RECOMMENDATION';

export type Finding = {
  severity: Severity;
  title: string;
  detail: string;
  evidence?: string[];
};

export type AnalysisResult = {
  sourceType: 'repository' | 'source-zip' | 'apk' | 'aab' | 'unknown';
  app: {
    appName?: string;
    packageName?: string;
    versionName?: string;
    versionCode?: number;
    minSdk?: number;
    targetSdk?: number;
    compileSdk?: number;
  };
  verifiedFacts: string[];
  inferredFeatures: string[];
  permissions: string[];
  sensitivePermissions: string[];
  sdkSignals: string[];
  remoteHosts: string[];
  assets: {
    iconCandidates: string[];
    screenshots: string[];
    featureGraphics: string[];
    privacyPolicyCandidates: string[];
  };
  secretIndicators: { count: number; files: string[] };
  findings: Finding[];
  questions: string[];
  listingPlan: {
    title?: string;
    shortDescription?: string;
    verifiedThemes: string[];
    inferredThemes: string[];
    screenshotPlan: string[];
  };
  limitations: string[];
};

const TEXT_EXTENSIONS = new Set([
  '.gradle', '.kts', '.xml', '.kt', '.java', '.properties', '.json', '.yaml', '.yml', '.toml', '.md', '.txt', '.js', '.ts', '.tsx', '.jsx', '.dart', '.html', '.css', '.pro', '.cfg', '.conf', '.env.example'
]);

const sensitivePermissions = new Set([
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

const sdkPatterns: Array<[string, RegExp]> = [
  ['Firebase Analytics', /firebase-(analytics|bom)|com\.google\.firebase:firebase-analytics/i],
  ['Firebase Authentication', /firebase-auth|com\.google\.firebase:firebase-auth/i],
  ['Firebase Crashlytics', /firebase-crashlytics|com\.google\.firebase:firebase-crashlytics/i],
  ['Firebase Firestore', /firebase-firestore|com\.google\.firebase:firebase-firestore/i],
  ['AdMob / Google Mobile Ads', /play-services-ads|com\.google\.android\.gms:play-services-ads|MobileAds/i],
  ['Google Play Billing', /com\.android\.billingclient|BillingClient/i],
  ['Google Sign-In', /play-services-auth|GoogleSignIn/i],
  ['Google Maps / Location', /play-services-maps|play-services-location|FusedLocationProviderClient/i],
  ['CameraX', /androidx\.camera|CameraX/i],
  ['ML Kit', /com\.google\.mlkit|mlkit/i],
  ['Sentry', /io\.sentry|sentry-android/i],
  ['AppsFlyer', /appsflyer/i],
  ['Adjust', /com\.adjust|adjust-android/i],
  ['OpenAI API', /api\.openai\.com|openai/i],
  ['Google Gemini API', /generativelanguage\.googleapis\.com|google\.ai\.client\.generativeai|firebase-ai/i],
  ['Hugging Face', /huggingface\.co|hf\.co|huggingface/i],
  ['Retrofit', /com\.squareup\.retrofit2|retrofit2/i],
  ['OkHttp', /com\.squareup\.okhttp3|okhttp3/i],
  ['Room database', /androidx\.room|RoomDatabase/i],
];

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

function extname(path: string): string {
  const b = basename(path).toLowerCase();
  if (b.endsWith('.env.example')) return '.env.example';
  const i = b.lastIndexOf('.');
  return i >= 0 ? b.slice(i) : '';
}

export function shouldReadAsText(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.includes('/node_modules/') || lower.includes('/.git/') || lower.includes('/build/') || lower.includes('/.gradle/')) return false;
  return TEXT_EXTENSIONS.has(extname(path)) || /(^|\/)(build\.gradle|build\.gradle\.kts|settings\.gradle|settings\.gradle\.kts|gradle\.properties|androidmanifest\.xml)$/i.test(lower);
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
}

function parseIntMatch(text: string, patterns: RegExp[]): number | undefined {
  const value = firstMatch(text, patterns);
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function limit<T>(values: T[], n = 30): T[] {
  return values.slice(0, n);
}

export function analyzeSourceFiles(files: Record<string, string>, sourceType: AnalysisResult['sourceType'] = 'repository'): AnalysisResult {
  const entries = Object.entries(files);
  const joined = entries.map(([path, text]) => `\n// FILE: ${path}\n${text}`).join('\n');
  const gradleText = entries.filter(([p]) => /build\.gradle(\.kts)?$/i.test(p)).map(([,t]) => t).join('\n');
  const manifestText = entries.filter(([p]) => /AndroidManifest\.xml$/i.test(p)).map(([,t]) => t).join('\n');
  const stringsText = entries.filter(([p]) => /res\/values[^/]*\/strings\.xml$/i.test(p)).map(([,t]) => t).join('\n');

  const packageName = firstMatch(gradleText, [
    /applicationId\s*[=(]?\s*["']([^"']+)["']/i,
    /namespace\s*[=(]?\s*["']([^"']+)["']/i,
  ]) || firstMatch(manifestText, [/package\s*=\s*["']([^"']+)["']/i]);

  const versionName = firstMatch(gradleText, [/versionName\s*[=(]?\s*["']([^"']+)["']/i]);
  const versionCode = parseIntMatch(gradleText, [/versionCode\s*[=(]?\s*(\d+)/i]);
  const minSdk = parseIntMatch(gradleText, [/minSdk(?:Version)?\s*[=(]?\s*(\d+)/i]);
  const targetSdk = parseIntMatch(gradleText, [/targetSdk(?:Version)?\s*[=(]?\s*(\d+)/i]);
  const compileSdk = parseIntMatch(gradleText, [/compileSdk(?:Version)?\s*[=(]?\s*(\d+)/i]);
  const appName = firstMatch(stringsText, [/<string\s+name=["']app_name["'][^>]*>([^<]+)<\/string>/i]);

  const permissions = unique([...manifestText.matchAll(/<uses-permission[^>]+android:name\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]));
  const sensitive = permissions.filter(p => sensitivePermissions.has(p));

  const sdkSignals = sdkPatterns.filter(([, re]) => re.test(joined)).map(([name]) => name);
  const hosts = unique([...joined.matchAll(/https?:\/\/([a-z0-9.-]+)(?=[\/:"'\s)])/gi)].map(m => m[1].toLowerCase())).filter(h => !h.includes('schemas.android.com') && !h.includes('example.com'));

  const names = entries.map(([p]) => p);
  const iconCandidates = names.filter(p => /(^|\/)(ic_launcher|icon|app_icon)[^/]*\.(png|webp|xml|svg)$/i.test(p));
  const screenshots = names.filter(p => /(screenshot|screenshots|fastlane\/metadata\/android).*\.(png|jpg|jpeg|webp)$/i.test(p));
  const featureGraphics = names.filter(p => /(feature.?graphic|featuregraphic).*\.(png|jpg|jpeg|webp)$/i.test(p));
  const privacyPolicyCandidates = names.filter(p => /(privacy|data.?safety).*(\.md|\.html|\.txt)$/i.test(p));

  const secretFiles = new Set<string>();
  let secretCount = 0;
  const secretRegexes = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    /AIza[0-9A-Za-z_-]{30,}/g,
    /sk-[A-Za-z0-9_-]{20,}/g,
    /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{8,}["']/gi,
  ];
  for (const [path, text] of entries) {
    for (const re of secretRegexes) {
      const matches = text.match(re);
      if (matches?.length) {
        secretCount += matches.length;
        secretFiles.add(path);
      }
    }
  }

  const verifiedFacts: string[] = [];
  if (packageName) verifiedFacts.push(`Package/application ID: ${packageName}`);
  if (appName) verifiedFacts.push(`Application name resource: ${appName}`);
  if (versionName) verifiedFacts.push(`Version name: ${versionName}`);
  if (versionCode != null) verifiedFacts.push(`Version code: ${versionCode}`);
  if (minSdk != null) verifiedFacts.push(`Minimum SDK: API ${minSdk}`);
  if (targetSdk != null) verifiedFacts.push(`Target SDK: API ${targetSdk}`);
  if (compileSdk != null) verifiedFacts.push(`Compile SDK: API ${compileSdk}`);
  if (permissions.length) verifiedFacts.push(`${permissions.length} manifest permission declaration(s) detected.`);
  if (sdkSignals.length) verifiedFacts.push(`SDK/integration signals: ${sdkSignals.join(', ')}`);

  const inferredFeatures: string[] = [];
  const lower = joined.toLowerCase();
  if (/\b(translat|dictionary|language pair|source language|target language)\b/.test(lower)) inferredFeatures.push('Translation or dictionary functionality may be present.');
  if (/\b(sign.?in|log.?in|create account|register account|authentication)\b/.test(lower) || sdkSignals.includes('Firebase Authentication')) inferredFeatures.push('Account authentication/sign-in may be present.');
  if (/\b(subscription|purchase|premium|pro plan|billingclient)\b/.test(lower) || sdkSignals.includes('Google Play Billing')) inferredFeatures.push('Paid or subscription functionality may be present.');
  if (/\b(camera|take photo|scan qr|barcode)\b/.test(lower) || permissions.includes('android.permission.CAMERA')) inferredFeatures.push('Camera-related functionality may be present.');
  if (/\b(location|gps|map|geofence)\b/.test(lower) || permissions.some(p => p.includes('LOCATION'))) inferredFeatures.push('Location-related functionality may be present.');
  if (/\b(ai|artificial intelligence|prompt|generative|chatbot|llm)\b/.test(lower) || sdkSignals.some(s => /OpenAI|Gemini|Hugging Face/.test(s))) inferredFeatures.push('AI-assisted functionality may be present.');
  if (/\b(notification|push message|firebase messaging)\b/.test(lower) || permissions.includes('android.permission.POST_NOTIFICATIONS')) inferredFeatures.push('Notifications may be present.');
  if (/\b(offline|roomdatabase|sqlite|local database|cache)\b/.test(lower) || sdkSignals.includes('Room database')) inferredFeatures.push('Some local/offline data capability may be present; runtime verification is required before claiming offline operation.');

  const findings: Finding[] = [];
  const questions: string[] = [];

  if (!packageName) findings.push({ severity: 'REQUIRED_INPUT', title: 'Package ID not established', detail: 'The analyzer could not prove an applicationId/namespace from the inspected source.' });
  if (targetSdk == null) findings.push({ severity: 'REQUIRED_INPUT', title: 'Target SDK not established', detail: 'The current Play target API requirement cannot be evaluated until targetSdk is known.' });
  else if (targetSdk < 36) findings.push({ severity: 'BLOCKING', title: 'Target API below current mobile submission baseline', detail: `Detected targetSdk ${targetSdk}. Standard mobile new apps and updates submitted from 31 August 2026 require API 36 or higher. Form-factor exceptions and any approved extension must be verified in Play Console.`, evidence: ['Google Play target API requirement effective 2026-08-31'] });

  if (sensitive.length) findings.push({ severity: 'REVIEW_RISK', title: 'Policy-sensitive permissions detected', detail: 'These permissions may be legitimate, but each must be tied to real core functionality and checked against current Google Play policy before submission.', evidence: sensitive });

  if (secretCount > 0) findings.push({ severity: 'BLOCKING', title: 'Potential embedded secrets detected', detail: `Found ${secretCount} credential-like value(s). Secret values were not returned. Remove or rotate real secrets before publishing source or builds.`, evidence: limit([...secretFiles], 10) });

  const hasAds = sdkSignals.includes('AdMob / Google Mobile Ads');
  const hasAnalytics = sdkSignals.includes('Firebase Analytics') || sdkSignals.includes('AppsFlyer') || sdkSignals.includes('Adjust');
  const hasAuth = sdkSignals.includes('Firebase Authentication') || /\b(sign.?in|log.?in|authentication)\b/i.test(joined);
  const hasRemote = hosts.length > 0 || sdkSignals.some(s => ['Retrofit', 'OkHttp', 'OpenAI API', 'Google Gemini API', 'Hugging Face'].includes(s));

  if ((hasAds || hasAnalytics || hasAuth || hasRemote) && privacyPolicyCandidates.length === 0) {
    findings.push({ severity: 'REQUIRED_INPUT', title: 'Privacy disclosure needs verification', detail: 'Network, analytics, ads, authentication, or remote-service signals were detected, but no privacy-policy file was found in the inspected source. A repository file is not the only valid privacy-policy source, so provide the public policy URL if it exists elsewhere.' });
  }

  if (hasAds) questions.push('Does the app currently show ads to users, and are ads personalized or contextual?');
  if (hasAnalytics) questions.push('Which analytics events/user identifiers are collected, retained, or shared in production?');
  if (hasAuth) questions.push('Does the app allow account creation? If yes, how can users request or perform account deletion?');
  if (hasRemote) questions.push('What user data is sent to each remote service in production, and for what purpose?');
  if (sensitive.length) questions.push('For each sensitive permission, what user-facing core feature requires it?');
  questions.push('What is the intended target audience/age range? This cannot be safely inferred from source code alone.');
  questions.push('Does the app include health, financial, gambling, dating, user-generated-content, or regulated functionality not obvious from static source inspection?');

  const verifiedThemes: string[] = [];
  if (hasAuth) verifiedThemes.push('Authentication integration');
  if (sdkSignals.includes('Google Play Billing')) verifiedThemes.push('Google Play billing integration');
  if (permissions.includes('android.permission.CAMERA')) verifiedThemes.push('Camera permission declared');
  if (permissions.some(p => p.includes('LOCATION'))) verifiedThemes.push('Location permission declared');
  if (sdkSignals.some(s => /OpenAI|Gemini|Hugging Face/.test(s))) verifiedThemes.push('Third-party AI integration signal');

  const title = appName?.trim().slice(0, 30);
  const supportedShortThemes = verifiedThemes.filter(v => !/permission declared|integration signal/i.test(v));
  const shortDescription = supportedShortThemes.length ? `${supportedShortThemes.slice(0, 2).join(' and ')}.`.slice(0, 80) : undefined;

  const screenshotPlan: string[] = [];
  if (inferredFeatures.some(f => f.includes('Translation'))) screenshotPlan.push('Capture the real translation/search flow only if runtime testing confirms it is functional.');
  if (inferredFeatures.some(f => f.includes('Account'))) screenshotPlan.push('Capture the real sign-in/account screen if account access is part of the published experience.');
  if (inferredFeatures.some(f => f.includes('Paid'))) screenshotPlan.push('Capture the real premium/purchase screen only if the offering is live and accurately priced in-app.');
  if (!screenshotPlan.length) screenshotPlan.push('Capture 4–8 real screenshots showing the app’s primary user journeys; do not fabricate UI or future features.');

  return {
    sourceType,
    app: { appName, packageName, versionName, versionCode, minSdk, targetSdk, compileSdk },
    verifiedFacts,
    inferredFeatures: unique(inferredFeatures),
    permissions,
    sensitivePermissions: sensitive,
    sdkSignals: unique(sdkSignals),
    remoteHosts: limit(hosts, 50),
    assets: {
      iconCandidates: limit(iconCandidates, 30),
      screenshots: limit(screenshots, 30),
      featureGraphics: limit(featureGraphics, 20),
      privacyPolicyCandidates: limit(privacyPolicyCandidates, 20),
    },
    secretIndicators: { count: secretCount, files: limit([...secretFiles], 20) },
    findings,
    questions: unique(questions),
    listingPlan: {
      title,
      shortDescription,
      verifiedThemes,
      inferredThemes: unique(inferredFeatures),
      screenshotPlan,
    },
    limitations: [
      'Static inspection cannot prove runtime behavior, server-side data handling, reviewer access, account type, target audience, or Play Console declarations.',
      'Inferred features are suggestions only and must not be published as claims until corroborated.',
      'Policy requirements change; live Google Play policy should be rechecked before submission.',
    ],
  };
}

export function analyzeCompiledArchive(entryNames: string[], kind: 'apk' | 'aab'): AnalysisResult {
  const names = entryNames.map(n => n.replace(/\\/g, '/'));
  const findings: Finding[] = [];
  const verifiedFacts: string[] = [];
  const limitations: string[] = [];

  if (kind === 'apk') {
    const hasManifest = names.includes('AndroidManifest.xml');
    const hasDex = names.some(n => /^classes\d*\.dex$/i.test(n));
    if (hasManifest) verifiedFacts.push('Compiled AndroidManifest.xml entry exists.');
    if (hasDex) verifiedFacts.push('DEX bytecode is present.');
    if (!hasManifest || !hasDex) findings.push({ severity: 'BLOCKING', title: 'APK structure is incomplete or unexpected', detail: 'Expected AndroidManifest.xml and classes.dex entries were not both found.' });
  } else {
    const hasBundleConfig = names.includes('BundleConfig.pb');
    const hasBaseManifest = names.includes('base/manifest/AndroidManifest.xml');
    if (hasBundleConfig) verifiedFacts.push('BundleConfig.pb is present.');
    if (hasBaseManifest) verifiedFacts.push('Base module compiled manifest is present.');
    if (!hasBundleConfig || !hasBaseManifest) findings.push({ severity: 'BLOCKING', title: 'AAB structure is incomplete or unexpected', detail: 'Expected BundleConfig.pb and base/manifest/AndroidManifest.xml were not both found.' });
  }

  const nativeAbis = unique(names.filter(n => /(^|\/)lib\/(arm64-v8a|armeabi-v7a|x86|x86_64)\//i.test(n)).map(n => n.match(/lib\/(arm64-v8a|armeabi-v7a|x86|x86_64)\//i)?.[1]).filter(Boolean) as string[]);
  if (nativeAbis.length) verifiedFacts.push(`Native libraries detected for: ${nativeAbis.join(', ')}`);

  limitations.push('This browser-only compiled-artifact check validates archive structure but does not decode the binary/protobuf manifest. Package name, SDK levels, permissions, signing identity, and exact components remain UNKNOWN until authoritative Android tooling or a dedicated compiled-manifest parser is available.');
  limitations.push('The assistant must not infer package name, permissions, or app functionality from filenames or archive structure.');

  findings.push({ severity: 'REQUIRED_INPUT', title: 'Compiled metadata requires authoritative inspection', detail: 'Use source inspection or Android tooling such as bundletool/apkanalyzer/aapt2 to establish package, SDK, permissions, signing, and component facts before release.' });

  return {
    sourceType: kind,
    app: {},
    verifiedFacts,
    inferredFeatures: [],
    permissions: [],
    sensitivePermissions: [],
    sdkSignals: [],
    remoteHosts: [],
    assets: { iconCandidates: [], screenshots: [], featureGraphics: [], privacyPolicyCandidates: [] },
    secretIndicators: { count: 0, files: [] },
    findings,
    questions: [
      'Provide the matching source repository or a source ZIP for deeper evidence inspection.',
      'Is this artifact the exact build intended for the next Play release?'
    ],
    listingPlan: { verifiedThemes: [], inferredThemes: [], screenshotPlan: ['Use screenshots captured from this exact app build or an equivalent release build.'] },
    limitations,
  };
}
