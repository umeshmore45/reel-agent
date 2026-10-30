import { spawn } from 'node:child_process';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { OUTPUT_SCHEMA } from './schema.js';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// Optional: e.g. AGENT_MODEL=sonnet for faster edits. Unset = your Claude Code default model.
const AGENT_MODEL = process.env.AGENT_MODEL;
const TIMEOUT_MS = 8 * 60 * 1000;

/**
 * Runs one turn of the editor agent in the project's folder.
 * First turn uses --session-id, later turns --resume, so the agent remembers the conversation.
 * The answer comes back as structured output ({ reply, timeline?, post? }) validated by OUTPUT_SCHEMA.
 * onActivity gets short progress notes ({ type: 'read', file } / { type: 'note', text }).
 * Returns a function that kills the process.
 */
export function runAgent({ prompt, sessionId, resume, cwd, onActivity, onDone, onError }) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    resume ? '--resume' : '--session-id', sessionId,
    '--append-system-prompt', SYSTEM_PROMPT,
    '--json-schema', JSON.stringify(OUTPUT_SCHEMA),
    // Read only: it looks at contact-sheet images in the project folder. No shell, web, or write access.
    '--tools', 'Read',
    '--allowedTools', 'Read',
  ];
  if (AGENT_MODEL) args.unshift('--model', AGENT_MODEL);

  // Strip vars set when the server itself is started from inside a Claude Code session.
  const { CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ...env } = process.env;
  const child = spawn(CLAUDE_BIN, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(prompt);

  let buffer = '';
  let stderr = '';
  let structured = null;
  let resultError = null;
  let finished = false;
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    finish(() => onError('The agent took too long and was stopped. Try a smaller request.'));
  }, TIMEOUT_MS);

  function finish(fn) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    fn();
  }

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }

      if (evt.type === 'assistant') {
        for (const block of evt.message?.content || []) {
          if (block.type === 'tool_use' && block.name === 'Read') onActivity({ type: 'read', file: block.input?.file_path || '' });
          else if (block.type === 'tool_use' && block.name === 'StructuredOutput') structured = block.input;
          else if (block.type === 'text' && block.text?.trim()) onActivity({ type: 'note', text: block.text.trim().slice(0, 200) });
        }
      } else if (evt.type === 'result') {
        if (evt.structured_output) structured = evt.structured_output;
        if (evt.is_error && !structured) resultError = evt.result || evt.errors?.join(' ') || 'The agent returned an error';
      }
    }
  });

  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', (err) => finish(() => onError(`Failed to start claude: ${err.message}`)));
  child.on('close', (code) => {
    if (structured) finish(() => onDone(structured));
    else finish(() => onError(resultError || stderr.trim().slice(-500) || `claude exited with code ${code}`));
  });

  return () => child.kill('SIGTERM');
}
