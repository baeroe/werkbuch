/*
 * Setup snippets for the MCP server (spec 6.2: laravel/mcp under `/mcp`, Bearer token with the ability `mcp`), in the
 * three forms MCP clients are set up with: the `claude mcp add` command, the block for Codex's config.toml and the JSON of
 * `mcpServers` (e.g. `.mcp.json`). The formats follow openbill's settings page.
 */

export interface McpSnippets {
  /** The command to run in a terminal. */
  claude_code: string;
  /** For `~/.codex/config.toml`. */
  codex: string;
  /** For clients with an `mcpServers` configuration. */
  json: string;
}

/** Stands in for the token where none is known; the dialog after "Create token" fills in the real one. */
export const TOKEN_PLACEHOLDER = '<token>';

/** The MCP address of an instance: `https://host/mcp`, whether or not the base address ends with a slash. */
export function mcpUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/mcp`;
}

export function mcpSnippets(baseUrl: string, token: string): McpSnippets {
  const url = mcpUrl(baseUrl);
  const authorization = `Bearer ${token}`;
  return {
    claude_code: `claude mcp add --transport http --scope user werkbuch ${url} --header "Authorization: ${authorization}"`,
    codex: `[mcp_servers.werkbuch]\nurl = "${url}"\nhttp_headers = { "Authorization" = "${authorization}" }`,
    json: JSON.stringify({ mcpServers: { werkbuch: { type: 'http', url, headers: { Authorization: authorization } } } }, null, 2),
  };
}
