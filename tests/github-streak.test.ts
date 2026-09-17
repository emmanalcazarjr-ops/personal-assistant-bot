import { describe, expect, it } from 'vitest';
import {
  fetchGitHubStreak,
  formatStreakCard,
} from '../src/github-streak.ts';

describe('GitHub Streak Watchdog', () => {
  it('formats streak card properly for active commits', () => {
    const card = formatStreakCard({
      username: 'emmanalcazarjr-ops',
      commitsToday: 4,
      currentStreak: 12,
      longestStreak: 30,
      totalContributions: 450,
      hasCommittedToday: true,
    });

    expect(card).toContain('GitHub Contribution Watchdog');
    expect(card).toContain('Active!');
    expect(card).toContain('4');
    expect(card).toContain('12 days');
  });

  it('formats streak card with alert when 0 commits today', () => {
    const card = formatStreakCard({
      username: 'emmanalcazarjr-ops',
      commitsToday: 0,
      currentStreak: 5,
      longestStreak: 20,
      totalContributions: 300,
      hasCommittedToday: false,
    });

    expect(card).toContain('GitHub Contribution Watchdog');
    expect(card).toContain('Pending');
    expect(card).toContain('0');
    expect(card).toContain('Push code before midnight');
  });

  it('fetches GitHub streak fallback without errors', async () => {
    const status = await fetchGitHubStreak('emmanalcazarjr-ops');
    expect(status).toBeDefined();
    expect(status.username).toBe('emmanalcazarjr-ops');
  });
});
