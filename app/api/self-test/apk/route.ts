import { NextResponse } from 'next/server';
import { AppInfoParser, isAndroidInfo } from '@h-t-m/app-inspect';

export const runtime = 'nodejs';
export const maxDuration = 60;

const FIXTURE = 'https://raw.githubusercontent.com/QuoInsight/minimal.apk/585bdb53eb7b8501177ffd7c57ea57d4ec1002af/releases/2.00/quoinsight.apk';

export async function GET() {
  try {
    const response = await fetch(FIXTURE, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Fixture download failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const parser = new AppInfoParser(bytes);
    const parsed = await parser.parse();
    const pi = parsed.data?.platformInfo;
    if (!pi || !isAndroidInfo(pi)) throw new Error('Fixture was not decoded as Android.');
    const manifest = pi.manifest as Record<string, unknown> | undefined;
    return NextResponse.json({
      ok: true,
      fixtureBytes: bytes.byteLength,
      platformInfoKeys: Object.keys(pi as unknown as Record<string, unknown>).sort(),
      manifestKeys: manifest ? Object.keys(manifest).sort() : [],
      manifest: manifest ? {
        package: manifest.package,
        versionName: manifest.versionName,
        versionCode: manifest.versionCode,
        minSdkVersion: manifest.minSdkVersion,
        targetSdkVersion: manifest.targetSdkVersion,
        usesSdk: manifest.usesSdk,
        usesPermissions: manifest.usesPermissions,
      } : null,
      signingPresent: Boolean((pi as unknown as { signing?: unknown }).signing),
      warningCount: Array.isArray(parsed.warnings) ? parsed.warnings.length : parsed.warnings ? 1 : 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Self-test failed.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
