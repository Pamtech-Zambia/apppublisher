import { analyzeSourceFiles, type AnalysisResult } from './play-analyzer';

type Rule = {
  name: string;
  userPhrase: string;
  path: RegExp;
  content: RegExp;
  requiredPermission?: RegExp;
  requiredSdk?: RegExp;
};

const rules: Rule[] = [
  {
    name: 'Translation and dictionary tools',
    userPhrase: 'translate and look up words or phrases',
    path: /(translat|dictionary|lexicon|phrase|proverb)/i,
    content: /\b(translat(?:e|ion|or)?|dictionary|word meaning|phrase|proverb)\b/i,
  },
  {
    name: 'Search',
    userPhrase: 'search app content',
    path: /(search|query)/i,
    content: /\b(search|search results|query)\b/i,
  },
  {
    name: 'Favorites or bookmarks',
    userPhrase: 'save favorites or bookmarks',
    path: /(favorite|favourite|bookmark|saved)/i,
    content: /\b(favorites?|favourites?|bookmarks?|saved items?)\b/i,
  },
  {
    name: 'User accounts and sign-in',
    userPhrase: 'sign in to an account',
    path: /(login|signin|sign_in|auth|account|register)/i,
    content: /\b(sign in|log in|login|create account|register|authentication|account)\b/i,
    requiredSdk: /(Firebase Authentication|Google Sign-In)/i,
  },
  {
    name: 'In-app purchases or subscriptions',
    userPhrase: 'access paid purchases or subscriptions',
    path: /(billing|purchase|subscription|premium|paywall)/i,
    content: /\b(subscription|purchase|premium|upgrade|billing|paywall)\b/i,
    requiredSdk: /Google Play Billing/i,
  },
  {
    name: 'Camera or scanning',
    userPhrase: 'use camera-based capture or scanning',
    path: /(camera|scanner|scan|barcode|qr)/i,
    content: /\b(camera|scan|scanner|barcode|qr code|take photo)\b/i,
    requiredPermission: /android\.permission\.CAMERA/i,
  },
  {
    name: 'Location or maps',
    userPhrase: 'use location or map features',
    path: /(location|map|geofence|gps)/i,
    content: /\b(location|map|gps|geofence|nearby)\b/i,
    requiredPermission: /android\.permission\.(ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|ACCESS_BACKGROUND_LOCATION)/i,
  },
  {
    name: 'Notifications',
    userPhrase: 'receive app notifications',
    path: /(notification|messaging|push)/i,
    content: /\b(notification|push message|push notification|firebase messaging)\b/i,
  },
];

function isUiEvidence(path: string): boolean {
  return /res\/values[^/]*\/strings\.xml$|res\/layout|\.tsx$|\.jsx$|Screen\.(kt|java)$|Activity\.(kt|java)$|Fragment\.(kt|java)$/i.test(path);
}

function isImplementationEvidence(path: string): boolean {
  return /\.(kt|java|dart|ts|tsx|js|jsx)$/i.test(path) && !/strings\.xml$/i.test(path);
}

function evidenceForRule(files: Record<string,string>, rule: Rule): { verified: boolean; evidence: string[] } {
  const matches = Object.entries(files).filter(([path,text]) => rule.path.test(path) || rule.content.test(text));
  const ui = matches.filter(([path,text]) => isUiEvidence(path) && rule.content.test(text));
  const impl = matches.filter(([path,text]) => isImplementationEvidence(path) && (rule.path.test(path) || rule.content.test(text)));
  const independent = new Set(matches.map(([path]) => path));
  const verified = ui.length > 0 && impl.length > 0 && independent.size >= 2;
  return {
    verified,
    evidence: [...new Set([...ui.map(([p])=>p), ...impl.map(([p])=>p)])].slice(0,6),
  };
}

function sentenceList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0,-1).join(', ')}, and ${items[items.length-1]}`;
}

function buildDescriptions(appName: string | undefined, phrases: string[]): { short?: string; full?: string } {
  if (!appName || !phrases.length) return {};
  const featureText = sentenceList(phrases.slice(0,3));
  const shortCandidates = [
    `${appName} helps you ${featureText}.`,
    `Use ${appName} to ${featureText}.`,
  ];
  const short = shortCandidates.find(x => x.length <= 80) || `${appName}: ${phrases[0]}.`.slice(0,80);
  const bullets = phrases.map(p => `• ${p.charAt(0).toUpperCase()}${p.slice(1)}`).join('\n');
  const full = `${appName} is an Android app designed to help you ${featureText}.\n\nFeatures verified from the inspected application source include:\n${bullets}\n\nAvailability can depend on the app version, device, permissions, account state, or network connection. This description is generated only from corroborated source evidence and should be reviewed against the final release before publishing.`;
  return { short, full };
}

export function analyzeSourceFilesWithEvidence(files: Record<string,string>, sourceType: AnalysisResult['sourceType'] = 'repository'): AnalysisResult {
  const result = analyzeSourceFiles(files, sourceType);
  const verifiedUserFeatures: Array<{name:string; phrase:string; evidence:string[]}> = [];

  for (const rule of rules) {
    const evidence = evidenceForRule(files, rule);
    if (!evidence.verified) continue;
    if (rule.requiredPermission && !result.permissions.some(p => rule.requiredPermission!.test(p))) continue;
    if (rule.requiredSdk && !result.sdkSignals.some(s => rule.requiredSdk!.test(s))) continue;
    verifiedUserFeatures.push({ name: rule.name, phrase: rule.userPhrase, evidence: evidence.evidence });
  }

  if (verifiedUserFeatures.length) {
    result.listingPlan.verifiedThemes = [...new Set([...result.listingPlan.verifiedThemes, ...verifiedUserFeatures.map(f => f.name)])];
    const descriptions = buildDescriptions(result.app.appName, verifiedUserFeatures.map(f => f.phrase));
    result.listingPlan.shortDescription = descriptions.short;
    result.listingPlan.fullDescription = descriptions.full;
    for (const feature of verifiedUserFeatures) {
      result.verifiedFacts.push(`Corroborated user-facing feature: ${feature.name}.`);
      result.findings.push({
        severity: 'RECOMMENDATION',
        title: `Listing claim supported: ${feature.name}`,
        detail: 'This feature has both user-facing and implementation evidence in the inspected source and may be used as a listing draft claim, subject to final runtime verification.',
        evidence: feature.evidence,
      });
    }
  }

  return result;
}
