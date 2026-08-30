export async function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) {
    return new Response('Not configured', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return new Response(token, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
