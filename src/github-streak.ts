/**
 * GitHub Contribution & Streak Watchdog.
 *
 * Tracks daily GitHub commits and contribution streaks to keep Emman's
 * 365-day commit momentum alive and provide proactive alerts.
 */
import { config } from './config.ts';

export interface GitHubStreakStatus {
  username: string;
  commitsToday: number;
  currentStreak: number;
  longestStreak: number;
  totalContributions: number;
  hasCommittedToday: boolean;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Fetch GitHub user commit and streak status.
 * Uses public Events API or GraphQL contributions endpoint.
 */
export async function fetchGitHubStreak(
  targetUsername?: string,
  token?: string
): Promise<GitHubStreakStatus> {
  const username = targetUsername || (config as any).githubUsername || 'emmanalcazarjr-ops';
  const ghToken = token || (config as any).githubToken || config.vaultPat;

  const defaultStatus: GitHubStreakStatus = {
    username,
    commitsToday: 0,
    currentStreak: 1,
    longestStreak: 1,
    totalContributions: 0,
    hasCommittedToday: false,
  };

  try {
    // 1. Try GitHub GraphQL API if token is present
    if (ghToken) {
      const query = `
        query($username: String!) {
          user(login: $username) {
            contributionsCollection {
              contributionCalendar {
                totalContributions
                weeks {
                  contributionDays {
                    contributionCount
                    date
                  }
                }
              }
            }
          }
        }
      `;

      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'RushDailyBot/1.0',
        },
        body: JSON.stringify({ query, variables: { username } }),
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const json = (await res.json()) as any;
        const calendar = json.data?.user?.contributionsCollection?.contributionCalendar;
        if (calendar?.weeks) {
          const allDays = calendar.weeks.flatMap((w: any) => w.contributionDays || []);
          if (allDays.length > 0) {
            // Find today (Manila / ISO)
            const todayIso = new Date().toISOString().slice(0, 10);
            const todayEntry = allDays.find((d: any) => d.date === todayIso) || allDays[allDays.length - 1];
            const commitsToday = todayEntry?.contributionCount || 0;

            // Compute current active streak backwards
            let streak = 0;
            let maxStreak = 0;
            let tempStreak = 0;

            for (let i = allDays.length - 1; i >= 0; i--) {
              const count = allDays[i].contributionCount;
              if (i === allDays.length - 1 && count === 0) {
                // If today has 0 commits yet, don't break streak if yesterday was active
                continue;
              }
              if (count > 0) {
                streak++;
              } else {
                break;
              }
            }

            for (const d of allDays) {
              if (d.contributionCount > 0) {
                tempStreak++;
                if (tempStreak > maxStreak) maxStreak = tempStreak;
              } else {
                tempStreak = 0;
              }
            }

            return {
              username,
              commitsToday,
              currentStreak: Math.max(commitsToday > 0 ? 1 : 0, streak),
              longestStreak: Math.max(maxStreak, streak),
              totalContributions: calendar.totalContributions || commitsToday,
              hasCommittedToday: commitsToday > 0,
            };
          }
        }
      }
    }

    // 2. Fallback: Public Events REST API (Zero auth required)
    const eventsUrl = `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=30`;
    const res = await fetch(eventsUrl, {
      headers: { 'User-Agent': 'RushDailyBot/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const events = (await res.json()) as any[];
      const todayIso = new Date().toISOString().slice(0, 10);

      let todayPushes = 0;
      for (const ev of events) {
        if (ev.type === 'PushEvent' && ev.created_at?.startsWith(todayIso)) {
          const commits = ev.payload?.commits?.length || 1;
          todayPushes += commits;
        }
      }

      return {
        username,
        commitsToday: todayPushes,
        currentStreak: todayPushes > 0 ? 1 : 0,
        longestStreak: 1,
        totalContributions: events.length,
        hasCommittedToday: todayPushes > 0,
      };
    }
  } catch (err) {
    console.warn('GitHub streak fetch error:', err);
  }

  return defaultStatus;
}

export function formatStreakCard(status: GitHubStreakStatus): string {
  const statusIcon = status.hasCommittedToday ? '🔥' : '⚠️';
  const statusText = status.hasCommittedToday
    ? `<b>Active!</b> (<code>${status.commitsToday}</code> commits pushed today)`
    : `<b>Pending</b> — <code>0</code> commits today. Push code before midnight, sir!`;

  return [
    `${statusIcon} <b>GitHub Contribution Watchdog</b>`,
    `👤 <b>User:</b> <code>${escapeHtml(status.username)}</code>`,
    '',
    `• <b>Today's Status:</b> ${statusText}`,
    `• <b>Current Streak:</b> <code>${status.currentStreak} days</code>`,
    `• <b>Total Contributions:</b> <code>${status.totalContributions}</code>`,
    '',
    status.hasCommittedToday
      ? `✨ <i>Daily GitHub commit requirement satisfied, sir. Keep the fire burning!</i>`
      : `🎯 <i>Build today's AI micro-project and push a commit to keep your streak alive!</i>`,
  ].join('\n');
}

/**
 * 1-Click Scaffold to GitHub Gist
 */
export async function createGitHubGist(
  filename: string,
  content: string,
  description: string
): Promise<string | null> {
  const token = (config as any).githubToken || config.vaultPat;
  if (!token) return null;

  try {
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'RushDailyBot/1.0',
      },
      body: JSON.stringify({
        description,
        public: true,
        files: {
          [filename]: { content },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      return data.html_url || null;
    }
  } catch (err) {
    console.error('Failed to create GitHub Gist:', err);
  }

  return null;
}
