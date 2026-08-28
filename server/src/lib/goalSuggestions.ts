import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { prisma } from './prisma.js';

const suggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.string().describe('Short, specific goal title, e.g. "Run a sub-50-minute 10K"'),
        targetValue: z.number().positive(),
        unit: z.string().min(1).describe('Unit for targetValue, e.g. km, hours, workouts'),
        deadlineDaysFromNow: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Days from today the goal should be reached by, if a deadline makes sense'),
        rationale: z.string().describe('One sentence on why this goal fits their recent training'),
      }),
    )
    .min(1)
    .max(4),
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

export async function suggestGoals(userId: string): Promise<GoalSuggestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('AI goal suggestions are not configured (missing ANTHROPIC_API_KEY).');

  const summary = await buildTrainingSummary(userId);
  const client = new Anthropic({ apiKey });

  const response = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 4096,
    system:
      'You are a training coach embedded in a personal fitness dashboard. Given an athlete\'s ' +
      'recent training data and current goals, suggest new, specific, realistic upcoming goals. ' +
      "Base target values on their actual recent volume - don't suggest something wildly out of " +
      "reach or trivially easy. Don't repeat an existing goal. Cover a mix of disciplines they " +
      'actually train, when the data supports it.',
    messages: [{ role: 'user', content: summary }],
    output_config: { format: zodOutputFormat(suggestionSchema) },
  });

  if (!response.parsed_output) {
    throw new Error('Could not parse goal suggestions from the model response.');
  }

  const now = Date.now();
  return response.parsed_output.suggestions.map((s) => ({
    title: s.title,
    targetValue: s.targetValue,
    unit: s.unit,
    deadline: s.deadlineDaysFromNow ? new Date(now + s.deadlineDaysFromNow * 86400000).toISOString() : null,
    rationale: s.rationale,
  }));
}
