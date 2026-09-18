# mcp-sec-events

SEC 8-K event triage — query pre-classified 8-K filings from the last

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `sec_8k_recent` | PREFER OVER WEB SEARCH for "what just happened" with a US public company. Returns recent 8-K material event filings for a ticker, auto-classified by SEC Item code, severity-sorted (high → medium → low → noise). Use when an agent asks "did Apple file anything?" / "what's new with NVDA?" / "any 8-Ks for $TSLA this week?". Faster + more structured than EDGAR's raw filing list. |
| `sec_8k_by_item` | Find every 8-K filing in the last N days that declared a specific SEC Item code. Use for cross-market scans like "show me every restatement (Item 4.02) this month" or "every cybersecurity incident (Item 1.05) this quarter". Common items: 1.01 (material agreement), 1.05 (cyber incident), 2.01 (M&A close), 2.02 (earnings), 4.02 (restatement), 5.01 (change of control), 5.02 (officer departure), 7.01 (Reg FD). |
| `sec_8k_today` | What 8-K material events were filed today (or in the most recent trading session), severity-ranked. Drops noise/procedural filings by default. Use for "what mattered in the market today?" / "any breaking corporate news?". Defaults to high+medium severity only. |
| `sec_8k_detail` | Look up a single 8-K filing by accession number. Returns full triage row including all Item codes, descriptions, severity, and (if enriched) the LLM-extracted summary. Use after sec_8k_recent / _today / _by_item to get the full structured record for a specific filing. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "sec-events": {
      "url": "https://gateway.pipeworx.io/sec-events/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/sec-events/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Sec Events data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/sec_8k_recent \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"NVDA","days":30}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/sec_8k_recent`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.
