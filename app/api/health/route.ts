export async function GET() {
  return Response.json({
    ok: true,
    service: 'google-play-deployment-assistant',
    version: '0.7.0',
    mode: 'public-assistant',
    websiteAndPluginParity: true,
    googlePlayWrites: false,
    truthfulnessGate: true,
    capabilities: {
      publicRepositoryInspection: true,
      localSourceZipInspection: true,
      deepApkInspection: true,
      deepAabInspection: true,
      evidenceBackedListingDrafts: true,
      submissionPacket: true,
    },
  }, { headers: { 'cache-control': 'no-store' } });
}
