import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { campaignOverview, createCampaign, parseCampaignInput, updateCampaign, type CampaignStatus } from '@/lib/campaigns';
import { hunterFailure, readJsonBody } from '@/lib/hunter-http';
import { LeadError } from '@/lib/leads';

export const dynamic = 'force-dynamic';

const STATUSES: CampaignStatus[] = ['draft', 'running', 'paused', 'done'];

export async function GET(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json(await campaignOverview());
  } catch (error) {
    return hunterFailure(error, 'Failed to load campaigns');
  }
}

export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  try {
    return NextResponse.json({ campaign: await createCampaign(parseCampaignInput(body)) }, { status: 201 });
  } catch (error) {
    return hunterFailure(error, 'Failed to create campaign');
  }
}

/** Edit fields, or start / pause with `status`. */
export async function PATCH(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const body = await readJsonBody(req);
  if (!body || typeof body.id !== 'string') return NextResponse.json({ error: 'Campaign id is required' }, { status: 422 });
  try {
    const status = body.status === undefined ? undefined : STATUSES.includes(body.status as CampaignStatus) ? (body.status as CampaignStatus) : null;
    if (status === null) throw new LeadError('Unknown status', 422);
    const { id, status: _s, ...rest } = body;
    void _s;
    return NextResponse.json({ campaign: await updateCampaign(id as string, parseCampaignInput(rest), status) });
  } catch (error) {
    return hunterFailure(error, 'Failed to update campaign');
  }
}
