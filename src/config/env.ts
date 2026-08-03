/**
 * Validation des variables d'environnement (Zod).
 *
 * Deux périmètres strictement séparés :
 *  - `getClientEnv()` : variables `NEXT_PUBLIC_*`, inlinées dans le bundle, publiques.
 *  - `getServerEnv()` : secrets serveur. Un accès depuis le navigateur lève.
 *
 * La validation est paresseuse et mise en cache : le premier accès échoue bruyamment
 * si une variable manque, sans faire exploser un build ou un test qui n'en a pas besoin.
 */

import { z } from "zod";

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url(),
});

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DB_URL: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Références statiques obligatoires : Next.js remplace `process.env.NEXT_PUBLIC_*`
 * à la compilation et ne peut pas le faire sur un accès dynamique.
 */
const clientRuntime = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
};

function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  source: unknown,
  scope: string,
): z.infer<TSchema> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(racine)"} : ${issue.message}`)
      .join("\n");
    throw new Error(`Variables d'environnement ${scope} invalides :\n${issues}`);
  }
  return parsed.data;
}

let cachedClientEnv: ClientEnv | undefined;
let cachedServerEnv: ServerEnv | undefined;

export function getClientEnv(): ClientEnv {
  cachedClientEnv ??= parseOrThrow(clientSchema, clientRuntime, "client");
  return cachedClientEnv;
}

export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServerEnv() est interdit côté navigateur : ces variables sont des secrets.",
    );
  }
  cachedServerEnv ??= parseOrThrow(serverSchema, process.env, "serveur");
  return cachedServerEnv;
}
