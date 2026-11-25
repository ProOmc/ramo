/**
 * PowerShell subcommand scanner for the approval card and the tiered shell.
 *
 * Modeled on OpenCode's shell scanner (packages/core/src/shell/scan.ts in
 * github.com/anomalyco/opencode): show the actual programs a command will run,
 * not just the raw command string. Ramo-owned code, no import. This is a
 * presentation/permission aid only — the hard denylist and the prompt remain
 * authoritative, and a command that cannot be scanned is still shown in full.
 *
 * `scanPowerShellInvocations` additionally keeps the argument tokens after each
 * program so the tiered-shell read-only policy (shell-tier.ts) can decide per
 * program AND subcommand without evaluating the command.
 */

const CONTROL_WORDS = new Set([
  "if", "else", "elseif", "foreach", "for", "while", "do", "switch", "try", "catch", "finally",
  "return", "exit", "throw", "break", "continue", "function", "filter", "param", "begin", "process", "end",
  "using", "class", "import-module", "set-strictmode",
]);

/** Split a PowerShell command into statement segments without evaluating it. */
export function splitPowerShell(command: string): string[] {
  const withoutComments = String(command || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");
  return withoutComments
    .split(/;|&&|\|\||\r?\n|\|(?!\|)/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Extract the invoked program names from a PowerShell command string. */
export function scanPowerShell(command: string): string[] {
  const found: string[] = [];
  for (const invocation of scanPowerShellInvocations(command)) {
    const name = invocation.program;
    if (!found.some((entry) => entry.toLowerCase() === name.toLowerCase())) found.push(name);
  }
  return found;
}

/** One invoked program and the argument tokens that followed it. */
export interface ScannedInvocation {
  program: string;
  args: string[];
}

/** Split the text after a program into argument tokens, preserving quoted values. */
function tokenizeArguments(text: string): string[] {
  const tokens = text.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  });
}

/**
 * Extract each invoked program together with its argument tokens. Used by the
 * tiered-shell read-only policy; it never evaluates or executes the command.
 */
export function scanPowerShellInvocations(command: string): ScannedInvocation[] {
  const invocations: ScannedInvocation[] = [];
  for (const segment of splitPowerShell(command)) {
    // Assignments and variable declarations are not programs.
    if (/^\$[\w-]+\s*=/.test(segment)) continue;
    let text = segment.replace(/^&+\s*/, "").replace(/^\(\s*/, "").trim();
    // Skip a control-flow header so the command inside its block is still named.
    text = text.replace(/^(?:if|elseif|foreach|for|while|switch|try|catch|finally|do|function|filter|process|begin|end)\b[^{]*\{\s*/i, "").trim();
    const match = text.match(/^(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.-]*))/);
    if (!match) continue;
    const program = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!program || CONTROL_WORDS.has(program.toLowerCase())) continue;
    const args = tokenizeArguments(text.slice(match[0].length).trim());
    invocations.push({ program, args });
  }
  return invocations;
}
