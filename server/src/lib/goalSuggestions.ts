import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { prisma } from './prisma.js';

const suggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        title: z
          .string()
          .describe('Short, specific goal title - name the real event if one was found, e.g. "Run the Rotterdam Marathon (Apr 12, 2026)"'),
        targetValue: z.number().positive(),
        unit: z.string().min(1).describe('Unit for targetValue, e.g. km, hours, workouts'),
        deadlineDaysFromNow: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Days from today the goal should be reached by - the event date, if a real event was found'),
        rationale: z
          .string()
          .describe('1-2 sentences: what was found (event/date/location if applicable) and why it fits their training'),
      }),
    )
    .min(1)
    .max(3),
});

export interface GoalSuggestion {
  title: string;
  targetValue: number;
  unit: string;
  deadline: string | null;
  rationale: string;
}

async function buildTrainingSummary(userId: string): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const [workouts, goals] = await Promise.all([
    prisma.workout.findMany({ where: { userId, date: { gte: since } } }),
    prisma.goal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ]);

  const byType: Record<string, { count: number; distanceKm: number; durationMin: number }> = {};
  for (const w of workouts) {
    byType[w.type] ??= { count: 0, distanceKm: 0, durationMin: 0 };
    byType[w.type].count += 1;
    byType[w.type].distanceKm += w.distanceKm ?? 0;
    byType[w.type].durationMin += w.durationMin;
  }

  const trainingLines =
    Object.entries(byType)
      .map(
        ([type, t]) =>
          `- ${type}: ${t.count} workouts, ${t.distanceKm.toFixed(1)} km total, ${(t.durationMin / 60).toFixed(1)} hours total`,
      )
      .join('\n') || '(no workouts logged in the last 90 days)';

  const goalLines =
    goals
      .map((g) => `- "${g.title}": ${g.currentValue}/${g.targetValue} ${g.unit}${g.deadline ? ` by ${g.deadline.toISOString().slice(0, 10)}` : ''}`)
      .join('\n') || '(no goals set yet)';

  return `Training over the last 90 days:\n${trainingLines}\n\nCurrent goals:\n${goalLines}`;
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
  throw new Error('Web search took too many steps to find an event.');
}

export async function suggestGoals(userId: string, prompt: string): Promise<GoalSuggestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('AI goal suggestions are not configured (missing ANTHROPIC_API_KEY).');
  if (!prompt.trim()) throw new Error('Describe what you want to train for first.');

  const summary = await buildTrainingSummary(userId);
  const client = new Anthropic({ apiKey });
  const today = new Date().toISOString().slice(0, 10);

  // Step 1: research - find a specific real event (or a concrete milestone) via web search.
  const research = await researchWithWebSearch(client, {
    model: 'claude-opus-5',
    max_tokens: 4096,
    system:
      "You are a training coach embedded in a personal fitness dashboard. Today's date is " +
      `${today}. The athlete will describe what they want to train for. Use web search to find ` +
      '1-3 SPECIFIC, REAL, upcoming events (races, sportives, competitions) that fit their request ' +
      "- a real event name, date, and location, not a made-up or generic one. Prefer events within " +
      "the next 12 months. If the athlete's request doesn't call for a specific event (e.g. \"get " +
      'faster\", "build a base"), skip web search and instead propose a specific, measurable ' +
      'milestone grounded in their training data instead. Write up what you found in plain prose.',
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
    messages: [{ role: 'user', content: `${summary}\n\nWhat I want to train for: ${prompt}` }],
  });

  const researchText = research.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  if (!researchText.trim()) {
    throw new Error('Could not find a matching event or goal - try rephrasing what you want to train for.');
  }

  // Step 2: turn that research into structured goal suggestions.
  const structured = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 2048,
    system: `Today's date is ${today}. Convert the research below into the requested structured goal suggestions.`,
    messages: [{ role: 'user', content: researchText }],
    output_config: { format: zodOutputFormat(suggestionSchema) },
  });

  if (!structured.parsed_output) {
    throw new Error('Could not parse goal suggestions from the model response.');
  }

  const now = Date.now();
  return structured.parsed_output.suggestions.map((s) => ({
    title: s.title,
    targetValue: s.targetValue,
    unit: s.unit,
    deadline: s.deadlineDaysFromNow ? new Date(now + s.deadlineDaysFromNow * 86400000).toISOString() : null,
    rationale: s.rationale,
  }));
}
