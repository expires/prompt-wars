// Anthropic streaming generator: the model writes NDJSON lines, parsed as they arrive.

import Anthropic from '@anthropic-ai/sdk';
import { DesignAssembler, NdjsonParser } from './assembler';
import { FORGE_SYSTEM_PROMPT, buildUserPrompt, type PromptContext } from './prompt';
import { OUTFIT_SYSTEM_PROMPT, buildOutfitUserPrompt, type OutfitAssembler, type OutfitPromptContext } from './outfit';

let client: Anthropic | null = null;
function getClient(apiKey: string): Anthropic {
  return (client ??= new Anthropic({ apiKey, maxRetries: 1 }));
}

/** Haiku 4.5 and older take no `effort`; newer models get low effort for speed. */
function modelParams(model: string): Record<string, unknown> {
  if (/haiku-4-5|claude-3|sonnet-4-5|opus-4-1|opus-4-0|sonnet-4-0/.test(model)) return {};
  return { output_config: { effort: 'low' } };
}

export async function generateWithLlm(
  opts: { apiKey: string; model: string; signal: AbortSignal },
  ctx: PromptContext,
  asm: DesignAssembler,
): Promise<void> {
  const anthropic = getClient(opts.apiKey);
  const debug = process.env.FORGE_DEBUG_RAW === '1';
  const parser = new NdjsonParser(o => {
    if (debug) console.log(`[forge raw] ${JSON.stringify(o).slice(0, 600)}`);
    asm.push(o);
  }, line => asm.warnings.push(`unparsed model line: ${line.slice(0, 80)}`));
  const stream = anthropic.messages.stream(
    {
      model: opts.model,
      max_tokens: 12000,
      system: [{ type: 'text', text: FORGE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserPrompt(ctx) }],
      ...modelParams(opts.model),
    } as Anthropic.MessageStreamParams,
    { signal: opts.signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') parser.push(event.delta.text);
  }
  parser.end();
  const final = await stream.finalMessage();
  if (final.stop_reason === 'max_tokens') asm.warnings.push('model hit max_tokens; design may be incomplete');
  if (final.stop_reason === 'refusal') asm.warnings.push('model declined this request');
}

/** Closet: same streaming, outfit prompt + assembler. */
export async function generateOutfitWithLlm(
  opts: { apiKey: string; model: string; signal: AbortSignal },
  ctx: OutfitPromptContext,
  asm: OutfitAssembler,
): Promise<void> {
  const anthropic = getClient(opts.apiKey);
  const debug = process.env.FORGE_DEBUG_RAW === '1';
  const parser = new NdjsonParser(o => {
    if (debug) console.log(`[closet raw] ${JSON.stringify(o).slice(0, 600)}`);
    asm.push(o);
  }, line => asm.warnings.push(`unparsed model line: ${line.slice(0, 80)}`));
  const stream = anthropic.messages.stream(
    {
      model: opts.model,
      max_tokens: 8000,
      system: [{ type: 'text', text: OUTFIT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildOutfitUserPrompt(ctx) }],
      ...modelParams(opts.model),
    } as Anthropic.MessageStreamParams,
    { signal: opts.signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') parser.push(event.delta.text);
  }
  parser.end();
  const final = await stream.finalMessage();
  if (final.stop_reason === 'max_tokens') asm.warnings.push('model hit max_tokens; outfit may be incomplete');
  if (final.stop_reason === 'refusal') asm.warnings.push('model declined this request');
}
