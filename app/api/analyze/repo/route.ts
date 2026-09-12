import { NextResponse } from 'next/server';
import { inspectPublicRepository } from '../../../../lib/repository-inspector';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const output = await inspectPublicRepository(String(body?.url ?? ''));
    return NextResponse.json(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Repository analysis failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
