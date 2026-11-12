import type { Lead } from '@/lib/lead-types';

/**
 * How a campaign message reads for one contact. Pure, so the editor's live
 * preview and the sender produce exactly the same text.
 */

export const CAMPAIGN_BRAND = 'MTK Codex';

function firstName(lead: Pick<Lead, 'name'>): string {
  // Imported contacts without a name get "Contact (212) 555-…" — greet those as "there".
  if (!lead.name || /^contact\b/i.test(lead.name)) return 'there';
  return lead.name.split(/\s+/)[0].slice(0, 30);
}

export function fillTemplate(template: string, lead: Pick<Lead, 'name' | 'city'>, link: string): string {
  return template
    .replace(/\{name\}/gi, firstName(lead))
    .replace(/\{city\}/gi, lead.city || 'your area')
    .replace(/\{link\}/gi, link)
    .trim();
}

/**
 * SMS body as sent: names the sender and says how to opt out, which US
 * carriers require on marketing texts. Added only when the text lacks them.
 */
/** GSM-7 messages split at 153 chars per part (160 single); anything else at 67 (70 single). */
export function smsSegments(text: string): { segments: number; unicode: boolean } {
  // Basic GSM-7 set, plus the extension chars that cost two.
  const gsm = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
  const unicode = !gsm.test(text);
  const length = unicode ? [...text].length : text.length + (text.match(/[\^{}\\[~\]|€]/g)?.length || 0);
  const single = unicode ? 70 : 160;
  const part = unicode ? 67 : 153;
  return { segments: length <= single ? 1 : Math.ceil(length / part), unicode };
}

export function renderSms(template: string, lead: Pick<Lead, 'name' | 'city'>, link: string): string {
  let body = fillTemplate(template, lead, link);
  if (!body.toLowerCase().includes(CAMPAIGN_BRAND.toLowerCase())) body = `${CAMPAIGN_BRAND}: ${body}`;
  if (!/\bstop\b/i.test(body)) body = `${body} Reply STOP to opt out.`;
  return body;
}
