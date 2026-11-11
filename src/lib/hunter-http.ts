import { NextResponse } from 'next/server';
import { LeadError } from '@/lib/leads';

/** Shared response helpers for the MTK Hunter admin routes. */

export function hunterFailure(error: unknown, fallback: string) {
  if (error instanceof LeadError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`hunter: ${fallback}`, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);
