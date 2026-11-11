import { mutateTable, readTable } from '@/lib/file-store';
import { storageMode } from '@/lib/leads';
import { supabase } from '@/lib/supabase';

/**
 * Small JSON values keyed by name, in `app_state` (Supabase) or `.data/state.json`
 * (local dev). For settings and run logs, not for high-volume data.
 */

type StateRow = { key: string; value: unknown; updated_at: string };

export async function getState<T>(key: string, fallback: T): Promise<T> {
  const mode = storageMode();
  if (mode === 'readonly') return fallback;
  if (mode === 'supabase') {
    const rows = await supabase<StateRow[]>(`app_state?key=eq.${encodeURIComponent(key)}&select=value`);
    return rows[0] ? (rows[0].value as T) : fallback;
  }
  const row = (await readTable<StateRow>('state')).find((r) => r.key === key);
  return row ? (row.value as T) : fallback;
}

export async function setState<T>(key: string, value: T): Promise<void> {
  const mode = storageMode();
  if (mode === 'readonly') return;
  const row: StateRow = { key, value, updated_at: new Date().toISOString() };
  if (mode === 'supabase') {
    await supabase('app_state?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    return;
  }
  await mutateTable<StateRow, void>('state', (rows) => {
    const index = rows.findIndex((r) => r.key === key);
    if (index >= 0) rows[index] = row;
    else rows.push(row);
  });
}
