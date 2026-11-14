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
    // Empty string is what an unset GitHub Actions variable produces; treat it as unset.
    const appOrigin = process.env.APP_ORIGIN || "http://localhost:5173";

    const db = yield* Cloudflare.D1.Database("Db", {
      migrations: "./packages/db/migrations",
    });
    const blobs = yield* Cloudflare.R2.Bucket("Blobs");
    const vectors = yield* Cloudflare.Vectorize.Index("Vectors", {
      dimensions: 1024,
      metric: "cosine",
    });
    const email = yield* Cloudflare.Email.SendEmail("Email");

    const api = yield* Cloudflare.Worker("Api", {
      name: "omnibrain-api",
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
        GH_CLIENT_ID: process.env.GH_CLIENT_ID ?? "",
        GH_CLIENT_SECRET: process.env.GH_CLIENT_SECRET ?? "",
        EMAIL: email,
        EMAIL_FROM: process.env.EMAIL_FROM ?? "OmniBrain <no-reply@omnibrain.ai>",
      },
    });

    const web = yield* Cloudflare.Website.Vite("Web", {
      name: "omnibrain",
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
