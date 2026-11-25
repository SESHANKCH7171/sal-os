import { checkQuotaAvailable, QuotaProvider, DAILY_BUDGET_CAPS } from "@/lib/enrichment/quota-tracker";

export class BudgetCircuitBreakerError extends Error {
  constructor(public provider: QuotaProvider, public current: number, public cap: number) {
    super(`[BUDGET CIRCUIT BREAKER] Daily ceiling of ${cap} reached for provider '${provider}' (current: ${current}). Halting to prevent unexpected charges.`);
    this.name = "BudgetCircuitBreakerError";
  }
}

/**
 * Asserts that the specified provider is below its safety budget.
 * Throws BudgetCircuitBreakerError if daily ceiling is exceeded.
 */
export async function assertBudgetAvailable(provider: QuotaProvider): Promise<void> {
  const check = await checkQuotaAvailable(provider);
  if (!check.allowed) {
    throw new BudgetCircuitBreakerError(provider, check.currentCount, check.dailyCap);
  }
}

/**
 * Safe wrapper to execute an external API call with pre-check and automatic quota tracking.
 */
export async function withBudgetProtection<T>(
  provider: QuotaProvider,
  action: () => Promise<T>
): Promise<T> {
  await assertBudgetAvailable(provider);
  const result = await action();
  return result;
}
