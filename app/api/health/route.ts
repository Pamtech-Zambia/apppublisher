export async function GET() {
  return Response.json({ ok: true, service: 'google-play-deployment-assistant', version: '0.5.1-test', mode: 'public-assistant-test', googlePlayWrites: false });
}
