import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const eventResultSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().describe('Event name and year, e.g. "Rotterdam Marathon 2026"'),
        eventDateDaysFromNow: z
          .number()
          .int()
          .optional()
          .describe('Days from today until the event, if a specific date was found'),
        location: z.string().optional(),
        distanceKm: z.number().positive().optional().describe('Race distance in km, if applicable'),
        description: z.string().describe('1-2 sentences describing the event'),
      }),
    )
    .max(5),
});

export interface GoalEventResult {
  title: string;
  eventDate: string | null;
  location: string | null;
  distanceKm: number | null;
  description: string;
}

const MAX_PAUSE_RESUMES = 3;

/** Runs a web-search-enabled request to completion, resuming through pause_turn (the
 * server's own iteration-limit signal) rather than treating it as done. */
async function researchWithWebSearch(client: Anthropic, params: Anthropic.MessageCreateParamsNonStreaming) {
  const messages = [...params.messages];
  for (let i = 0; i <= MAX_PAUSE_RESUMES; i++) {
    const response = await client.messages.create({ ...params, messages });
    if (response.stop_reason !== 'pause_turn') return response;
    messages.push({ role: 'assistant', content: response.content });
  }
  throw new Error('Web search took too many steps to find results.');
}

export async function searchGoalEvents(query: string): Promise<GoalEventResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Event search is not configured (missing ANTHROPIC_API_KEY).');
  if (!query.trim()) throw new Error('Enter something to search for first.');

  const client = new Anthropic({ apiKey });
  const today = new Date().toISOString().slice(0, 10);

  const research = await researchWithWebSearch(client, {
    model: 'claude-opus-5',
    max_tokens: 4096,
    system:
      `Today's date is ${today}. Use web search to find up to 5 specific, real, upcoming events ` +
      '(races, sportives, competitions) matching the athlete\'s search. Only include real events ' +
      "with a verifiable name, date, and location - never invent one. If nothing real matches, say " +
      'so plainly rather than guessing. Write up what you found in plain prose, including each ' +
      'event\'s exact date and distance where available.',
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
    messages: [{ role: 'user', content: query }],
  });

  const researchText = research.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  if (!researchText.trim()) return [];

  const structured = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 2048,
    system: `Today's date is ${today}. Convert the research below into the requested structured event list. If it found no real events, return an empty list.`,
    messages: [{ role: 'user', content: researchText }],
    output_config: { format: zodOutputFormat(eventResultSchema) },
  });

  if (!structured.parsed_output) {
    throw new Error('Could not parse search results from the model response.');
  }

  const now = Date.now();
  return structured.parsed_output.results.map((r) => ({
    title: r.title,
    eventDate: r.eventDateDaysFromNow != null ? new Date(now + r.eventDateDaysFromNow * 86400000).toISOString() : null,
    location: r.location ?? null,
    distanceKm: r.distanceKm ?? null,
    description: r.description,
  }));
}
