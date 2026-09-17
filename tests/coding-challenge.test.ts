import { describe, expect, it } from 'vitest';
import {
  generateDailyCodingChallenge,
  formatCodingChallengeCard,
  formatBoilerplateCard,
} from '../src/coding-challenge.ts';

describe('Coding Challenge Module', () => {
  it('generates a valid coding challenge with deliverables and boilerplate', async () => {
    const challenge = await generateDailyCodingChallenge(['Gemini 3.7 Flash released with reasoning']);
    expect(challenge).toBeDefined();
    expect(challenge.title).toBeTruthy();
    expect(challenge.estMinutes).toBeGreaterThan(0);
    expect(challenge.boilerplate).toBeDefined();
    expect(challenge.boilerplate.code).toBeTruthy();
    expect(challenge.boilerplate.filename).toBeTruthy();
  });

  it('formats coding challenge card in clean Telegram HTML', async () => {
    const challenge = await generateDailyCodingChallenge();
    const card = formatCodingChallengeCard(challenge);
    expect(card).toContain('Daily AI Coding Micro-Project');
    expect(card).toContain('<b>');
    expect(card).toContain(challenge.estMinutes.toString());
  });

  it('formats boilerplate card with pre code blocks', async () => {
    const challenge = await generateDailyCodingChallenge();
    const card = formatBoilerplateCard(challenge);
    expect(card).toContain('Starter Boilerplate');
    expect(card).toContain('<pre><code');
    expect(card).toContain(challenge.boilerplate.setupCommand);
  });
});
