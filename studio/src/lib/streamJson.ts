export type StudioEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "narration"; text: string }
  | { kind: "tool_call"; tool: string; pretty: string }
  | { kind: "tool_result"; tool: string; ok: boolean; snippet?: string }
  | { kind: "end"; ok: true }
  | { kind: "end"; ok: false; error: string };

function prettyTool(name: string, input: any): { tool: string; pretty: string } {
  if (name === "Read") return { tool: "Read", pretty: `Reading ${basename(input?.file_path)}` };
  if (name === "Write") return { tool: "Write", pretty: `Writing ${basename(input?.file_path)}` };
  if (name === "Edit") return { tool: "Edit", pretty: `Editing ${basename(input?.file_path)}` };
  if (name === "Glob") return { tool: "Glob", pretty: `Looking for files matching "${input?.pattern}"` };
  if (name === "Grep") return { tool: "Grep", pretty: `Searching for "${input?.pattern}"` };
  if (name === "Bash") {
    const cmd = String(input?.command ?? "");
    if (cmd.includes("figmanage") || cmd.includes("figma-cli")) {
      return { tool: "Figma", pretty: figmaPretty(cmd) };
    }
    return { tool: "Bash", pretty: "Running a command" };
  }
  return { tool: name, pretty: `Using ${name}` };
}

function figmaPretty(cmd: string): string {
  if (cmd.includes(" get-nodes") || cmd.includes(" node tree ") || cmd.includes(" get ")) {
    return "Reading Figma frame structure";
  }
  if (cmd.includes(" get-file")) return "Reading Figma file";
  if (cmd.includes(" export")) return "Exporting from Figma";
  if (cmd.includes(" find ")) return "Finding a Figma node";
  if (cmd.includes(" daemon status") || cmd.includes(" connect")) return "Connecting to Figma";
  return "Working with Figma";
}

function basename(p?: string): string {
  if (!p) return "a file";
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

export function parseStreamLine(line: string): StudioEvent | null {
  const events = parseStreamLineAll(line);
  return events.length > 0 ? events[0] : null;
}

export function parseStreamLineAll(line: string): StudioEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let ev: any;
  try { ev = JSON.parse(trimmed); } catch { return []; }

  if (ev.type === "system" && ev.subtype === "init" && ev.session_id) {
    return [{ kind: "session", sessionId: ev.session_id }];
  }

  if (ev.type === "assistant" && ev.message?.content) {
    const out: StudioEvent[] = [];
    for (const c of ev.message.content) {
      if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
        out.push({ kind: "narration", text: c.text });
      } else if (c.type === "tool_use") {
        const pr = prettyTool(c.name, c.input);
        out.push({ kind: "tool_call", ...pr });
      }
    }
    return out;
  }

  if (ev.type === "user" && ev.message?.content) {
    for (const c of ev.message.content) {
      if (c.type === "tool_result") {
        const snippet = typeof c.content === "string" ? c.content.slice(0, 140) : undefined;
        return [{ kind: "tool_result", tool: "unknown", ok: !c.is_error, snippet }];
      }
    }
    return [];
  }

  if (ev.type === "result") {
    if (ev.subtype === "success") return [{ kind: "end", ok: true }];
    return [{ kind: "end", ok: false, error: String(ev.error ?? "Agent error") }];
  }

  return [];
}
