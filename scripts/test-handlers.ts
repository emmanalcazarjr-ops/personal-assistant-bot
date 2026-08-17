// Local smoke test for the api handlers (run: npx tsx scripts/test-handlers.ts)
import cronReminders from '../api/cron-reminders.ts';
import cronBriefing from '../api/cron-briefing.ts';
import webhook from '../api/webhook.ts';

function mockRes() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    end(s?: string) { console.log('RES', this.statusCode, (s || '').slice(0, 120)); },
    writableEnded: false,
  };
}

const res1 = mockRes();
await cronReminders({ method: 'POST', headers: {} } as any, res1 as any);
console.log('---');
const res2 = mockRes();
await cronBriefing({ method: 'POST', headers: {} } as any, res2 as any);
console.log('---');
const res3 = mockRes();
await webhook({ method: 'POST', headers: {} } as any, res3 as any);
console.log('---done');
