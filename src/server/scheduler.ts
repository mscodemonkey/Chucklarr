import { getSettings, listComedians, updateSettings } from './db';
import { scanComedian } from './scanner';

const dailyScanStartHour = 2;
const dailyScanWindowMinutes = 3 * 60;
const comedianDelayMinimumMs = 10_000;
const comedianDelayJitterMs = 20_000;

let dailyScanTimer: NodeJS.Timeout | null = null;
let dailyScanRunning = false;

/**
 * Starts the once-a-day scan loop.
 *
 * Each installation gets one saved local time between 02:00 and 04:59. Keeping
 * the time stable avoids surprising users; randomising the first assignment
 * avoids many public installs hitting TMDB or the metadata proxy at once.
 */
export function startDailyScanScheduler() {
  const time = ensureDailyScanTime();
  scheduleNextDailyScan(time);
}

function ensureDailyScanTime() {
  const settings = getSettings();
  if (isValidDailyScanTime(settings.automaticDailyScanTime)) {
    return settings.automaticDailyScanTime;
  }

  const time = randomDailyScanTime();
  updateSettings({ automaticDailyScanTime: time });
  console.log(`Daily comedian scan time set to ${time}.`);
  return time;
}

function scheduleNextDailyScan(time: string) {
  if (dailyScanTimer) {
    clearTimeout(dailyScanTimer);
  }

  const nextRun = nextRunDate(time);
  const delay = Math.max(1_000, nextRun.getTime() - Date.now());
  dailyScanTimer = setTimeout(() => {
    void runDailyScan();
  }, delay);
  console.log(`Next daily comedian scan scheduled for ${nextRun.toString()}.`);
}

async function runDailyScan() {
  const settings = getSettings();
  const time = isValidDailyScanTime(settings.automaticDailyScanTime)
    ? settings.automaticDailyScanTime
    : ensureDailyScanTime();
  const today = localDateStamp(new Date());

  if (dailyScanRunning || settings.automaticDailyScanLastRunDate === today) {
    scheduleNextDailyScan(time);
    return;
  }

  dailyScanRunning = true;
  try {
    const comedians = listComedians().filter((comedian) => comedian.tmdbPersonId);
    console.log(`Daily comedian scan starting for ${comedians.length} comedians.`);

    // Scan sequentially with jitter rather than firing one large burst. That is
    // kinder to the configured metadata source and makes failures easier to
    // attribute in the logs.
    for (const [index, comedian] of comedians.entries()) {
      try {
        await scanComedian(comedian.id);
      } catch (caught) {
        console.warn(
          caught instanceof Error
            ? `Daily scan failed for ${comedian.name}: ${caught.message}`
            : `Daily scan failed for ${comedian.name}.`
        );
      }

      if (index < comedians.length - 1) {
        await delay(comedianDelayMinimumMs + Math.floor(Math.random() * comedianDelayJitterMs));
      }
    }

    updateSettings({ automaticDailyScanLastRunDate: today });
    console.log('Daily comedian scan complete.');
  } finally {
    dailyScanRunning = false;
    scheduleNextDailyScan(time);
  }
}

function randomDailyScanTime() {
  const offsetMinutes = Math.floor(Math.random() * dailyScanWindowMinutes);
  const hour = dailyScanStartHour + Math.floor(offsetMinutes / 60);
  const minute = offsetMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function isValidDailyScanTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return hour >= 2 && hour < 5 && minute >= 0 && minute <= 59;
}

function nextRunDate(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function localDateStamp(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
