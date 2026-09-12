const WEEKDAY = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };

/** Calculates the next wall-clock run. Until a company timezone is persisted,
 * UTC is the explicit and consistent policy used by the scheduler. */
export function calculateNextRunAt({ frequency = 'manual', weekday = null, time = '08:00', timezone = 'UTC', from = new Date() } = {}) {
  if (frequency === 'manual') return null;
  void timezone;
  const anchor = new Date(from);
  if (Number.isNaN(anchor.getTime())) return null;
  const [hours, minutes] = String(time || '08:00').split(':').map(Number);
  const candidate = new Date(anchor); candidate.setUTCHours(Number.isFinite(hours) ? hours : 8, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  if (frequency === 'weekly') {
    const target = Number(weekday); if (!Number.isInteger(target) || target < 0 || target > 6) return null;
    candidate.setUTCDate(candidate.getUTCDate() + ((target - candidate.getUTCDay() + 7) % 7));
  }
  if (candidate <= anchor) candidate.setUTCDate(candidate.getUTCDate() + (frequency === 'weekly' ? 7 : 1));
  return candidate.toISOString();
}

export const AUTOMATION_WEEKDAYS = WEEKDAY;
export const AUTOMATION_FREQUENCIES = Object.freeze({ MANUAL: 'manual', DAILY: 'daily', WEEKLY: 'weekly' });
