/*
 * The snippets that connect an MCP client to the MCP server, for Claude Code, Codex and JSON clients, with the address of
 * this instance (`instanceOrigin()`). Without a token they carry a placeholder; the dialog after "Neuer Token"
 * fills in the real one, once.
 */

import { useRef } from 'react';
import { Tab, Tabs, TabsList, TabsPanel } from '@/components/ui/Tabs';
import { instanceOrigin } from '@/lib/links';
import { CopyButton } from './CopyButton';
import { mcpSnippets, TOKEN_PLACEHOLDER, type McpSnippets } from './snippets';

const CLIENTS: { id: keyof McpSnippets; label: string; hint: string }[] = [
  { id: 'claude_code', label: 'Claude Code', hint: 'Im Terminal ausführen.' },
  { id: 'codex', label: 'Codex', hint: 'In ~/.codex/config.toml eintragen.' },
  { id: 'json', label: 'JSON', hint: 'Für Clients mit mcpServers-Konfiguration, zum Beispiel .mcp.json.' },
];

function Snippet({ text, hint }: { text: string; hint: string }) {
  const block = useRef<HTMLPreElement>(null);
  return (
    <>
      <pre ref={block} className="rounded-ctl bg-sunken p-3 text-ui whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
        {text}
      </pre>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <CopyButton text={text} target={() => block.current} />
        <p className="min-w-0 flex-1 basis-56 text-sm text-pretty text-muted">{hint}</p>
      </div>
    </>
  );
}

export function SetupSnippets({ token }: { token?: string }) {
  const snippets = mcpSnippets(instanceOrigin(), token ?? TOKEN_PLACEHOLDER);
  return (
    <Tabs defaultValue="claude_code">
      <TabsList aria-label="Client">
        {CLIENTS.map((client) => (
          <Tab key={client.id} value={client.id}>
            {client.label}
          </Tab>
        ))}
      </TabsList>
      {CLIENTS.map((client) => (
        <TabsPanel key={client.id} value={client.id}>
          <Snippet text={snippets[client.id]} hint={token ? client.hint : `${client.hint} Ersetze ${TOKEN_PLACEHOLDER} durch deinen Token.`} />
        </TabsPanel>
      ))}
    </Tabs>
  );
}
