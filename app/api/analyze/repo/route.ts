import { NextResponse } from 'next/server';
import { inspectPublicRepository } from '../../../../lib/repository-inspector';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function analyze(value: string) {
  try {
    const output = await inspectPublicRepository(value);
    return NextResponse.json(output, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Repository analysis failed.';
    return NextResponse.json({ error: message }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return analyze(url.searchParams.get('url') ?? '');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return analyze(String(body?.url ?? ''));
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON containing a url field.' }, { status: 400 });
  }
}
