import assert from 'node:assert/strict';
import { AppInfoParser, isAndroidInfo } from '@h-t-m/app-inspect';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/smoke-apk-parser.mjs <apk-path>');

const parser = new AppInfoParser(file);
const { data, warnings } = await parser.parse();
const pi = data?.platformInfo;
assert.ok(pi && isAndroidInfo(pi), 'Fixture was not decoded as Android');

const manifest = pi.manifest ?? {};
const get = (root, ...paths) => {
  for (const path of paths) {
    let value = root;
    let ok = true;
    for (const part of path.split('.')) {
      if (!value || typeof value !== 'object' || !(part in value)) { ok = false; break; }
      value = value[part];
    }
    if (ok && value != null) return value;
  }
};
const asNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const nameOf = (value) => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  for (const key of ['name', 'android:name', 'androidName', 'permission', 'value']) {
    if (typeof value[key] === 'string') return value[key];
  }
};
const toNames = (value) => Array.isArray(value) ? [...new Set(value.map(nameOf).filter(Boolean))] : [];

const packageName = get(manifest, 'package', 'packageName', 'applicationId');
const versionName = get(manifest, 'versionName', 'android:versionName');
const versionCode = asNumber(get(manifest, 'versionCode', 'android:versionCode'));
const minSdk = asNumber(get(manifest, 'minSdkVersion', 'usesSdk.minSdkVersion', 'minSdk'));
const targetSdk = asNumber(get(manifest, 'targetSdkVersion', 'usesSdk.targetSdkVersion', 'targetSdk'));
const permissions = [...new Set([
  ...toNames(get(manifest, 'usesPermissions', 'uses-permissions', 'usesPermission', 'permissions')),
  ...toNames(get(pi, 'permissions', 'usesPermissions')),
])];
const activities = get(pi, 'activities') ?? get(manifest, 'activities') ?? get(manifest, 'application.activities') ?? [];
const signingFingerprint = get(pi, 'signing.sha256Fingerprint', 'signing.sha256', 'signing.certificate.sha256');

const summary = {
  packageName,
  versionName,
  versionCode,
  minSdk,
  targetSdk,
  permissions,
  activityCount: Array.isArray(activities) ? activities.length : 0,
  hasSigningFingerprint: Boolean(signingFingerprint),
  warningCount: Array.isArray(warnings) ? warnings.length : warnings ? 1 : 0,
};
console.log(JSON.stringify(summary, null, 2));

assert.equal(packageName, 'com.quoinsight.minimal', 'Unexpected compiled package name');
assert.equal(String(versionName), '2.00', 'Unexpected compiled version name');
assert.equal(versionCode, 1901, 'Unexpected compiled version code');
assert.equal(minSdk, 26, 'Unexpected compiled minSdk');
assert.equal(targetSdk, 34, 'Unexpected compiled targetSdk');
assert.ok(permissions.includes('android.permission.INTERNET'), 'Expected INTERNET permission was not decoded');
assert.ok(permissions.includes('android.permission.ACCESS_COARSE_LOCATION'), 'Expected coarse location permission was not decoded');
assert.ok(Array.isArray(activities) && activities.length > 0, 'No Android activities were decoded');

console.log('APK runtime parser smoke test passed.');
