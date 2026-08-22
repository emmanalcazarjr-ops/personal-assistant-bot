/**
 * Friendly natural-language time parsing for reminders.
 * Understands:
 *   "in 30 minutes", "in 2 hours", "in 1 hour and 30 minutes"
 *   "at 5pm", "at 17:30", "5:45am"
 *   "tomorrow 8am", "tomorrow", "tonight"
 *   "monday 9am", "next friday 6pm"
 * Returns { due, rest } where `rest` is the reminder text with the time
 * phrase removed, or null when no time could be parsed.
 */

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export interface ParsedTime {
  due: Date;
  rest: string;
}

/** Find a phrase like "in 30 minutes" / "in 2 hours" / "in 1 hour 30 min".
 * Alternation is longest-first so "minutes" is consumed fully (not "minute" + stray "s"). */
function parseRelative(text: string, now: Date): { due: Date; phrase: string } | null {
  const m = text.match(
    /\bin\s+(\d+)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m|days?)(?:\s*(?:and\s*)?(\d+)\s*(minutes?|mins?|min|m))?/i
  );
  if (!m) return null;
  let minutes = 0;
  const unit = m[2].toLowerCase();
  const amount = Number(m[1]);
  if (unit.startsWith('h')) minutes += amount * 60;
  else if (unit.startsWith('d')) minutes += amount * 1440;
  else minutes += amount;
  if (m[3] && m[4]) {
    minutes += Number(m[3]); // second group only accepts minute units
  }
  const due = new Date(now.getTime() + minutes * 60000);
  return { due, phrase: m[0] };
}

/** Find a time of day like "5pm", "17:30", "8 am". Returns {hours, minutes}. */
function parseClock(text: string): { hours: number; minutes: number; phrase: string } | null {
  // 24h first: 17:30 or 17.30
  const m24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m24) {
    const hours = Number(m24[1]);
    if (hours <= 23) {
      return { hours, minutes: Number(m24[2]), phrase: m24[0] };
    }
  }
  // 12h: 5pm, 5:30 pm, 8am, 12am
  const m12 = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i);
  if (m12) {
    let hours = Number(m12[1]) % 12;
    const mer = (m12[3] || '').toLowerCase().replace(/\./g, '');
    if (mer.startsWith('p')) hours += 12;
    return { hours, minutes: m12[2] ? Number(m12[2]) : 0, phrase: m12[0] };
  }
  return null;
}

/** Find a day word: "tomorrow", "tonight", weekday names. */
function parseDay(text: string, now = new Date()): { dayOffset: number; phrase: string } | null {
  if (/\btomorrow\b/i.test(text)) return { dayOffset: 1, phrase: 'tomorrow' };
  if (/\btonight\b/i.test(text)) return { dayOffset: 0, phrase: 'tonight' };
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const re = new RegExp(`\\b(${WEEKDAYS[i]})(?:day)?\\b`, 'i');
    const m = text.match(re);
    if (m) {
      const target = i;
      const today = now.getDay();
      let offset = (target - today + 7) % 7;
      if (offset === 0) offset = 7; // next week, not today
      return { dayOffset: offset, phrase: m[0] };
    }
  }
  return null;
}

/** Strip leftover whitespace, leading/trailing punctuation and dangling conjunctions ("call mom at"). */
function cleanRest(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s,]+/, '')
    .replace(/\s+(at|by|on|in)$/i, '')
    .replace(/[,\s]+$/g, '');
}

export function extractReminderTime(input: string, now = new Date()): ParsedTime | null {
  let text = input.trim().replace(/^(remind me to|remind me|reminder)\s*/i, '');
  // strip leading "at" / "by"
  text = text.replace(/^(at|by)\s+/i, '');

  const relative = parseRelative(text, now);
  if (relative) {
    return { due: relative.due, rest: cleanRest(text.replace(relative.phrase, '')) };
  }

  const day = parseDay(text, now);
  const clock = parseClock(text);

  if (!day && !clock) return null;

  const base = new Date(now);
  if (day) {
    base.setDate(base.getDate() + day.dayOffset);
    if (day.phrase.toLowerCase() === 'tonight') {
      base.setHours(20, 0, 0, 0);
    } else if (!clock) {
      base.setHours(9, 0, 0, 0); // default morning time for "tomorrow"/weekday
    }
  }

  if (clock) {
    base.setHours(clock.hours, clock.minutes, 0, 0);
    // if the parsed day was implicit (today) and the time already passed, roll to tomorrow
    if (!day && base.getTime() <= now.getTime()) {
      base.setDate(base.getDate() + 1);
    }
  }

  let rest = text;
  if (clock) rest = rest.replace(clock.phrase, '');
  if (day) rest = rest.replace(day.phrase, '');

  return { due: base, rest: cleanRest(rest) };
}

/** Human-friendly formatting for reminder listings. */
export function formatDue(due: Date, tz = 'Asia/Manila'): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(due);
}
