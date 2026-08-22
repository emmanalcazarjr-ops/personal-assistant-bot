import { describe, expect, it } from 'vitest';
import { extractReminderTime } from '../src/time.ts';

// Fixed reference: Saturday 2026-08-22, 18:00 local
const NOW = new Date(2026, 7, 22, 18, 0, 0);

describe('extractReminderTime — relative phrases', () => {
  it('parses "in 30 minutes"', () => {
    const r = extractReminderTime('remind me to deploy in 30 minutes', NOW)!;
    expect(r.due.getTime() - NOW.getTime()).toBe(30 * 60000);
    expect(r.rest).toBe('deploy');
  });

  it('parses "in 2 hours"', () => {
    const r = extractReminderTime('push code in 2 hours', NOW)!;
    expect(r.due.getTime() - NOW.getTime()).toBe(120 * 60000);
    expect(r.rest).toBe('push code');
  });

  it('parses compound "in 1 hour and 30 minutes"', () => {
    const r = extractReminderTime('call mom in 1 hour and 30 minutes', NOW)!;
    expect(r.due.getTime() - NOW.getTime()).toBe(90 * 60000);
    expect(r.rest).toBe('call mom');
  });
});

describe('extractReminderTime — clock times', () => {
  it('parses 12h clock "at 5pm"', () => {
    const r = extractReminderTime('remind me to call mom at 5pm', NOW)!;
    expect(r.due.getHours()).toBe(17);
    expect(r.rest).toBe('call mom');
  });

  it('parses 24h clock "at 17:30"', () => {
    const r = extractReminderTime('submit report at 17:30', NOW)!;
    expect(r.due.getHours()).toBe(17);
    expect(r.due.getMinutes()).toBe(30);
  });

  it('rolls past times to tomorrow', () => {
    const r = extractReminderTime('wake up at 9am', NOW)!; // now is 18:00
    expect(r.due.getDate()).toBe(23);
    expect(r.due.getHours()).toBe(9);
  });
});

describe('extractReminderTime — day words', () => {
  it('"tomorrow" without a clock defaults to 9am next day', () => {
    const r = extractReminderTime('buy water tomorrow', NOW)!;
    expect(r.due.getDate()).toBe(23);
    expect(r.due.getHours()).toBe(9);
    expect(r.rest).toBe('buy water');
  });

  it('"tonight" defaults to 8pm today', () => {
    const r = extractReminderTime('submit report tonight', NOW)!;
    expect(r.due.getDate()).toBe(22);
    expect(r.due.getHours()).toBe(20);
  });

  it('maps weekday names forward relative to the reference date', () => {
    // 2026-08-22 is a Saturday → next Monday is the 24th
    const r = extractReminderTime('team sync monday 9am', NOW)!;
    expect(r.due.getDate()).toBe(24);
    expect(r.due.getDay()).toBe(1);
    expect(r.due.getHours()).toBe(9);
    expect(r.rest).toBe('team sync');
  });

  it('returns null when no time phrase exists', () => {
    expect(extractReminderTime('buy groceries sometime', NOW)).toBeNull();
  });
});
