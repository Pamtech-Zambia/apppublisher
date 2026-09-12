export async function GET() {
  return Response.json({
    ok: true,
    service: 'google-play-deployment-assistant',
    version: '0.6.0',
    mode: 'public-assistant',
    websiteAndPluginParity: true,
    googlePlayWrites: false,
    truthfulnessGate: true,
  });
}
