import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

/**
 * The entire infrastructure graph. Edit here, nowhere else: no wrangler.toml.
 * `bun alchemy deploy --stage prod` provisions exactly what this program says.
 */
export default Alchemy.Stack(
  "OmniBrain",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const authSecret = process.env.AUTH_SECRET;
    if (!authSecret) {
      throw new Error("AUTH_SECRET is required to deploy (32+ random characters)");
    }
    const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:5173";

    const db = yield* Cloudflare.D1.Database("Db", {
      migrations: "./packages/db/migrations",
    });
    const blobs = yield* Cloudflare.R2.Bucket("Blobs");
    const vectors = yield* Cloudflare.Vectorize.Index("Vectors", {
      dimensions: 1024,
      metric: "cosine",
    });

    const api = yield* Cloudflare.Worker("Api", {
      main: "./apps/api/src/worker.ts",
      env: {
        DB: db,
        BLOBS: blobs,
        VECTORS: vectors,
        AUTH_SECRET: authSecret,
        TOKEN_KEY: process.env.TOKEN_KEY ?? authSecret,
        APP_ORIGIN: appOrigin,
        NOTION_CLIENT_ID: process.env.NOTION_CLIENT_ID ?? "",
        NOTION_CLIENT_SECRET: process.env.NOTION_CLIENT_SECRET ?? "",
        X_CLIENT_ID: process.env.X_CLIENT_ID ?? "",
        X_CLIENT_SECRET: process.env.X_CLIENT_SECRET ?? "",
        RAINDROP_CLIENT_ID: process.env.RAINDROP_CLIENT_ID ?? "",
        RAINDROP_CLIENT_SECRET: process.env.RAINDROP_CLIENT_SECRET ?? "",
        RESEND_KEY: process.env.RESEND_KEY ?? "",
        RESEND_FROM: process.env.RESEND_FROM ?? "OmniBrain <onboarding@resend.dev>",
      },
    });

    const web = yield* Cloudflare.Website.Vite("Web", {
      rootDir: "./apps/web",
      env: {
        VITE_API_URL: api.url.as<string>(),
      },
    });

    return {
      apiUrl: api.url,
      webUrl: web.url,
      database: db.databaseName,
      index: vectors.indexName,
    };
  }),
);
