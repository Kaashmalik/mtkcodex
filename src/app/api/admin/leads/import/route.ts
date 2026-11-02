import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { importSeedLeads } from '@/lib/leads';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const count = await importSeedLeads();
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 400 },
    );
  }
}
