export const PLANS = {
  free: {
    name: "Free",
    items: 500,
    enrichmentsMonth: 200,
    mcpCallsDay: 100,
    connections: 1,
    seats: 1,
    apiKeys: 10,
    priceMonthly: 0,
  },
  pro: {
    name: "Pro",
    items: 25_000,
    enrichmentsMonth: 5_000,
    mcpCallsDay: 5_000,
    connections: 5,
    seats: 1,
    apiKeys: 50,
    priceMonthly: 9,
  },
  team: {
    name: "Team",
    items: 100_000,
    enrichmentsMonth: 20_000,
    mcpCallsDay: 20_000,
    connections: Number.POSITIVE_INFINITY,
    seats: Number.POSITIVE_INFINITY,
    apiKeys: Number.POSITIVE_INFINITY,
    priceMonthly: 19,
  },
} as const;

export type PlanId = keyof typeof PLANS;
export type QuotaAction = "item" | "enrichment" | "mcp" | "connection" | "seat" | "apiKey";

export interface Usage {
  items: number;
  enrichmentsMonth: number;
  mcpCallsDay: number;
  connections: number;
  seats: number;
  apiKeys: number;
}

export const EMPTY_USAGE: Usage = {
  items: 0,
  enrichmentsMonth: 0,
  mcpCallsDay: 0,
  connections: 0,
  seats: 1,
  apiKeys: 0,
};

const ACTION_KEY: Record<QuotaAction, keyof (typeof PLANS)["free"]> = {
  item: "items",
  enrichment: "enrichmentsMonth",
  mcp: "mcpCallsDay",
  connection: "connections",
  seat: "seats",
  apiKey: "apiKeys",
};

const USAGE_KEY: Record<QuotaAction, keyof Usage> = {
  item: "items",
  enrichment: "enrichmentsMonth",
  mcp: "mcpCallsDay",
  connection: "connections",
  seat: "seats",
  apiKey: "apiKeys",
};

export interface Entitlement {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  reason?: string;
}

export function checkEntitlement(
  plan: PlanId,
  usage: Usage,
  action: QuotaAction,
  amount = 1,
): Entitlement {
  const limit = PLANS[plan][ACTION_KEY[action]] as number;
  const used = usage[USAGE_KEY[action]];
  const remaining = Math.max(0, limit - used);
  // amount = 0 is a read-only probe (dashboard/summary), never a blocked action.
  const allowed = amount === 0 ? true : used + amount <= limit;
  return {
    allowed,
    used,
    limit,
    remaining,
    ...(allowed ? {} : { reason: `${PLANS[plan].name} plan limit reached (${limit})` }),
  };
}

/** Read-only actions are always allowed, even over quota. */
export function entitlementSummary(plan: PlanId, usage: Usage) {
  return {
    plan,
    items: checkEntitlement(plan, usage, "item", 0),
    enrichments: checkEntitlement(plan, usage, "enrichment", 0),
    mcp: checkEntitlement(plan, usage, "mcp", 0),
    connections: checkEntitlement(plan, usage, "connection", 0),
    apiKeys: checkEntitlement(plan, usage, "apiKey", 0),
  };
}
