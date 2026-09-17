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
    'what should I code today?',
    'suggest a coding challenge',
    'daily coding task',
    'give me an AI coding challenge',
    'what to code today',
  ])('classifies %j as coding_challenge', (msg) => {
    expect(fastHeuristicIntent(msg)?.intent).toBe('coding_challenge');
  });

  it.each([
    'generate the boilerplate',
    'give me starter code',
    'show boilerplate',
    'scaffold code',
  ])('classifies %j as generate_boilerplate', (msg) => {
    expect(fastHeuristicIntent(msg)?.intent).toBe('generate_boilerplate');
  });

  it.each([
    'how is my github streak?',
    'how is my streak',
    'github streak',
    'did I push code today',
    'check my commits',
  ])('classifies %j as github_streak', (msg) => {
    expect(fastHeuristicIntent(msg)?.intent).toBe('github_streak');
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
