// List of banned AI corporate cliches and flattery openers
export const BANNED_AI_CLICHES = [
  /i hope this email finds you well/i,
  /i hope this message finds you well/i,
  /hope all is well/i,
  /hope you're having a great week/i,
  /\bdelve\b/i,
  /\btapestry\b/i,
  /\btestament\b/i,
  /\bgame changer\b/i,
  /\bsynergy\b/i,
  /\brevolutionary\b/i,
  /\bcutting-edge\b/i,
  /\bbespoke solutions\b/i,
  /\btransformative\b/i,
  /\bin today's fast-paced\b/i,
];

export interface TextValidationResult {
  cleanText: string;
  wordCount: number;
  isValid: boolean;
  issues: string[];
}

/**
 * Validates cold outreach text against strict Seshank AI Labs guardrails:
 * 1. Zero em dashes (—, –, --) -> automatically converted to comma or period.
 * 2. Word count limit (Step 1 cold emails strictly under 65 words).
 * 3. Zero banned corporate flattery openers or AI cliches.
 * 4. Zero premature links or pricing in Step 1.
 */
export function cleanAndValidateOutreachText(
  rawText: string,
  options: {
    maxWords?: number;
    forbidLinks?: boolean;
    forbidPricing?: boolean;
  } = {}
): TextValidationResult {
  const { maxWords = 65, forbidLinks = true, forbidPricing = true } = options;
  const issues: string[] = [];

  if (!rawText) {
    return { cleanText: "", wordCount: 0, isValid: false, issues: ["Text is empty"] };
  }

  // 1. Enforce Zero Em Dashes: replace em dashes or double hyphens with clean commas
  let cleanText = rawText
    .replace(/[\u2014\u2013]/g, ", ") // Unicode em/en dash
    .replace(/\s*--\s*/g, ", ")       // Double hyphens
    .replace(/\s*-\s{2,}/g, ", ");

  // 2. Strip banned flattery openers
  for (const regex of BANNED_AI_CLICHES) {
    if (regex.test(cleanText)) {
      issues.push(`Contains banned phrase or cliché: ${regex.source}`);
      cleanText = cleanText.replace(regex, "").trim();
    }
  }

  // Clean double spaces or double commas created by removals
  cleanText = cleanText
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  // 3. Word count check
  const words = cleanText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (maxWords && wordCount > maxWords) {
    issues.push(`Word count (${wordCount}) exceeds maximum allowed limit (${maxWords} words)`);
  }

  // 4. Forbid links check
  if (forbidLinks) {
    if (/https?:\/\/|www\.|\.com\/|\.io\/|\.co\//i.test(cleanText)) {
      issues.push("Prohibited link detected in Step 1 outreach (links cause spam triggers)");
    }
  }

  // 5. Forbid premature pricing check
  if (forbidPricing) {
    if (/\$\s*\d+|\b\d+\s*(usd|aed|sar|dollars|per month|\/mo)\b/i.test(cleanText)) {
      issues.push("Premature pricing detected in Step 1 (Step 1 must be permission-first value)");
    }
  }

  return {
    cleanText,
    wordCount,
    isValid: issues.length === 0,
    issues,
  };
}
