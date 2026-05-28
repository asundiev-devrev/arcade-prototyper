import { extractComposites } from "./agentCursor";

export type StudioEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "origin"; source: "claude" | "computer" }
  | { kind: "narration"; text: string }
  | {
      kind: "tool_call";
      tool: string;
      pretty: string;
      /** Raw call detail for the expanded view (full path, full command, full
       *  Glob/Grep pattern, etc.). Absent for tools we don't have a detailed
       *  renderer for yet. */
      details?: string;
    }
  | {
      kind: "tool_call_started";
      toolUseId: string;
      tool: string;
      pretty: string;
    }
  | {
      kind: "tool_input_partial";
      toolUseId: string;
      action: "writing" | "editing";
      filePath?: string;
      partialContent: string;
    }
  | {
      kind: "tool_input_complete";
      toolUseId: string;
    }
  | {
      kind: "tool_result";
      tool: string;
      ok: boolean;
      /** Full result content (not truncated). UI decides how much to show. */
      snippet?: string;
    }
  | {
      kind: "agent_cursor";
      /** Frame slug being targeted, or null = parked (no clear target).
       *  Parser leaves this as null; client resolves via mapPathToFrame. */
      frame: string | null;
      action: "reading" | "writing" | "editing" | "thinking";
      filePath?: string;
      composites?: string[];
    }
  | { kind: "end"; ok: true }
  | { kind: "end"; ok: false; error: string; cancelled?: boolean };

function prettyTool(
  name: string,
  input: any,
): { tool: string; pretty: string; details?: string } {
  if (name === "Read") {
    return {
      tool: "Read",
      pretty: `Reading ${basename(input?.file_path)}`,
      details: input?.file_path ? String(input.file_path) : undefined,
    };
  }
  if (name === "Write") {
    return {
      tool: "Write",
      pretty: `Writing ${basename(input?.file_path)}`,
      details: input?.file_path ? String(input.file_path) : undefined,
    };
  }
  if (name === "Edit") {
    return {
      tool: "Edit",
      pretty: `Editing ${basename(input?.file_path)}`,
      details: input?.file_path ? String(input.file_path) : undefined,
    };
  }
  if (name === "Glob") {
    return {
      tool: "Glob",
      pretty: `Looking for files matching "${input?.pattern}"`,
      details: input?.pattern ? String(input.pattern) : undefined,
    };
  }
  if (name === "Grep") {
    return {
      tool: "Grep",
      pretty: `Searching for "${input?.pattern}"`,
      details: input?.pattern ? String(input.pattern) : undefined,
    };
  }
  if (name === "Bash") {
    const cmd = String(input?.command ?? "");
    if (cmd.includes("figmanage") || cmd.includes("figma-cli")) {
      return { tool: "Figma", pretty: figmaPretty(cmd), details: cmd };
    }
    return {
      tool: "Bash",
      pretty: firstLineTruncated(cmd) || "Running a command",
      details: cmd || undefined,
    };
  }
  return {
    tool: name,
    pretty: `Using ${name}`,
    details: input ? safeStringify(input) : undefined,
  };
}

function firstLineTruncated(s: string, max = 72): string {
  const line = (s.split("\n")[0] ?? "").trim();
  if (!line) return "";
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
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

function toolUseToCursor(name: string, input: any): StudioEvent {
  if (name === "Read") {
    return {
      kind: "agent_cursor",
      frame: null,
      action: "reading",
      filePath: input?.file_path ? String(input.file_path) : undefined,
    };
  }
  if (name === "Write") {
    return {
      kind: "agent_cursor",
      frame: null,
      action: "writing",
      filePath: input?.file_path ? String(input.file_path) : undefined,
      composites: extractComposites(String(input?.content ?? "")),
    };
  }
  if (name === "Edit") {
    return {
      kind: "agent_cursor",
      frame: null,
      action: "editing",
      filePath: input?.file_path ? String(input.file_path) : undefined,
      composites: extractComposites(String(input?.new_string ?? "")),
    };
  }
  return { kind: "agent_cursor", frame: null, action: "thinking" };
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
        out.push(toolUseToCursor(c.name, c.input));
      }
    }
    return out;
  }

  if (ev.type === "user" && ev.message?.content) {
    for (const c of ev.message.content) {
      if (c.type === "tool_result") {
        const snippet =
          typeof c.content === "string"
            ? c.content
            : Array.isArray(c.content)
            ? c.content
                .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
                .filter(Boolean)
                .join("\n")
            : undefined;
        return [{ kind: "tool_result", tool: "unknown", ok: !c.is_error, snippet }];
      }
    }
    return [];
  }

  if (ev.type === "result") {
    // claude's "result" event can say `subtype: "success"` while still
    // being a failure — it sets `is_error: true` and puts the message in
    // `result`. AWS SSO expiry hits this exact shape:
    //   {type:"result", subtype:"success", is_error:true,
    //    result:"API Error: Token is expired. To refresh this SSO session
    //           run 'aws sso login' with the corresponding profile."}
    // Before we honored `is_error`, the parser reported this as a
    // successful turn with no content, the UI stopped "Thinking…" and
    // showed nothing — the user had no idea their creds had expired.
    if (ev.is_error) {
      const msg = typeof ev.result === "string" && ev.result.trim()
        ? ev.result
        : (ev.error ? String(ev.error) : "Agent returned an error.");
      return [{ kind: "end", ok: false, error: msg }];
    }
    if (ev.subtype === "success") return [{ kind: "end", ok: true }];
    return [{ kind: "end", ok: false, error: String(ev.error ?? "Agent error") }];
  }

  return [];
}
