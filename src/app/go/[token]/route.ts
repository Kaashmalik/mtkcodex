import { NextResponse } from 'next/server';
import { recordClick } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/** Personal campaign link: records the click on the contact's timeline, then redirects with UTM tags. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = await recordClick(token).catch(() => (process.env.NEXT_PUBLIC_SITE_URL || 'https://mtkcodex.tech'));
  return NextResponse.redirect(target, { status: 302, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
