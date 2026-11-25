export type WorkdayRegion = "KSA" | "UAE" | "UK" | "US" | "OTHER";

interface RegionTimezoneConfig {
  timezone: string;
  // Day of week: 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  validDays: number[];
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

const REGION_CONFIGS: Record<WorkdayRegion, RegionTimezoneConfig> = {
  KSA: {
    timezone: "Asia/Riyadh",
    validDays: [0, 1, 2, 3, 4], // Sun - Thu
    startHour: 9,
    startMinute: 0,
    endHour: 11,
    endMinute: 30,
  },
  UAE: {
    timezone: "Asia/Dubai",
    validDays: [1, 2, 3, 4], // Mon - Thu
    startHour: 9,
    startMinute: 0,
    endHour: 11,
    endMinute: 30,
  },
  UK: {
    timezone: "Europe/London",
    validDays: [1, 2, 3, 4, 5], // Mon - Fri
    startHour: 9,
    startMinute: 0,
    endHour: 11,
    endMinute: 30,
  },
  US: {
    timezone: "America/New_York",
    validDays: [1, 2, 3, 4, 5], // Mon - Fri
    startHour: 9,
    startMinute: 0,
    endHour: 11,
    endMinute: 30,
  },
  OTHER: {
    timezone: "UTC",
    validDays: [1, 2, 3, 4, 5], // Mon - Fri
    startHour: 9,
    startMinute: 0,
    endHour: 11,
    endMinute: 30,
  },
};

/**
 * Computes the exact next valid morning outreach window (9:00 - 11:30 AM local)
 * for the prospect's regional business calendar.
 *
 * @param region - KSA | UAE | UK | US | OTHER
 * @param addDays - Days to add for follow-up pacing (e.g. 0 for immediate next window, 3 for Step 2, 7 for Step 3)
 * @returns ISO string in UTC
 */
export function getNextValidWorkdayWindow(
  region: WorkdayRegion = "OTHER",
  addDays: number = 0
): string {
  const cfg = REGION_CONFIGS[region] || REGION_CONFIGS.OTHER;
  const now = new Date();

  // Start with target calendar day
  let target = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000);

  // Helper to get local day-of-week and local time parts in the target timezone
  const getLocalParts = (d: Date) => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: cfg.timezone,
      weekday: "narrow",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });

    const parts = formatter.formatToParts(d);
    const getVal = (type: string) => parts.find((p) => p.type === type)?.value;

    const year = parseInt(getVal("year") || "2026", 10);
    const month = parseInt(getVal("month") || "1", 10) - 1;
    const day = parseInt(getVal("day") || "1", 10);
    const hour = parseInt(getVal("hour") || "0", 10);
    const minute = parseInt(getVal("minute") || "0", 10);

    // Get day of week (0 = Sun, 6 = Sat)
    const localDate = new Date(Date.UTC(year, month, day, hour, minute));
    const dayOfWeek = localDate.getUTCDay();

    return { year, month, day, hour, minute, dayOfWeek };
  };

  // Find the next day that is a valid workday in that region
  for (let i = 0; i < 14; i++) {
    const local = getLocalParts(target);
    const isValidDay = cfg.validDays.includes(local.dayOfWeek);

    if (isValidDay) {
      // If addDays === 0 and today's window is already in the past, move to next day
      const isToday = i === 0 && addDays === 0;
      const windowPassed = local.hour > cfg.endHour || (local.hour === cfg.endHour && local.minute >= cfg.endMinute);

      if (!isToday || !windowPassed) {
        // Pick a staggered minute between 9:00 AM and 11:30 AM (150 minutes window)
        // Stagger to look completely human-sent (e.g. 9:14, 10:22, 11:08)
        const randomMinuteOffset = Math.floor(Math.random() * 150); // 0 to 150 min
        const localHour = 9 + Math.floor(randomMinuteOffset / 60);
        const localMinute = randomMinuteOffset % 60;

        // Construct UTC time matching this target local time
        // Using Date.UTC and subtracting the timezone offset
        const approximateUtc = new Date(Date.UTC(local.year, local.month, local.day, localHour, localMinute));

        // Refine with exact timezone offset
        const checkParts = getLocalParts(approximateUtc);
        const diffMinutes = (checkParts.hour - localHour) * 60 + (checkParts.minute - localMinute);
        approximateUtc.setUTCMinutes(approximateUtc.getUTCMinutes() - diffMinutes);

        return approximateUtc.toISOString();
      }
    }

    // Advance 1 day
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }

  // Fallback 24h ahead
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}
