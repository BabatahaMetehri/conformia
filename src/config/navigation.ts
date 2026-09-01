/**
 * Arborescence de navigation.
 *
 * DONNÉE, pas balisage. Le sommaire de l'application vit ici sous forme d'un
 * arbre sérialisable : ni JSX, ni composant, ni import React. Trois raisons —
 * il est filtré côté serveur avant d'atteindre le navigateur, il traverse la
 * frontière RSC tel quel, et il se teste sans monter le moindre composant.
 *
 * ⚠️ Le filtrage par permission n'est PAS un contrôle d'accès. Il décide de ce
 * qui s'affiche ; l'autorité reste la RLS Postgres, doublée d'une garde de route
 * (cf. `src/services/navigation/index.ts`). Masquer un lien n'a jamais protégé
 * une donnée : quelqu'un qui tape l'URL doit buter sur la même porte fermée.
 */

import type { Permission } from "@/config/permissions";

// ─── Icônes ──────────────────────────────────────────────────────────────────

/**
 * Noms d'icônes, et non composants : une fonction ne franchit pas la frontière
 * entre Server Component et Client Component. Le nom, lui, est une chaîne — la
 * correspondance nom → composant se fait côté client (`nav-icon.tsx`).
 */
export const NAV_ICON_NAMES = [
  "dashboard",
  "tasks",
  "calendar",
  "validation",
  "obligations",
  "documents",
  "reports",
  "admin",
  "users",
  "delegations",
  "referentials",
  "notifications",
  "settings",
  "purge",
  "audit",
] as const;

export type NavIconName = (typeof NAV_ICON_NAMES)[number];

// ─── Compteurs ───────────────────────────────────────────────────────────────

/** Les trois seuls compteurs affichés dans la navigation. */
export const NAV_COUNTER_KEYS = ["overdue", "pendingValidation", "myTasks"] as const;

export type NavCounterKey = (typeof NAV_COUNTER_KEYS)[number];

export type NavCounters = Readonly<Record<NavCounterKey, number>>;

// ─── Conditions de visibilité ────────────────────────────────────────────────

export type NavRequirement =
  /** Visible pour toute session active. */
  | { readonly kind: "always" }
  /** Visible si l'utilisateur détient AU MOINS UNE des permissions listées. */
  | { readonly kind: "any"; readonly permissions: readonly Permission[] }
  /** Visible s'il les détient TOUTES. */
  | { readonly kind: "all"; readonly permissions: readonly Permission[] };

export interface NavItem {
  /** Stable, indépendant de l'URL : sert de clé de rendu et de clé de test. */
  readonly id: string;
  /** Chemin SANS préfixe de locale — il est ajouté au rendu du lien. */
  readonly href: string;
  readonly icon: NavIconName;
  /** Clé i18n sous `nav`. Aucun libellé rédigé dans ce fichier. */
  readonly labelKey: string;
  readonly requires: NavRequirement;
  readonly counter?: NavCounterKey;
  readonly children?: readonly NavItem[];
}

// ─── L'arbre ─────────────────────────────────────────────────────────────────

/**
 * ⚠️ Conséquence assumée de la matrice de rôles (cf. 0002_identity_rls.sql) :
 * ADMIN ne voit NI Échéancier, NI Documents, NI À valider, NI Tableau de bord.
 * Il ne détient ni `occurrence.read`, ni `document.read`, ni
 * `occurrence.validate`, ni `dashboard.view_all`. Ce n'est pas un oubli à
 * corriger : l'administration technique et le contenu métier sont séparés.
 */
export const NAVIGATION: readonly NavItem[] = [
  {
    id: "dashboard",
    href: "/dashboard",
    icon: "dashboard",
    labelKey: "dashboard",
    /*
     * `dashboard.view_all` ouvre la vue de TOUS les départements ; à défaut,
     * `occurrence.read` suffit pour une vue personnelle. ADMIN n'a ni l'une ni
     * l'autre — d'où son absence du tableau de bord, conformément à la matrice.
     */
    requires: { kind: "any", permissions: ["dashboard.view_all", "occurrence.read"] },
  },
  {
    id: "my-tasks",
    href: "/mes-taches",
    icon: "tasks",
    labelKey: "myTasks",
    // Toujours visible : chacun a le droit de constater qu'on ne lui a rien
    // confié. La RLS borne le contenu à ses propres dossiers.
    requires: { kind: "always" },
    counter: "myTasks",
  },
  {
    id: "occurrences",
    href: "/echeancier",
    icon: "calendar",
    labelKey: "occurrences",
    requires: { kind: "all", permissions: ["occurrence.read"] },
    counter: "overdue",
  },
  {
    id: "validation",
    href: "/validation",
    icon: "validation",
    labelKey: "validation",
    requires: { kind: "all", permissions: ["occurrence.validate"] },
    counter: "pendingValidation",
  },
  {
    id: "obligations",
    /*
     * ⚠️ L'URL est `/referentiel`, alors que CLAUDE.md §4 nomme le dossier
     * `obligations/`. Le prompt de ce module fixe explicitement l'adresse de la
     * liste et de la fiche ; on suit l'instruction la plus précise. L'identifiant
     * d'entrée reste `obligations` — c'est la feature qui porte ce nom, et les
     * tests s'y accrochent.
     *
     * Les sections métier suivent désormais la même convention française
     * (`/echeancier`, `/mes-taches`, `/referentiel`), les sections techniques
     * restant en anglais (`/dashboard`, `/admin`, `/audit`). La coupure n'est
     * pas idéale ; elle est au moins régulière.
     */
    href: "/referentiel",
    icon: "obligations",
    labelKey: "obligations",
    requires: { kind: "all", permissions: ["obligation.read"] },
  },
  {
    id: "documents",
    href: "/documents",
    icon: "documents",
    labelKey: "documents",
    requires: { kind: "all", permissions: ["document.read"] },
  },
  {
    id: "reports",
    href: "/reports",
    icon: "reports",
    labelKey: "reports",
    requires: { kind: "all", permissions: ["export.generate"] },
  },
  {
    id: "admin",
    href: "/admin",
    icon: "admin",
    labelKey: "admin",
    requires: {
      kind: "any",
      permissions: ["user.manage", "role.manage", "settings.manage"],
    },
    children: [
      {
        id: "admin-users",
        href: "/admin/users",
        icon: "users",
        labelKey: "adminUsers",
        requires: { kind: "all", permissions: ["user.manage"] },
      },
      {
        id: "admin-delegations",
        href: "/admin/delegations",
        icon: "delegations",
        labelKey: "adminDelegations",
        requires: { kind: "all", permissions: ["role.manage"] },
      },
      {
        id: "admin-referentials",
        href: "/admin/referentials",
        icon: "referentials",
        labelKey: "adminReferentials",
        requires: { kind: "all", permissions: ["referential.manage"] },
      },
      {
        id: "admin-notifications",
        href: "/admin/notifications",
        icon: "notifications",
        labelKey: "adminNotifications",
        requires: { kind: "all", permissions: ["settings.manage"] },
      },
      {
        id: "admin-settings",
        href: "/admin/settings",
        icon: "settings",
        labelKey: "adminSettings",
        requires: { kind: "all", permissions: ["settings.manage"] },
      },
      {
        id: "admin-purge",
        href: "/admin/purge",
        icon: "purge",
        labelKey: "adminPurge",
        requires: { kind: "all", permissions: ["settings.manage"] },
      },
      {
        /*
         * Rattaché à Administration dans le sommaire, mais servi à la racine :
         * CLAUDE.md §4 place `audit/` au premier niveau de la zone authentifiée.
         * Le journal n'est pas un écran d'administration, c'est une consultation
         * — la DIRECTION et l'AUDITEUR y accèdent sans être administrateurs.
         */
        id: "audit",
        href: "/audit",
        icon: "audit",
        labelKey: "audit",
        requires: { kind: "all", permissions: ["audit.read"] },
      },
    ],
  },
];

// ─── Filtrage ────────────────────────────────────────────────────────────────

function satisfies(requirement: NavRequirement, granted: ReadonlySet<Permission>): boolean {
  switch (requirement.kind) {
    case "always":
      return true;
    case "any":
      return requirement.permissions.some((permission) => granted.has(permission));
    case "all":
      return requirement.permissions.every((permission) => granted.has(permission));
  }
}

/**
 * Réduit l'arbre aux seules entrées autorisées. Une entrée non autorisée est
 * ABSENTE du résultat — elle n'est ni désactivée, ni grisée, ni rendue puis
 * masquée en CSS : la charge envoyée au navigateur ne la mentionne pas.
 *
 * Un groupe reste visible s'il satisfait sa propre condition OU s'il conserve au
 * moins un enfant. Le « ou » est délibéré : la condition d'Administration
 * (`user.manage`, `role.manage`, `settings.manage`) résume ses enfants les plus
 * courants, elle ne s'y superpose pas. Sans lui, la DIRECTION et l'AUDITEUR
 * détiendraient `audit.read` sans qu'aucun lien ne mène au journal.
 */
export function filterNavigation(
  items: readonly NavItem[],
  granted: ReadonlySet<Permission>,
): NavItem[] {
  const visible: NavItem[] = [];

  for (const item of items) {
    const children = item.children === undefined ? [] : filterNavigation(item.children, granted);
    const allowed = satisfies(item.requires, granted);

    if (item.children === undefined) {
      if (allowed) visible.push(item);
      continue;
    }

    if (allowed || children.length > 0) {
      visible.push({ ...item, children });
    }
  }

  return visible;
}

/** Aplatit l'arbre filtré — utile pour trouver la première destination ouverte. */
export function flattenNavigation(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.children === undefined ? [] : flattenNavigation(item.children)),
  ]);
}

/**
 * Première destination réellement ouverte, une fois l'arbre filtré.
 *
 * Sert d'atterrissage de repli : ADMIN ne voit pas le tableau de bord, l'y
 * déposer après connexion lui présenterait un écran vide. On ignore les groupes
 * — « Administration » n'est pas une page, c'est un dossier.
 *
 * `/mes-taches` en dernier recours : l'entrée est déclarée toujours visible, la
 * valeur de repli ne peut donc pas être un cul-de-sac.
 */
export function firstLeafPath(items: readonly NavItem[]): string {
  const leaf = flattenNavigation(items).find((item) => item.children === undefined);
  return leaf?.href ?? "/mes-taches";
}

/**
 * Condition d'accès d'une route, retrouvée par son chemin. Sert à la garde de
 * route : l'écran vérifie la MÊME condition que celle qui a masqué le lien, sans
 * la réécrire — deux formulations divergeraient au premier ajout de permission.
 */
export function requirementForPath(path: string): NavRequirement | null {
  for (const item of flattenNavigation(NAVIGATION)) {
    if (item.href === path) return item.requires;
  }
  return null;
}
