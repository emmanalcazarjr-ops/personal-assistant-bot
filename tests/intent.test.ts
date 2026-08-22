import { describe, expect, it } from 'vitest';
import { fastHeuristicIntent } from '../src/intent.ts';

describe('fastHeuristicIntent', () => {
  it('routes any URL to curation with max confidence', () => {
    const r = fastHeuristicIntent('check this out https://github.com/some/repo');
    expect(r?.intent).toBe('curation');
    expect(r?.confidence).toBe(1.0);
  });

  it('treats forwarded messages as curation even without a URL', () => {
    const r = fastHeuristicIntent('look at this', true);
    expect(r?.intent).toBe('curation');
  });

  it.each([
    'how many calories left today?',
    'show me calories',
    'calories left',
    'what did I eat today?',
  ])('classifies %j as food_query', (msg) => {
    expect(fastHeuristicIntent(msg)?.intent).toBe('food_query');
  });

  it.each([
    'I ate 2 eggs and rice',
    'had coffee this morning',
    'eating chicken right now',
    'for lunch: beef bowl',
  ])('classifies %j as food_log and keeps the description', (msg) => {
    const r = fastHeuristicIntent(msg);
    expect(r?.intent).toBe('food_log');
    expect(r?.extracted?.food_description).toBe(msg);
  });

  it.each([
    'remind me to deploy at 5pm',
    "don't forget to call mom",
    'set a reminder for gym',
  ])('classifies %j as reminder', (msg) => {
    expect(fastHeuristicIntent(msg)?.intent).toBe('reminder');
  });

  it('parses note text and strips #tags', () => {
    const r = fastHeuristicIntent('note down: database url changed #infra #urgent');
    expect(r?.intent).toBe('note');
    expect(r?.extracted?.note_text).toBe('database url changed');
    expect(r?.extracted?.note_tags).toEqual(['infra', 'urgent']);
  });

  it.each([
    'give me my briefing',
    'morning briefing please',
    'status report',
    "what's on today",
  ])('classifies %j as briefing', (msg) => {
    expect(fastHeuristicIntent(msg)?.intent).toBe('briefing');
  });

  it('returns null for casual chat so the AI router takes over', () => {
    expect(fastHeuristicIntent('hello there, how was your day?')).toBeNull();
  });
});
