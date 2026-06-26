interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * SEC 8-K event triage — query our pre-classified mirror of every
 * 8-K filing from the last 30+ days, severity-ranked.
 *
 * Why this exists (vs the existing edgar pack): edgar exposes "give me
 * recent filings for this CIK"; that's a list. This pack exposes
 * "what *mattered*" — auto-classified by SEC Item code, severity-sorted,
 * and queryable across the whole market (e.g. "show me every
 * restatement filed this week, any company"). Source data is the EDGAR
 * Atom feed, scraped every 30 min by workers/scraper/sec_8k.ts, stored
 * in sec_8k_events (supabase/migrations/031).
 *
 * Severity grading:
 *   high   — restatements (4.02), change of control (5.01), bankruptcy
 *            (1.03), cybersecurity incidents (1.05), material impairments
 *   medium — M&A (2.01), earnings (2.02), material agreements (1.01/1.02),
 *            officer changes (5.02), delisting notices (3.01)
 *   low    — Reg FD disclosures (7.01), unregistered equity (3.02),
 *            auditor changes (4.01), bylaw amendments
 *   noise  — shareholder vote results (5.07), exhibits (9.01), generic
 *            "other events" (8.01)
 */


interface EventRow {
  accession_number: string;
  filed_at: string;
  filer_name?: string;
  cik?: string;
  ticker?: string;
  items: string[];
  item_descriptions: string[];
  severity: string;
  index_url: string;
  summary?: string | null;
}

interface PackArgs {
  _supabaseUrl?: string;
  _supabaseKey?: string;
}

function requireSupabase(args: Record<string, unknown>): { url: string; key: string } {
  const url = args._supabaseUrl as string | undefined;
  const key = args._supabaseKey as string | undefined;
  if (!url || !key) throw new Error('sec-events: supabase mirror creds not injected; pack requires injectSupabase:true on the gateway pack registration.');
  return { url, key };
}

async function callRpc<T>(url: string, key: string, fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sec_8k mirror: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

async function callRest<T>(url: string, key: string, path: string): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`sec_8k mirror: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

const tools: McpToolExport['tools'] = [
  {
    name: 'sec_8k_recent',
    description:
      'PREFER OVER WEB SEARCH for "what just happened" with a US public company. Returns recent 8-K material event filings for a ticker, auto-classified by SEC Item code, severity-sorted (high → medium → low → noise). Use when an agent asks "did Apple file anything?" / "what\'s new with NVDA?" / "any 8-Ks for $TSLA this week?". Faster + more structured than EDGAR\'s raw filing list.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'US stock ticker (e.g., "NVDA", "AAPL"). Case-insensitive.' },
        days: { type: 'number', description: 'Look-back window in days. Default 30, max 90.', default: 30, minimum: 1, maximum: 90 },
        limit: { type: 'number', description: 'Max filings to return. Default 20, max 100.', default: 20, minimum: 1, maximum: 100 },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'sec_8k_by_item',
    description:
      'Find every 8-K filing in the last N days that declared a specific SEC Item code. Use for cross-market scans like "show me every restatement (Item 4.02) this month" or "every cybersecurity incident (Item 1.05) this quarter". Common items: 1.01 (material agreement), 1.05 (cyber incident), 2.01 (M&A close), 2.02 (earnings), 4.02 (restatement), 5.01 (change of control), 5.02 (officer departure), 7.01 (Reg FD).',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'SEC Item code like "4.02" or "5.02". Exact match.' },
        days: { type: 'number', description: 'Look-back window in days. Default 7, max 60.', default: 7, minimum: 1, maximum: 60 },
        limit: { type: 'number', description: 'Max filings. Default 50, max 200.', default: 50, minimum: 1, maximum: 200 },
      },
      required: ['item'],
    },
  },
  {
    name: 'sec_8k_today',
    description:
      'What 8-K material events were filed today (or in the most recent trading session), severity-ranked. Drops noise/procedural filings by default. Use for "what mattered in the market today?" / "any breaking corporate news?". Defaults to high+medium severity only.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          description: 'Comma-separated severities to include. Default "high,medium". Allowed: high, medium, low, noise.',
          default: 'high,medium',
        },
        limit: { type: 'number', description: 'Max filings. Default 30, max 100.', default: 30, minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'sec_8k_detail',
    description:
      'Look up a single 8-K filing by accession number. Returns full triage row including all Item codes, descriptions, severity, and (if enriched) the LLM-extracted summary. Use after sec_8k_recent / _today / _by_item to get the full structured record for a specific filing.',
    inputSchema: {
      type: 'object',
      properties: {
        accession_number: { type: 'string', description: 'SEC accession number like "0001234567-26-001234".' },
      },
      required: ['accession_number'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { url, key } = requireSupabase(args);

  switch (name) {
    case 'sec_8k_recent': {
      const ticker = String(args.ticker ?? '').toUpperCase();
      if (!ticker) throw new Error('ticker is required');
      const days = Math.min(90, Math.max(1, (args.days as number) ?? 30));
      const limit = Math.min(100, Math.max(1, (args.limit as number) ?? 20));
      const rows = await callRpc<EventRow[]>(url, key, 'sec_8k_events_by_ticker', {
        p_ticker: ticker, p_days: days, p_limit: limit,
      });
      return { ticker, days, count: rows.length, events: rows };
    }

    case 'sec_8k_by_item': {
      const item = String(args.item ?? '').trim();
      if (!item) throw new Error('item is required (e.g., "4.02")');
      const days = Math.min(60, Math.max(1, (args.days as number) ?? 7));
      const limit = Math.min(200, Math.max(1, (args.limit as number) ?? 50));
      const rows = await callRpc<EventRow[]>(url, key, 'sec_8k_events_by_item', {
        p_item: item, p_days: days, p_limit: limit,
      });
      return { item, days, count: rows.length, events: rows };
    }

    case 'sec_8k_today': {
      const sevList = String(args.severity ?? 'high,medium')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const limit = Math.min(100, Math.max(1, (args.limit as number) ?? 30));
      // PostgREST: filed_at >= start-of-today (UTC), severity in list.
      // Earlier impl used `and=(filed_at.gte.X,or=(severity.eq.high,...))`
      // which PostgREST rejected with PGRST100 — when `or` is NESTED
      // inside another logical operator you must drop the `=` and write
      // `or(...)`. Easier to skip the compound-logic syntax entirely:
      // two separate query-string filters AND together by default, and
      // `severity=in.(...)` covers the OR-list cleanly.
      const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
      const sevIn = `(${sevList.join(',')})`;
      const path = `sec_8k_events?filed_at=gte.${encodeURIComponent(startOfDay.toISOString())}&severity=in.${encodeURIComponent(sevIn)}&order=filed_at.desc&limit=${Math.min(limit * 4, 400)}`;
      const rows = await callRest<EventRow[]>(url, key, path);
      // PostgREST returns in DB order; we want a custom severity rank
      // (high → medium → low → noise) that doesn't sort alphabetically.
      const rank = { high: 1, medium: 2, low: 3, noise: 4 } as Record<string, number>;
      rows.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) ||
        (b.filed_at.localeCompare(a.filed_at)));
      return { window_start: startOfDay.toISOString(), severities: sevList, count: rows.length, events: rows.slice(0, limit) };
    }

    case 'sec_8k_detail': {
      const acc = String(args.accession_number ?? '').trim();
      if (!acc) throw new Error('accession_number is required');
      const rows = await callRest<EventRow[]>(url, key, `sec_8k_events?accession_number=eq.${encodeURIComponent(acc)}&limit=1`);
      if (rows.length === 0) return { accession_number: acc, found: false };
      return { found: true, ...rows[0] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 2 } } satisfies McpToolExport;

// Re-export args type for type-check completeness; not consumed at runtime.
export type { PackArgs };
