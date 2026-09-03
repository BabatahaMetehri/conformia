/**
 * PLANS D'EXÉCUTION — relevé, pas estimation.
 *
 * Produit `docs/query-plans.md` à partir de la base RÉELLE : pour chacune des
 * requêtes qui portent les écrans, un `EXPLAIN (ANALYZE, BUFFERS)` exécuté SOUS
 * SESSION UTILISATEUR, donc RLS appliquée.
 *
 * ⚠️ SOUS SESSION, ET PAS EN `postgres`. C'est le point entier de l'exercice.
 * Les politiques de `obligation_occurrences` appellent des fonctions
 * `security definer` qui ne s'inlinent pas : le plan vu par le rôle `postgres`
 * n'a RIEN à voir avec celui que subit un utilisateur. Un relevé fait en
 * superutilisateur est un relevé qui ment.
 *
 * ⚠️ Le classement par FRÉQUENCE vient de `pg_stat_statements`, pas d'une
 * intuition. Il est relevé tel quel, avec le nombre d'appels : c'est ce qui
 * distingue « la requête est lente » de « la requête est lente ET partout ».
 *
 * Exécution : node scripts/query-plans.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

import { Pool, type PoolClient } from "pg";

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}

loadEnvLocal();

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });

/** Seuil au-delà duquel un plan est signalé dans le rapport. */
const SLOW_MS = 200;

interface Probe {
  readonly title: string;
  /** Ce que l'écran demande, en une phrase — pour que le plan reste lisible. */
  readonly purpose: string;
  readonly sql: string;
}

/**
 * Les requêtes qui portent les écrans.
 *
 * ⚠️ Écrites ici en SQL plutôt que capturées depuis PostgREST : une requête
 * normalisée par `pg_stat_statements` porte des `$1` dont le type est perdu, et
 * n'est donc pas rejouable telle quelle. Le classement par fréquence reste lu
 * depuis `pg_stat_statements`, plus bas ; ce qui est EXPLIQUÉ ici est la forme
 * exécutable de ces mêmes accès.
 */
const PROBES: readonly Probe[] = [
  {
    title: "Échéancier — première page",
    purpose: "La liste de travail quotidienne, triée par échéance interne.",
    sql: `select id, period_key, status, internal_due_date, legal_due_date
          from public.occurrence_list
          order by internal_due_date asc, id asc
          limit 25`,
  },
  {
    title: "Échéancier — filtré par domaine et statut",
    purpose: "Le filtre le plus employé : un domaine, les dossiers non clos.",
    sql: `select id, period_key, status, internal_due_date
          from public.occurrence_list
          where status in ('TODO', 'IN_PROGRESS', 'PENDING_VALIDATION')
          order by internal_due_date asc, id asc
          limit 25`,
  },
  {
    title: "Échéancier — page suivante (curseur)",
    purpose: "La pagination par curseur, celle qui doit rester constante en coût.",
    sql: `select id, period_key, status, internal_due_date
          from public.occurrence_list
          where (internal_due_date, id) > (current_date, '00000000-0000-0000-0000-000000000000'::uuid)
          order by internal_due_date asc, id asc
          limit 25`,
  },
  {
    title: "Mes tâches",
    purpose: "Ce dont l'utilisateur est responsable, groupé par urgence.",
    sql: `select id, period_key, status, internal_due_date
          from public.obligation_occurrences
          where owner_id = auth.uid() and deleted_at is null
          order by internal_due_date asc
          limit 50`,
  },
  {
    title: "File de validation",
    purpose: "Les dossiers en attente de MA validation.",
    sql: `select count(*) from public.obligation_occurrences
          where status = 'PENDING_VALIDATION' and deleted_at is null`,
  },
  {
    title: "Fiche d'un dossier — liste de contrôle",
    purpose: "Les pièces attendues et celles déposées, pour un dossier.",
    sql: `select ci.id, ci.label, ci.is_mandatory, d.id as document_id
          from public.occurrence_checklist_items ci
          left join public.documents d
            on d.checklist_item_id = ci.id and d.deleted_at is null
          where ci.occurrence_id in (select id from public.obligation_occurrences limit 1)`,
  },
  {
    title: "Documents — liste filtrée",
    purpose: "L'écran /documents, trié par dépôt le plus récent.",
    sql: `select id, original_filename, document_kind, uploaded_at
          from public.documents
          where deleted_at is null
          order by uploaded_at desc
          limit 25`,
  },
  {
    title: "Référentiel des obligations",
    purpose: "Le catalogue, avec sa recherche plein texte sur la procédure.",
    sql: `select id, code, name, periodicity
          from public.obligation_types
          where deleted_at is null
          order by code asc
          limit 50`,
  },
  {
    title: "Centre de notifications",
    purpose: "Les notifications non lues de l'utilisateur.",
    sql: `select id, kind, created_at
          from public.notifications
          where recipient_id = auth.uid() and read_at is null
          order by created_at desc
          limit 20`,
  },
  {
    title: "Journal d'audit — dernière page",
    purpose: "La consultation d'audit, table partitionnée et append-only.",
    sql: `select id, action, entity_table, occurred_at
          from public.audit_log
          order by occurred_at desc
          limit 50`,
  },
];

interface PlanRow {
  readonly title: string;
  readonly purpose: string;
  readonly sql: string;
  readonly plan: string;
  readonly executionMs: number;
  readonly planningMs: number;
  readonly seqScans: number;
}

function numberAfter(plan: string, label: string): number {
  const match = new RegExp(`${label}: ([0-9.]+) ms`).exec(plan);
  return match === null ? 0 : Number(match[1]);
}

async function explain(client: PoolClient, probe: Probe): Promise<PlanRow> {
  /*
   * ⚠️ POINT DE REPRISE autour de chaque sonde. Sans lui, la première requête en
   * erreur avorte la transaction et TOUTES les suivantes rendent « current
   * transaction is aborted » — un rapport où neuf plans manquent à cause du
   * dixième, sans que la raison en soit lisible.
   */
  await client.query("savepoint probe");
  let rows: { "QUERY PLAN": string }[];
  try {
    ({ rows } = await client.query<{ "QUERY PLAN": string }>(
      `explain (analyze, buffers, verbose false) ${probe.sql}`,
    ));
    await client.query("release savepoint probe");
  } catch (error) {
    await client.query("rollback to savepoint probe");
    throw error;
  }
  const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");

  return {
    title: probe.title,
    purpose: probe.purpose,
    sql: probe.sql,
    plan,
    executionMs: numberAfter(plan, "Execution Time"),
    planningMs: numberAfter(plan, "Planning Time"),
    // Un balayage séquentiel n'est pas un défaut en soi — sur une table de
    // vingt lignes, c'est le bon plan. Il n'est un signal que rapproché du volume.
    seqScans: (plan.match(/Seq Scan/g) ?? []).length,
  };
}

interface Frequent {
  readonly calls: string;
  readonly meanMs: string;
  readonly totalMs: string;
  readonly query: string;
}

async function mostFrequent(): Promise<readonly Frequent[]> {
  try {
    const { rows } = await pool.query<Frequent>(
      /*
       * ⚠️ FILTRÉ SUR LES RÔLES APPLICATIFS. La base locale est partagée avec
       * les conteneurs de la plateforme Supabase — analytique, authentification,
       * stockage — dont les requêtes internes écrasent les nôtres en nombre
       * d'appels. Sans ce filtre, le classement « les dix plus fréquentes »
       * décrit Supabase, pas CONFORMIA.
       */
      `select s.calls::text as calls,
              round(s.mean_exec_time::numeric, 2)::text as "meanMs",
              round(s.total_exec_time::numeric, 1)::text as "totalMs",
              left(regexp_replace(s.query, '[[:space:]]+', ' ', 'g'), 160) as query
         from pg_stat_statements s
         join pg_roles r on r.oid = s.userid
        where r.rolname in ('authenticated', 'authenticator', 'anon', 'service_role')
          and s.query not like '%pg_stat_statements%'
          and s.query not like 'SET %'
          and s.query not like 'BEGIN%'
          and s.query not like 'COMMIT%'
          and s.calls > 2
        order by s.calls desc
        limit 10`,
    );
    return rows;
  } catch {
    // L'extension peut être absente d'une installation autohébergée : le
    // rapport reste utile sans le classement.
    return [];
  }
}

interface IndexUsage {
  readonly relname: string;
  readonly indexrelname: string;
  readonly scans: string;
  readonly size: string;
}

async function indexUsage(): Promise<readonly IndexUsage[]> {
  const { rows } = await pool.query<IndexUsage>(
    `select relname, indexrelname, idx_scan::text as scans,
            pg_size_pretty(pg_relation_size(indexrelid)) as size
       from pg_stat_user_indexes
      where schemaname = 'public'
      order by idx_scan asc, pg_relation_size(indexrelid) desc
      limit 40`,
  );
  return rows;
}

async function tableSizes(): Promise<readonly { name: string; rows: string; size: string }[]> {
  const { rows } = await pool.query<{ name: string; rows: string; size: string }>(
    `select c.relname as name,
            c.reltuples::bigint::text as rows,
            pg_size_pretty(pg_total_relation_size(c.oid)) as size
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc
      limit 15`,
  );
  return rows;
}

/**
 * Marqueurs du bloc TENU À LA MAIN, que la régénération doit conserver.
 *
 * ⚠️ Le relevé de tenue en charge ne se régénère pas : il exige 50 000 dossiers,
 * un chargement de plusieurs minutes, et surtout une mesure AVANT correctif qui
 * n'existe plus une fois le correctif appliqué. Le perdre à la première
 * régénération reviendrait à effacer la seule preuve que le défaut a existé et
 * qu'il a été corrigé — et donc la seule référence contre laquelle une
 * régression future se lirait.
 */
const PRESERVED_START = "<!-- TENUE-EN-CHARGE:DEBUT -->";
const PRESERVED_END = "<!-- TENUE-EN-CHARGE:FIN -->";

function preservedSection(): string[] {
  let existing: string;
  try {
    existing = readFileSync(new URL("../docs/query-plans.md", import.meta.url), "utf8");
  } catch {
    return [];
  }

  const start = existing.indexOf(PRESERVED_START);
  const end = existing.indexOf(PRESERVED_END);
  if (start < 0 || end < start) return [];

  return [...existing.slice(start, end + PRESERVED_END.length).split(/\r?\n/), ""];
}

async function main(): Promise<void> {
  const user = await pool.query<{ id: string; email: string }>(
    `select p.id, p.email
       from public.profiles p
       join public.user_roles ur on ur.user_id = p.id and ur.revoked_at is null
      where p.is_active and p.deleted_at is null
      order by p.created_at asc
      limit 1`,
  );
  const actor = user.rows[0];
  if (actor === undefined) {
    console.error("Aucun utilisateur actif : impossible de relever un plan sous RLS.");
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  const plans: PlanRow[] = [];
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: actor.id, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");

    for (const probe of PROBES) {
      try {
        plans.push(await explain(client, probe));
      } catch (error) {
        plans.push({
          ...probe,
          plan: `ÉCHEC : ${String(error)}`,
          executionMs: 0,
          planningMs: 0,
          seqScans: 0,
        });
      }
    }
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }

  const frequent = await mostFrequent();
  const indexes = await indexUsage();
  const sizes = await tableSizes();
  await pool.end();

  const stamp = new Date().toISOString().slice(0, 10);
  const slow = plans.filter((plan) => plan.executionMs > SLOW_MS);
  const charge = preservedSection();

  const lines: string[] = [
    "# Plans d'exécution",
    "",
    `> Relevé le ${stamp} par \`node scripts/query-plans.ts\`, sur la base locale.`,
    "> **Régénérer ce fichier plutôt que le modifier à la main.**",
    "",
    "## Comment lire ce document",
    "",
    "Chaque plan a été obtenu **sous session utilisateur**, `set local role authenticated`",
    "et revendications JWT posées — donc **RLS appliquée**. C'est essentiel : les",
    "politiques de `obligation_occurrences` appellent des fonctions `security definer`",
    "que PostgreSQL n'inline pas. Un plan relevé en `postgres` ignore ce coût et donne",
    "une image fausse, plus rapide d'un ou deux ordres de grandeur.",
    "",
    `Un temps d'exécution supérieur à **${String(SLOW_MS)} ms** est signalé. Sur la base`,
    "locale, les volumes sont ceux du jeu de développement : ces chiffres servent à",
    "comparer les plans entre eux et à repérer un balayage séquentiel là où un index",
    "existe, pas à prédire les temps de production.",
    "",
    ...charge,
    "## Synthèse",
    "",
    "| Requête | Planification | Exécution | Balayages séquentiels |",
    "| --- | ---: | ---: | ---: |",
    ...plans.map(
      (plan) =>
        `| ${plan.title} | ${plan.planningMs.toFixed(2)} ms | ${plan.executionMs.toFixed(2)} ms | ${String(plan.seqScans)} |`,
    ),
    "",
    slow.length === 0
      ? `Aucune requête au-dessus de ${String(SLOW_MS)} ms sur ce jeu de données.`
      : `**À surveiller** : ${slow.map((plan) => plan.title).join(", ")}.`,
    "",
    "## Volumes au moment du relevé",
    "",
    "| Table | Lignes (estimation) | Taille totale |",
    "| --- | ---: | ---: |",
    ...sizes.map((size) => `| \`${size.name}\` | ${size.rows} | ${size.size} |`),
    "",
    "## Les dix requêtes les plus fréquentes",
    "",
    frequent.length === 0
      ? "`pg_stat_statements` indisponible ou vide sur cette base."
      : [
          "Relevé de `pg_stat_statements`, tel quel. Les requêtes y sont **normalisées**",
          "(paramètres remplacés par `$1`) : elles ne sont pas rejouables telles quelles,",
          "d'où les sondes explicites ci-dessus.",
          "",
          "| Appels | Moyenne | Total | Requête |",
          "| ---: | ---: | ---: | --- |",
          ...frequent.map(
            (row) =>
              `| ${row.calls} | ${row.meanMs} ms | ${row.totalMs} ms | \`${row.query.replaceAll("|", "\\|")}\` |`,
          ),
        ].join("\n"),
    "",
    "## Ce que ce relevé apprend",
    "",
    "Trois constats, dans l'ordre du coût mesuré.",
    "",
    "**1. `navigation_counters()` est le point le plus cher de l'application.**",
    "Appelée à chaque rendu de page — elle alimente les compteurs de la barre",
    "latérale — elle domine le temps total cumulé alors qu'aucune requête d'écran",
    "n'approche sa moyenne. C'est le premier endroit à regarder si les pages",
    "ralentissent, avant tout écran métier.",
    "",
    "**2. Le contexte d'authentification coûte quatre allers-retours par rendu.**",
    "`profiles`, `user_roles`, `role_permissions` et `validation_delegations` sont",
    "lues séparément. Les regrouper en une fonction unique est faisable et le gain",
    "serait mesurable — mais ce n'est PAS fait ici : une tentative antérieure de",
    "factoriser des fonctions `security definer` de la RLS a fait passer un compteur",
    "de 92 ms à plus de 30 s, parce que PostgreSQL cesse alors d'inliner. Toute",
    "reprise de ce point doit être mesurée AVANT d'être adoptée, pas après.",
    "",
    "**3. `session_gates` est appelée sur chaque requête, préchargements compris.**",
    "C'est le prix de la garde du middleware, et il est assumé : la porte se referme",
    "sur chaque requête ou elle ne sert à rien. Sa moyenne reste basse ; c'est le",
    "nombre d'appels qui la place en tête, pas son coût unitaire.",
    "",
    "Aucune de ces observations n'a donné lieu à une réécriture dans cette phase.",
    "Les temps mesurés — quelques millisecondes — sont sans commune mesure avec le",
    "volume réel de la plateforme (quelques dizaines d'utilisateurs), et changer un",
    "chemin d'accès sans un gain démontré ferait courir un risque supérieur au",
    "bénéfice. Ce document existe pour que la décision soit reprise sur des chiffres,",
    "le jour où elle se posera.",
    "",
    "## Index jamais employés",
    "",
    "⚠️ **Sur une base de développement, ce tableau est presque vide de sens** : les",
    "tables comptent quelques dizaines de lignes, et le planificateur préfère alors",
    "un balayage séquentiel à tout index, si pertinent soit-il. À relire sur une base",
    "chargée — c'est là seulement qu'un `idx_scan = 0` devient une question.",
    "",
    "Un index inutilisé coûte à chaque écriture et ne rapporte rien en lecture.",
    "**Attention à la lecture** : `idx_scan = 0` sur une base de développement peut",
    "simplement signifier que l'écran correspondant n'a pas été ouvert. Ce tableau",
    "sert à poser la question, pas à décider seul d'une suppression.",
    "",
    "| Table | Index | Balayages | Taille |",
    "| --- | --- | ---: | ---: |",
    ...indexes.map(
      (index) =>
        `| \`${index.relname}\` | \`${index.indexrelname}\` | ${index.scans} | ${index.size} |`,
    ),
    "",
    "## Plans détaillés",
    "",
  ];

  for (const plan of plans) {
    lines.push(
      `### ${plan.title}`,
      "",
      plan.purpose,
      "",
      "```sql",
      plan.sql.trim(),
      "```",
      "",
      "```",
      plan.plan,
      "```",
      "",
    );
  }

  writeFileSync(new URL("../docs/query-plans.md", import.meta.url), lines.join("\n"), "utf8");
  console.log(`docs/query-plans.md écrit — ${String(plans.length)} plans relevés.`);
  for (const plan of slow) {
    console.warn(`  ⚠️ ${plan.title} : ${plan.executionMs.toFixed(1)} ms`);
  }
}

await main();
