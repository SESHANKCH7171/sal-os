import Holidays from "date-holidays";
import { checkQuotaAvailable, incrementQuota } from "@/lib/enrichment/quota-tracker";

export type TargetRegion = "US" | "UK" | "UAE" | "KSA";

export interface RegionLocalCalendar {
  region: TargetRegion;
  countryCode: string;
  timezone: string;
  localDate: string; // YYYY-MM-DD
  dayOfWeek: number; // 0=Sun..6=Sat
  dayName: string;
  localTimeStr: string;
  holidaysToday: string[];
  nagerPublicHolidayToday: string | null;
  inLongWeekendBridge: boolean;
  longWeekendReason: string | null;
}

export interface LiveHolidayRadarSnapshot {
  generatedAt: string;
  istDate: string;
  istDayName: string;
  regions: Record<TargetRegion, RegionLocalCalendar>;
  tavilyHolidayAlert: string | null;
}

const REGION_META: Record<
  TargetRegion,
  { countryCode: string; timezone: string; supportsNager: boolean }
> = {
  US: { countryCode: "US", timezone: "America/New_York", supportsNager: true },
  UK: { countryCode: "GB", timezone: "Europe/London", supportsNager: true },
  UAE: { countryCode: "AE", timezone: "Asia/Dubai", supportsNager: false },
  KSA: { countryCode: "SA", timezone: "Asia/Riyadh", supportsNager: false },
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function getLocalCalendarParts(timezone: string, now: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const localDate = `${year}-${month}-${day}`;
  const weekdayStr = get("weekday");
  const dayOfWeek = Math.max(0, DAY_NAMES.indexOf(weekdayStr));
  const localTimeStr = `${get("hour")}:${get("minute")}`;

  return {
    year: parseInt(year, 10),
    localDate,
    dayOfWeek,
    dayName: weekdayStr || DAY_NAMES[dayOfWeek],
    localTimeStr,
  };
}

async function fetchNagerHolidays(
  year: number,
  countryCode: string,
  localDate: string
): Promise<{ publicHoliday: string | null; inLongWeekend: boolean; longWeekendReason: string | null }> {
  let publicHoliday: string | null = null;
  let inLongWeekend = false;
  let longWeekendReason: string | null = null;

  try {
    const res = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const list = (await res.json()) as Array<{ date: string; localName: string; name: string }>;
      const match = list.find((h) => h.date === localDate);
      if (match) {
        publicHoliday = match.name || match.localName;
      }
    }
  } catch (err) {
    console.warn(`Nager.Date PublicHolidays fallback for ${countryCode}:`, (err as Error).message);
  }

  try {
    const res = await fetch(
      `https://date.nager.at/api/v3/LongWeekend/${year}/${countryCode}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const weekends = (await res.json()) as Array<{
        startDate: string;
        endDate: string;
        dayCount: number;
        needBridgeDay: boolean;
      }>;
      const active = weekends.find(
        (w) => localDate >= w.startDate && localDate <= w.endDate && w.dayCount >= 3
      );
      if (active) {
        inLongWeekend = true;
        longWeekendReason = `Long weekend window (${active.startDate} to ${active.endDate}, ${active.dayCount} days)`;
      }
    }
  } catch (err) {
    console.warn(`Nager.Date LongWeekend fallback for ${countryCode}:`, (err as Error).message);
  }

  return { publicHoliday, inLongWeekend, longWeekendReason };
}

async function fetchDailyTavilyHolidayAlert(istDate: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  const quota = await checkQuotaAvailable("tavily");
  if (!quota.allowed) {
    console.warn("Tavily daily quota reached; skipping live holiday search.");
    return null;
  }

  await incrementQuota("tavily");

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: `public holiday OR bank holiday OR long weekend today ${istDate} in US UK UAE Saudi Arabia`,
        search_depth: "basic",
        max_results: 3,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`Tavily holiday search returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (data.answer && typeof data.answer === "string") {
      return data.answer.slice(0, 500);
    }

    const snippets = (data.results || [])
      .map((r: any) => `${r.title}: ${r.content}`)
      .join(" | ");
    return snippets ? snippets.slice(0, 500) : null;
  } catch (err) {
    console.warn("Tavily holiday search error:", (err as Error).message);
    return null;
  }
}

/**
 * Computes exact live regional dates, checks date-holidays + Nager.Date + 1 daily Tavily search.
 */
export async function getLiveHolidayRadar(now = new Date()): Promise<LiveHolidayRadarSnapshot> {
  const istParts = getLocalCalendarParts("Asia/Kolkata", now);
  const regions = {} as Record<TargetRegion, RegionLocalCalendar>;

  const regionKeys: TargetRegion[] = ["US", "UK", "UAE", "KSA"];

  await Promise.all(
    regionKeys.map(async (region) => {
      const meta = REGION_META[region];
      const parts = getLocalCalendarParts(meta.timezone, now);

      // 1. date-holidays check
      const hd = new Holidays(meta.countryCode);
      const localDateObj = new Date(`${parts.localDate}T12:00:00Z`);
      const hdResult = hd.isHoliday(localDateObj);
      const holidaysToday: string[] = [];
      if (Array.isArray(hdResult)) {
        for (const h of hdResult) {
          if (h.type === "public" || h.type === "bank") {
            holidaysToday.push(h.name);
          }
        }
      }

      // 2. Nager.Date check for US & GB
      let nagerPublicHolidayToday: string | null = null;
      let inLongWeekendBridge = false;
      let longWeekendReason: string | null = null;

      if (meta.supportsNager) {
        const nager = await fetchNagerHolidays(parts.year, meta.countryCode, parts.localDate);
        nagerPublicHolidayToday = nager.publicHoliday;
        inLongWeekendBridge = nager.inLongWeekend;
        longWeekendReason = nager.longWeekendReason;
      }

      // 3. Built-in critical holiday bridge guardrails (Thanksgiving Fri, UAE National Day Dec 2-3, Christmas/New Year)
      const mmdd = parts.localDate.slice(5);
      if (region === "UAE" && (mmdd === "12-02" || mmdd === "12-03")) {
        if (!holidaysToday.some((h) => h.toLowerCase().includes("national day"))) {
          holidaysToday.push("UAE National Day");
        }
      }
      if ((region === "US" || region === "UK") && mmdd >= "12-24" && mmdd <= "12-31") {
        inLongWeekendBridge = true;
        longWeekendReason = longWeekendReason || "Year-end Christmas/New Year holiday week";
      }
      if (mmdd === "01-01") {
        if (!holidaysToday.some((h) => h.toLowerCase().includes("new year"))) {
          holidaysToday.push("New Year's Day");
        }
      }

      regions[region] = {
        region,
        countryCode: meta.countryCode,
        timezone: meta.timezone,
        localDate: parts.localDate,
        dayOfWeek: parts.dayOfWeek,
        dayName: parts.dayName,
        localTimeStr: parts.localTimeStr,
        holidaysToday,
        nagerPublicHolidayToday,
        inLongWeekendBridge,
        longWeekendReason,
      };
    })
  );

  const tavilyHolidayAlert = await fetchDailyTavilyHolidayAlert(istParts.localDate);

  return {
    generatedAt: now.toISOString(),
    istDate: istParts.localDate,
    istDayName: istParts.dayName,
    regions,
    tavilyHolidayAlert,
  };
}
