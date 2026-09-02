/**
 * Variables d'environnement, validées **au chargement du module**.
 *
 * Le parsing est délibérément eager : une variable manquante doit faire échouer
 * le démarrage et le build, bruyamment, en nommant la variable — pas produire un
 * `undefined` qui se propage jusqu'à une requête en production.
 *
 * Deux périmètres strictement séparés :
 *  • variables `NEXT_PUBLIC_*` — inlinées dans le bundle navigateur, publiques ;
 *  • variables serveur — secrets. Toute lecture depuis un bundle client lève.
 *
 * Ce module ne dépend de rien d'autre que Zod : il doit pouvoir être chargé par
 * un script isolé, avant le reste de l'application.
 */

import { z } from "zod";

// ─── Schémas ─────────────────────────────────────────────────────────────────

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url(),
});

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Contourne la RLS. Usage réservé à `src/server/jobs/` (cf. CLAUDE.md §6). */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1).startsWith("postgres"),

  /*
   * ⚠️ OPTIONNELLE, contrairement à toutes les autres.
   *
   * Le fournisseur d'envoi est un réglage EN BASE (`app_settings.email_provider`) :
   * une installation qui a basculé sur le serveur SMTP d'entreprise n'a aucune
   * raison de détenir une clé Resend, et l'exiger ferait échouer son démarrage
   * pour un service qu'elle n'utilise pas. L'absence est donc rattrapée à la
   * construction du fournisseur, qui rend une erreur nommant cette variable —
   * pas au chargement du module.
   */
  RESEND_API_KEY: z.string().min(1).optional(),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  SMTP_FROM: z.email(),

  /** Authentifie les appels du planificateur vers les Route Handlers de cron. */
  CRON_SECRET: z.string().min(32),
  /** Chiffre les sauvegardes de documents. Sa perte rend les archives illisibles. */
  BACKUP_ENCRYPTION_KEY: z.string().min(32),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;
export type Env = Readonly<ClientEnv & ServerEnv>;

const SERVER_KEYS: ReadonlySet<string> = new Set(Object.keys(serverSchema.shape));

/**
 * Références statiques obligatoires : Next.js substitue `process.env.NEXT_PUBLIC_*`
 * à la compilation par analyse textuelle et ne peut pas le faire sur un accès calculé.
 */
const clientRuntime = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

// ─── Validation ──────────────────────────────────────────────────────────────

function describeIssue(issue: z.core.$ZodIssue, source: Record<string, unknown>): string {
  const name = issue.path.map((segment) => String(segment)).join(".");
  const isMissing = source[name] === undefined || source[name] === "";
  const reason = isMissing ? "manquante ou vide" : issue.message;
  return `  • ${name} : ${reason}`;
}

function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, unknown>,
  scope: string,
): z.infer<TSchema> {
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;

  const lines = parsed.error.issues.map((issue) => describeIssue(issue, source));
  throw new Error(
    [
      `Configuration invalide — variables d'environnement ${scope} :`,
      ...lines,
      "",
      "Renseignez-les dans .env.local (voir .env.example).",
    ].join("\n"),
  );
}

// ─── Construction ────────────────────────────────────────────────────────────

const SERVER_ACCESS_FROM_CLIENT =
  "Variable d'environnement serveur lue depuis un bundle client. " +
  "Ces valeurs sont des secrets et ne sont jamais envoyées au navigateur. " +
  "Déplacez cet accès dans un Server Component, une Server Action, un Route Handler " +
  "ou un script de src/server/jobs/.";

function buildEnv(): Env {
  const client = parseOrThrow(clientSchema, clientRuntime, "client");

  if (typeof window === "undefined") {
    const server = parseOrThrow(serverSchema, process.env, "serveur");
    return Object.freeze({ ...client, ...server });
  }

  // Côté navigateur, seules les variables publiques existent. Le Proxy conserve
  // le type complet tout en transformant l'accès à une variable serveur en erreur
  // immédiate et explicite, au lieu d'un `undefined` silencieux.
  const publicOnly = Object.freeze({ ...client });
  return new Proxy(publicOnly, {
    get(target, property, receiver): unknown {
      if (typeof property === "string" && SERVER_KEYS.has(property)) {
        throw new Error(`${SERVER_ACCESS_FROM_CLIENT}\nVariable lue : ${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
    // Le cast est le seul moyen d'exprimer « ces clés existent au type mais lèvent
    // à l'exécution » ; le trap ci-dessus est ce qui rend la promesse vraie.
  }) as Env;
}

export const env: Env = buildEnv();

/** Vrai lorsque le code s'exécute côté serveur (Node), faux dans le navigateur. */
export const isServer = typeof window === "undefined";
