import { describe, expect, it } from 'vitest';
import { mcpSnippets } from './snippets';

const BASE = 'https://werkbuch.example.com';

describe('mcpSnippets', () => {
  it('builds the Claude Code command with the MCP address and the token', () => {
    expect(mcpSnippets(BASE, 'wb_xxx').claude_code).toBe(
      'claude mcp add --transport http werkbuch https://werkbuch.example.com/mcp --header "Authorization: Bearer wb_xxx"',
    );
  });

  it('gives the JSON snippet the url and the Authorization header of the werkbuch server', () => {
    const config = JSON.parse(mcpSnippets(BASE, 'wb_xxx').json);

    expect(config.mcpServers.werkbuch.url).toBe('https://werkbuch.example.com/mcp');
    expect(config.mcpServers.werkbuch.headers.Authorization).toBe('Bearer wb_xxx');
  });

  it('builds the Codex block for config.toml with the same address and header', () => {
    expect(mcpSnippets(BASE, 'wb_xxx').codex).toBe(
      '[mcp_servers.werkbuch]\nurl = "https://werkbuch.example.com/mcp"\nhttp_headers = { "Authorization" = "Bearer wb_xxx" }',
    );
  });

  it('does not double the slash when the base address ends with one', () => {
    const snippets = mcpSnippets(`${BASE}/`, 'wb_xxx');

    expect(snippets.claude_code).toContain(' https://werkbuch.example.com/mcp ');
    expect(JSON.parse(snippets.json).mcpServers.werkbuch.url).toBe('https://werkbuch.example.com/mcp');
  });
});
