/**
 * Links to systems outside the CRM.
 *
 * The scraper pipeline keeps a Google Sheet warehouse of every lead it has ever
 * found (~6k rows) and mirrors outreach state into it. The CRM is the working
 * pipeline; the sheet is the archive. Keep the two reconciled with
 * `node scripts/import-sent-log.mjs <sent.csv> --apply`.
 */
export const LEADS_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1DFO45PtJIEDnGX-xyCbzp1FTGXDVVok3Klu74ANIdJM/edit#gid=312869384';
