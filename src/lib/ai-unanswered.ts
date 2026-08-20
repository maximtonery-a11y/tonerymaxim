import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TM_DATA_ROOT, readSignedJson, writeSignedJson } from './secure-persistence.ts';

export type AiUnansweredRecord = {
  created_at: string;
  message: string;
  page: string;
  intent: string;
  confidence: number;
  kind: 'unknown_question' | 'low_confidence';
};

const ROOT = path.join(TM_DATA_ROOT, 'ai', 'unanswered');

export async function saveAiUnanswered(payload: Omit<AiUnansweredRecord, 'created_at'>) {
  await writeSignedJson(path.join(ROOT, `${Date.now()}-${randomUUID()}.json`), {
    created_at: new Date().toISOString(),
    ...payload,
  });
}

function normalizedKey(value: string) {
  return String(value || '').toLocaleLowerCase('sk-SK').replace(/[^a-z0-9áäčďéíĺľňóôŕšťúýž]+/gi, ' ').replace(/\s+/g, ' ').trim();
}

export async function readAiUnansweredSummary(limit = 500) {
  const files = (await readdir(ROOT).catch(() => [] as string[]))
    .filter((name) => name.endsWith('.json')).sort().reverse().slice(0, Math.max(1, Math.min(limit, 2000)));
  const records: AiUnansweredRecord[] = [];
  for (const file of files) {
    const row = await readSignedJson<AiUnansweredRecord>(path.join(ROOT, file)).catch(() => null);
    if (row?.message) records.push(row);
  }
  const grouped = new Map<string, { message: string; count: number; last: string; page: string; kind: string }>();
  for (const row of records) {
    const key = normalizedKey(row.message);
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      if (row.created_at > current.last) { current.last = row.created_at; current.page = row.page; current.message = row.message; }
    } else grouped.set(key, { message: row.message, count: 1, last: row.created_at, page: row.page, kind: row.kind });
  }
  return { total: records.length, unique: grouped.size, items: [...grouped.values()].sort((a,b) => b.count-a.count || b.last.localeCompare(a.last)) };
}
