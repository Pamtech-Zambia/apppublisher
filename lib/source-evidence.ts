import { analyzeSourceFiles, type AnalysisResult } from './play-analyzer';

type Rule = {
  name: string;
  userPhrase: string;
  content: RegExp;
  requiredPermission?: RegExp;
  requiredSdk?: RegExp;
};

type ListingPlanWithFull = AnalysisResult['listingPlan'] & { fullDescription?: string };

const featureRules: Rule[] = [
  { name: 'Translation and dictionary tools', userPhrase: 'translate and look up words or phrases', content: /\b(translat(?:e|ion|or)?|dictionary|word meaning|phrase|proverb)\b/i },
  { name: 'Search', userPhrase: 'search app content', content: /\b(search|search results|query)\b/i },
  { name: 'Favorites or bookmarks', userPhrase: 'save favorites or bookmarks', content: /\b(favorites?|favourites?|bookmarks?|saved items?)\b/i },
  { name: 'User accounts and sign-in', userPhrase: 'sign in to an account', content: /\b(sign in|log in|login|create account|register|authentication|account)\b/i, requiredSdk: /(Firebase Authentication|Google Sign-In)/i },
  { name: 'In-app purchases or subscriptions', userPhrase: 'access paid purchases or subscriptions', content: /\b(subscription|purchase|premium|upgrade|billing|paywall)\b/i, requiredSdk: /Google Play Billing/i },
  { name: 'Camera or scanning', userPhrase: 'use camera-based capture or scanning', content: /\b(camera|scan|scanner|barcode|qr code|take photo|capture photo)\b/i, requiredPermission: /android\.permission\.CAMERA/i },
  { name: 'Location or maps', userPhrase: 'use location or map features', content: /\b(location|map|gps|geofence|nearby)\b/i, requiredPermission: /android\.permission\.(ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|ACCESS_BACKGROUND_LOCATION)/i },
  { name: 'Notifications', userPhrase: 'receive app notifications', content: /\b(notification|push message|push notification|firebase messaging)\b/i },
];

const sdkPatterns: Array<[string, RegExp]> = [
  ['Firebase Analytics', /firebase-(analytics|bom)|com\.google\.firebase:firebase-analytics/i],
  ['Firebase Authentication', /firebase-auth|com\.google\.firebase:firebase-auth/i],
  ['Firebase Crashlytics', /firebase-crashlytics|com\.google\.firebase:firebase-crashlytics/i],
  ['Firebase Firestore', /firebase-firestore|com\.google\.firebase:firebase-firestore/i],
  ['AdMob / Google Mobile Ads', /play-services-ads|com\.google\.android\.gms:play-services-ads|\bMobileAds\b/i],
  ['Google Play Billing', /com\.android\.billingclient|\bBillingClient\b/i],
  ['Google Sign-In', /play-services-auth|\bGoogleSignIn\b/i],
  ['Google Maps / Location', /play-services-maps|play-services-location|FusedLocationProviderClient/i],
  ['CameraX', /androidx\.camera|\bCameraX\b/i],
  ['ML Kit', /com\.google\.mlkit|\bmlkit\b/i],
  ['Sentry', /io\.sentry|sentry-android/i],
  ['AppsFlyer', /appsflyer/i],
  ['Adjust', /com\.adjust|adjust-android/i],
  ['OpenAI API', /api\.openai\.com|\bOpenAI\b/i],
  ['Google Gemini API', /generativelanguage\.googleapis\.com|google\.ai\.client\.generativeai|firebase-ai/i],
  ['Hugging Face', /huggingface\.co|hf\.co|\bHuggingFace\b/i],
  ['Retrofit', /com\.squareup\.retrofit2|\bretrofit2\b/i],
  ['OkHttp', /com\.squareup\.okhttp3|\bokhttp3\b/i],
  ['Room database', /androidx\.room|\bRoomDatabase\b/i],
];

const documentationHosts = new Set([
  'github.com','www.github.com','developer.android.com','kotlinlang.org','opensource.org','www.opensource.org',
  'gradle.org','www.gradle.org','d.android.com','maven.google.com','repo1.maven.org','schemas.android.com',
  'www.w3.org','plugins.gradle.org','docs.gradle.org','developer.apple.com','stackoverflow.com'
]);

function normalized(path: string): string { return path.replace(/\\/g,'/').toLowerCase(); }

function isTestOrDocumentation(path: string): boolean {
  const p = normalized(path);
  return /(^|\/)(test|tests|androidtest|docs?|documentation|examples?|samples?)(\/|$)/.test(p)
    || /(^|\/)(readme|license|licence|changelog|contributing|code_of_conduct)(\.|$)/.test(p)
    || /gradle\/wrapper/.test(p);
}

function isProductionCode(path: string): boolean {
  if (isTestOrDocumentation(path)) return false;
  const p = normalized(path);
  return /\.(kt|java|dart|js|ts|tsx|jsx)$/.test(p)
    && !/\.config\.(js|ts)$/.test(p)
    && !/(vite|webpack|rollup|eslint|prettier|babel|metro)\.config/.test(p);
}

function isUserFacingSource(path: string): boolean {
  if (isTestOrDocumentation(path)) return false;
  const p = normalized(path);
  return /res\/values[^/]*\/strings\.xml$|res\/layout\/|\.tsx$|\.jsx$|screen\.(kt|java)$|activity\.(kt|java)$|fragment\.(kt|java)$|viewmodel\.(kt|java)$/.test(p);
}

function isRuntimeConfig(path: string): boolean {
  if (isTestOrDocumentation(path)) return false;
  const p = normalized(path);
  if (/build\.gradle|settings\.gradle|gradle\.properties|package(-lock)?\.json|yarn\.lock|pnpm-lock|pom\.xml/.test(p)) return false;
  return /(^|\/)(google-services\.json|firebase\.json|network_security_config\.xml|.*\.env(?:\..*)?|.*\.properties|.*\.json|.*\.ya?ml)$/.test(p);
}

function dependencyText(files: Record<string,string>): string {
  return Object.entries(files)
    .filter(([path]) => !isTestOrDocumentation(path) && /build\.gradle(\.kts)?$|libs\.versions\.toml$|pubspec\.yaml$|package\.json$/i.test(path))
    .map(([,text]) => text)
    .join('\n');
}

function productionCodeText(files: Record<string,string>): string {
  return Object.entries(files).filter(([path]) => isProductionCode(path)).map(([,text]) => text).join('\n');
}

function runtimeEndpointEvidence(files: Record<string,string>): { hosts:string[]; evidence:string[] } {
  const hosts = new Set<string>();
  const evidence = new Set<string>();
  for (const [path,text] of Object.entries(files)) {
    if (!isProductionCode(path) && !isRuntimeConfig(path)) continue;
    for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)(?=[\/:"'`\s)])/gi)) {
      const host = match[1].toLowerCase();
      if (documentationHosts.has(host) || host.endsWith('.example.com') || host === 'example.com') continue;
      if (host.includes('schemas.android.com')) continue;
      hosts.add(host);
      evidence.add(path);
    }
  }
  return { hosts:[...hosts], evidence:[...evidence] };
}

function evidenceForRule(files: Record<string,string>, rule: Rule): { verified:boolean; evidence:string[] } {
  const ui = Object.entries(files).filter(([path,text]) => isUserFacingSource(path) && rule.content.test(text));
  const impl = Object.entries(files).filter(([path,text]) => isProductionCode(path) && rule.content.test(text));
  const evidence = [...new Set([...ui.map(([p])=>p), ...impl.map(([p])=>p)])];
  return { verified: ui.length > 0 && impl.length > 0 && evidence.length >= 2, evidence:evidence.slice(0,6) };
}

function sentenceList(items:string[]):string {
  if(items.length===1)return items[0];
  if(items.length===2)return `${items[0]} and ${items[1]}`;
  return `${items.slice(0,-1).join(', ')}, and ${items[items.length-1]}`;
}

function buildDescriptions(appName:string|undefined,phrases:string[]):{short?:string;full?:string}{
  if(!appName||!phrases.length)return{};
  const featureText=sentenceList(phrases.slice(0,3));
  const candidates=[`${appName} helps you ${featureText}.`,`Use ${appName} to ${featureText}.`];
  const short=candidates.find(x=>x.length<=80)||`${appName}: ${phrases[0]}.`.slice(0,80);
  const bullets=phrases.map(p=>`• ${p.charAt(0).toUpperCase()}${p.slice(1)}`).join('\n');
  const full=`${appName} is an Android app designed to help you ${featureText}.\n\nFeatures verified from the inspected application source include:\n${bullets}\n\nAvailability can depend on the app version, device, permissions, account state, or network connection. This description is generated only from corroborated production-source evidence and should be reviewed against the final release before publishing.`;
  return{short,full};
}

export function analyzeSourceFilesWithEvidence(files:Record<string,string>,sourceType:AnalysisResult['sourceType']='repository'):AnalysisResult{
  const result=analyzeSourceFiles(files,sourceType);
  const prodText=productionCodeText(files);
  const deps=dependencyText(files);
  const signalText=`${deps}\n${prodText}`;

  // Replace broad README/docs-derived SDK and endpoint signals with production-oriented evidence.
  result.sdkSignals=sdkPatterns.filter(([,re])=>re.test(signalText)).map(([name])=>name);
  const endpoints=runtimeEndpointEvidence(files);
  result.remoteHosts=endpoints.hosts.slice(0,50);

  // Remove broad network/privacy findings/questions produced only from documentation URLs.
  result.findings=result.findings.filter(f=>f.title!=='Privacy disclosure needs verification');
  result.questions=result.questions.filter(q=>!q.startsWith('What user data is sent to each remote service'));

  const hasAds=result.sdkSignals.includes('AdMob / Google Mobile Ads');
  const hasAnalytics=['Firebase Analytics','AppsFlyer','Adjust'].some(x=>result.sdkSignals.includes(x));
  const hasAuth=['Firebase Authentication','Google Sign-In'].some(x=>result.sdkSignals.includes(x));
  const hasRemote=result.remoteHosts.length>0||['Retrofit','OkHttp','OpenAI API','Google Gemini API','Hugging Face'].some(x=>result.sdkSignals.includes(x));

  if((hasAds||hasAnalytics||hasAuth||hasRemote)&&result.assets.privacyPolicyCandidates.length===0){
    result.findings.push({severity:'REQUIRED_INPUT',title:'Privacy disclosure needs verification',detail:'Production-code SDK/network/auth signals were detected, but no privacy-policy file was found in the inspected source. Provide the public policy URL if it is hosted elsewhere.',evidence:endpoints.evidence.slice(0,10)});
  }
  if(hasRemote)result.questions.unshift('What user data is sent to each production remote service, and for what purpose?');
  if(hasAds&&!result.questions.some(q=>q.startsWith('Does the app currently show ads')))result.questions.unshift('Does the app currently show ads to users, and are ads personalized or contextual?');
  if(hasAnalytics&&!result.questions.some(q=>q.startsWith('Which analytics')))result.questions.unshift('Which analytics events/user identifiers are collected, retained, or shared in production?');
  if(hasAuth&&!result.questions.some(q=>q.startsWith('Does the app allow account creation')))result.questions.unshift('Does the app allow account creation? If yes, how can users request or perform account deletion?');

  // Rebuild feature hypotheses from production code rather than README/documentation text.
  const inferred:string[]=[];
  if(/\b(translat|dictionary|word meaning|phrase|proverb)\b/i.test(prodText))inferred.push('Translation or dictionary functionality may be present.');
  if(/\b(sign.?in|log.?in|create account|register|authentication)\b/i.test(prodText)||hasAuth)inferred.push('Account authentication/sign-in may be present.');
  if(/\b(subscription|purchase|premium|billingclient|paywall)\b/i.test(prodText)||result.sdkSignals.includes('Google Play Billing'))inferred.push('Paid or subscription functionality may be present.');
  if(/\b(camera|take photo|capture photo|scan qr|barcode)\b/i.test(prodText)||result.permissions.includes('android.permission.CAMERA'))inferred.push('Camera-related functionality may be present.');
  if(/\b(location|gps|geofence|nearby)\b/i.test(prodText)||result.permissions.some(p=>p.includes('LOCATION')))inferred.push('Location-related functionality may be present.');
  if(/\b(prompt|generative|chatbot|llm)\b/i.test(prodText)||result.sdkSignals.some(s=>/OpenAI|Gemini|Hugging Face/.test(s)))inferred.push('AI-assisted functionality may be present.');
  if(/\b(notification|push message|firebase messaging)\b/i.test(prodText)||result.permissions.includes('android.permission.POST_NOTIFICATIONS'))inferred.push('Notifications may be present.');
  if(/\b(roomdatabase|sqlite|local database)\b/i.test(prodText)||result.sdkSignals.includes('Room database'))inferred.push('Some local data capability may be present; runtime verification is required before claiming offline operation.');
  result.inferredFeatures=[...new Set(inferred)];
  result.listingPlan.inferredThemes=result.inferredFeatures;

  const verifiedUserFeatures:Array<{name:string;phrase:string;evidence:string[]}>=[];
  for(const rule of featureRules){
    const evidence=evidenceForRule(files,rule);
    if(!evidence.verified)continue;
    if(rule.requiredPermission&&!result.permissions.some(p=>rule.requiredPermission!.test(p)))continue;
    if(rule.requiredSdk&&!result.sdkSignals.some(s=>rule.requiredSdk!.test(s)))continue;
    verifiedUserFeatures.push({name:rule.name,phrase:rule.userPhrase,evidence:evidence.evidence});
  }

  // Remove weak themes that came only from permissions/SDK presence; publishable themes are corroborated user-facing features.
  result.listingPlan.verifiedThemes=verifiedUserFeatures.map(f=>f.name);
  const descriptions=buildDescriptions(result.app.appName,verifiedUserFeatures.map(f=>f.phrase));
  result.listingPlan.shortDescription=descriptions.short;
  (result.listingPlan as ListingPlanWithFull).fullDescription=descriptions.full;

  result.findings=result.findings.filter(f=>!f.title.startsWith('Listing claim supported:'));
  for(const feature of verifiedUserFeatures){
    if(!result.verifiedFacts.includes(`Corroborated user-facing feature: ${feature.name}.`))result.verifiedFacts.push(`Corroborated user-facing feature: ${feature.name}.`);
    result.findings.push({severity:'RECOMMENDATION',title:`Listing claim supported: ${feature.name}`,detail:'This feature has both user-facing and production implementation evidence and may be used as a listing draft claim, subject to final runtime verification.',evidence:feature.evidence});
  }

  return result;
}
