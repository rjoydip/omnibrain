// Root-level watch entry so Bun watches workspace imports (packages/*), not just apps/api.
// `bun --watch scripts/dev-api.ts` from the repo root avoids "not in the project directory" warnings.
import "../apps/api/src/dev";
