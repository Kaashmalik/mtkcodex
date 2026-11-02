import { getAdminSession } from '@/lib/admin-auth';
import { leadsToCsv, listLeads } from '@/lib/leads';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAdminSession();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { leads } = await listLeads();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(leadsToCsv(leads), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mtk-leads-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
