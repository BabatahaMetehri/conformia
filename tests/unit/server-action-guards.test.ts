// @vitest-environment node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ⚠️ AUCUNE SERVER ACTION SANS GARDE.
 *
 * Une Server Action est un POINT D'ENTRÉE HTTP à part entière : elle est
 * appelable par n'importe qui, avec n'importe quoi, sans passer par l'écran qui
 * la déclenche. Masquer un bouton ne protège rien.
 *
 * ⚠️ CE TEST NE SE CONTENTE PAS DE REGARDER LE FICHIER D'ACTIONS. Trois formes
 * légitimes coexistent dans ce dépôt, et un contrôle purement syntaxique en
 * aurait déclaré deux fautives :
 *
 *   1. la garde est dans l'action elle-même ;
 *   2. la garde est dans une fonction d'aide du même fichier (`guard()`) ;
 *   3. l'action DÉLÈGUE à un service qui garde — la forme la plus courante ici,
 *      et la plus saine : la permission est vérifiée au plus près de l'écriture,
 *      donc elle tient aussi quand le service est appelé autrement.
 *
 * Le test suit donc la chaîne : action → aide locale → service appelé. Il
 * échoue si AUCUN maillon ne garde, et il échoue aussi si une exception déclarée
 * ci-dessous cesse d'être vraie.
 */

/** Saut de ligne nommé : une réécriture automatique du fichier l'a déjà cassé une fois. */
const NEWLINE = String.fromCharCode(10);

const GUARDS = [
  "requirePermission",
  "requireAuthContext",
  "requireSectionAccess",
  "requireRole",
] as const;

/**
 * Actions volontairement SANS garde de permission, avec leur raison.
 *
 * ⚠️ Chaque ligne est une décision, pas une dispense. Une action ajoutée ici
 * sans motif valable est une porte ouverte ; la liste est courte et doit le
 * rester.
 */
const DELIBERATELY_UNGUARDED: Readonly<Record<string, string>> = {
  // ── Authentification : il n'y a par définition pas encore de session.
  loginAction: "Point d'entrée de la connexion : aucune session n'existe encore.",
  logoutAction: "Fermer une session ne demande pas de permission.",
  forgotPasswordAction: "Accessible sans session, par construction.",
  setPasswordAction: "Consomme un jeton à usage unique, qui EST l'autorisation.",
  startMfaEnrollmentAction: "Enrôlement du second facteur, avant session complète.",
  completeMfaEnrollmentAction: "Enrôlement du second facteur, avant session complète.",
  verifyMfaAction: "Vérification du second facteur, avant session complète.",

  // ── Lectures bornées par la RLS, sur les données de l'appelant lui-même.
  loadPanelAction: "Courrier de l'appelant : la politique RLS ne montre que le sien.",
  loadPageAction: "Courrier de l'appelant : la politique RLS ne montre que le sien.",
  unreadCountAction: "Compteur du courrier de l'appelant, borné par la RLS.",
  markReadAction: "Marque SES propres messages ; la politique RLS refuse les autres.",
  markAllReadAction: "Marque SES propres messages ; la politique RLS refuse les autres.",
  dismissAction: "Masque SES propres messages ; la politique RLS refuse les autres.",
  loadPreferencesAction: "Préférences de l'appelant, bornées par la RLS.",
  calendarFeedAction: "Jeton de flux de l'appelant ; la fonction SQL impose son profil.",
  regenerateCalendarTokenAction: "Rotation de SON jeton ; la fonction SQL impose son profil.",
  loadHistoryAction:
    "Historique des exports : la politique RLS d'export_runs montre les siens, plus tout pour audit.read.",

  /*
   * ⚠️ Choisir SA langue d'affichage n'est pas un droit à accorder : l'action
   * pose un cookie sur le navigateur de l'appelant et ne touche à AUCUNE donnée.
   * Exiger une permission ici reviendrait à pouvoir priver quelqu'un de lire
   * l'application dans sa langue — une restriction sans objet légitime.
   *
   * Le seul risque réel serait une redirection ouverte, si le chemin reçu du
   * client était employé tel quel. Il est nettoyé dans l'action même : tout ce
   * qui n'est pas un chemin absolu d'un seul slash retombe sur l'accueil.
   */
  setLocaleAction: "Choix de langue : pose un cookie, ne touche aucune donnée.",
};

/**
 * Actions dont la garde vit dans une FONCTION SQL.
 *
 * ⚠️ Quatrième forme légitime, et la plus solide des quatre : la permission est
 * vérifiée par la base elle-même, donc elle tient quel que soit l'appelant —
 * action serveur, script, ou requête directe. Le premier jet de ce test les
 * avait déclarées « sans garde » parce qu'il ne cherchait que du TypeScript.
 *
 * Le test lit la migration et vérifie que la fonction nommée contrôle
 * RÉELLEMENT la permission : sans cela, cette liste serait une dispense.
 */
const GUARDED_BY_SQL: Readonly<Record<string, string>> = {
  exportTabularAction: "start_export_run",
  exportReportAction: "start_export_run",
  planPeriodExportAction: "start_export_run",
};

/**
 * Actions dont la garde vit dans le service appelé.
 *
 * ⚠️ Le service est NOMMÉ, et le test vérifie qu'il garde RÉELLEMENT. Sans cette
 * seconde vérification, la liste serait une simple dispense — exactement ce
 * qu'on veut éviter.
 */
const GUARDED_BY_SERVICE: Readonly<Record<string, string>> = {
  inviteUserAction: "inviteUser",
  cancelInvitationAction: "withdrawInvitation",
  grantRoleAction: "assignRole",
  revokeRoleAction: "withdrawRole",
  deactivateUserAction: "deactivateUser",
  resetMfaAction: "resetSecondFactor",
  toggleRolePermissionAction: "toggleRolePermission",
  saveHolidayAction: "saveHolidays",
  importHolidaysAction: "saveHolidays",
  deleteHolidayAction: "removeHoliday",
  // Les trois aperçus n'écrivent rien, mais ils LISENT le plan de charge des
  // occurrences et le chiffrent : c'est un renseignement, et il se garde comme
  // le geste qu'il annonce.
  previewHolidaySaveAction: "previewHolidayChange",
  previewHolidayImportAction: "previewHolidayChange",
  previewHolidayDeleteAction: "previewHolidayChange",
  saveSettingAction: "saveSetting",
  exportAuditAction: "exportAuditCsv",
  acknowledgeIntegrityAlertAction: "acknowledgeIntegrityAlert",
  rememberFiltersAction: "rememberFilters",
  searchAction: "searchGlobally",
  decideAction: "transitionOccurrence",
  bulkValidateAction: "getValidationQueue",
  createDelegationAction: "createDelegation",
  revokeDelegationAction: "revoke",
  loadReviewAction: "getOccurrenceDetail",
  /*
   * ⚠️ LES ABSENCES ONT UNE RÈGLE DOUBLE, et c'est pourquoi la garde vit dans le
   * service : `absence.manage` pour déclarer l'absence d'AUTRUI, une simple
   * session active pour la SIENNE. Une garde uniforme dans l'action interdirait
   * à chacun de déclarer sa propre absence, ou ouvrirait celle des autres à
   * tous. Le service tranche, et la politique `user_absences_insert` refait la
   * même distinction en dernier ressort.
   */
  declareAbsenceAction: "declareAbsence",
  revokeAbsenceAction: "revokeAbsenceEarly",
  /*
   * Le rapport « Situation par registre » ne prend aucun filtre d'écran : sa
   * seule entrée est un format de fichier. La garde `export.generate` vit donc
   * dans le producteur, au plus près de la lecture qu'elle protège.
   */
  exportRegisterReportAction: "produceRegisterReport",
};

// ─── Balayage des sources ────────────────────────────────────────────────────

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

const SOURCES = walk("src");

/** Fichiers portant la directive « use server ». */
const ACTION_FILES = SOURCES.filter((path) => {
  const source = readFileSync(path, "utf8");
  return source.startsWith('"use server"') || source.startsWith("'use server'");
});

interface Action {
  readonly file: string;
  readonly name: string;
  readonly body: string;
}

/**
 * Corps d'une fonction, de l'accolade ouvrante à sa fermante.
 *
 * ⚠️ L'accolade du CORPS n'est pas la première rencontrée. Une signature comme
 * `function f(x: unknown): Promise<{ status: string }> {` en contient une dans
 * son type de retour : la prendre pour le début du corps fait s'arrêter le
 * comptage bien trop tôt, et la fonction paraît ne rien contenir. Le premier jet
 * de ce test a ainsi déclaré « sans garde » deux actions qui appelaient
 * `requirePermission` en première ligne.
 *
 * On avance donc en suivant la profondeur des parenthèses ET des chevrons : le
 * corps commence à la première accolade rencontrée hors de toute annotation.
 */
function bodyOf(source: string, startIndex: number): string {
  let parens = 0;
  let angles = 0;
  let open = -1;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") parens += 1;
    else if (character === ")") parens -= 1;
    else if (character === "<") angles += 1;
    else if (character === ">") angles = Math.max(angles - 1, 0);
    else if (character === "{" && parens === 0 && angles === 0) {
      open = index;
      break;
    }
  }

  if (open < 0) return "";

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return source.slice(open);
}

function actionsOf(file: string): Action[] {
  const source = readFileSync(file, "utf8");
  const pattern = /export\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(/g;
  const actions: Action[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    actions.push({ file, name: match[1] ?? "", body: bodyOf(source, match.index) });
  }
  return actions;
}

function mentionsGuard(text: string): boolean {
  return GUARDS.some((guard) => text.includes(guard));
}

/** Fonctions d'aide du même fichier qui, elles, gardent. */
function localGuardHelpers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const helpers: string[] = [];
  const pattern = /(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1] ?? "";
    if (mentionsGuard(bodyOf(source, match.index))) helpers.push(name);
  }
  return helpers;
}

const ALL_ACTIONS = ACTION_FILES.flatMap(actionsOf);

/** Index des services : nom de fonction → garde-t-elle ? */
const SERVICE_GUARDS = new Map<string, boolean>();
for (const file of SOURCES.filter((path) => path.includes(join("src", "services")))) {
  const source = readFileSync(file, "utf8");
  const pattern = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1] ?? "";
    const guarded = mentionsGuard(bodyOf(source, match.index));
    SERVICE_GUARDS.set(name, (SERVICE_GUARDS.get(name) ?? false) || guarded);
  }

  /*
   * ⚠️ LES SERVICES MÉMOÏSÉS PAR REQUÊTE ÉCHAPPAIENT AU BALAYAGE, et le défaut
   * était silencieux dans le mauvais sens : la fonction disparaît de l'index, et
   * toute action qui lui délègue sa garde est dénoncée comme non gardée. On aurait
   * pu croire à une régression de sécurité là où il n'y avait qu'un changement de
   * forme.
   *
   * `export const nom = cache(_nom);` déplace le corps dans une fonction non
   * exportée. On suit donc l'indirection : la garde se lit dans l'implantation,
   * et s'attribue au nom public.
   */
  const memoised = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*cache\(\s*([A-Za-z0-9_]+)\s*\)/g;
  let wrapper: RegExpExecArray | null;
  while ((wrapper = memoised.exec(source)) !== null) {
    const publicName = wrapper[1] ?? "";
    const implementation = wrapper[2] ?? "";
    const declaration = new RegExp(`function\\s+${implementation}\\s*\\(`).exec(source);
    if (declaration === null) continue;

    const guarded = mentionsGuard(bodyOf(source, declaration.index));
    SERVICE_GUARDS.set(publicName, (SERVICE_GUARDS.get(publicName) ?? false) || guarded);
  }
}

// ═════════════════════════════════════════════════════════════════════════════

describe("gardes des Server Actions", () => {
  it("trouve bien des fichiers d'actions à contrôler", () => {
    // Sécurité du test lui-même : un balayage qui ne trouve rien passerait au
    // vert en ne vérifiant rien, ce qui est le pire résultat possible.
    expect(ACTION_FILES.length).toBeGreaterThan(5);
    expect(ALL_ACTIONS.length).toBeGreaterThan(30);
  });

  it("CHAQUE action exportée est gardée, ou justifiée", () => {
    const unguarded: string[] = [];

    for (const action of ALL_ACTIONS) {
      const helpers = localGuardHelpers(action.file);

      const guardedHere = mentionsGuard(action.body);
      const guardedByHelper = helpers.some((helper) => action.body.includes(`${helper}(`));
      const delegated = GUARDED_BY_SERVICE[action.name];
      const guardedByService = delegated !== undefined && SERVICE_GUARDS.get(delegated) === true;
      const guardedBySql = GUARDED_BY_SQL[action.name] !== undefined;
      const deliberate = DELIBERATELY_UNGUARDED[action.name] !== undefined;

      if (!guardedHere && !guardedByHelper && !guardedByService && !guardedBySql && !deliberate) {
        unguarded.push(`${action.file} → ${action.name}`);
      }
    }

    expect(unguarded, `Server Actions sans garde :\n${unguarded.join("\n")}`).toEqual([]);
  });

  it("CHAQUE service nommé comme gardien garde RÉELLEMENT", () => {
    /*
     * ⚠️ La contrepartie de la liste de délégation. Sans ce contrôle, y inscrire
     * une action suffirait à la dispenser — et la liste deviendrait le trou
     * qu'elle est censée fermer.
     */
    const notActuallyGuarding: string[] = [];

    for (const [action, service] of Object.entries(GUARDED_BY_SERVICE)) {
      if (SERVICE_GUARDS.get(service) !== true) {
        notActuallyGuarding.push(`${action} → ${service}`);
      }
    }

    expect(
      notActuallyGuarding,
      `Services déclarés gardiens mais sans garde :\n${notActuallyGuarding.join("\n")}`,
    ).toEqual([]);
  });

  it("CHAQUE fonction SQL nommée comme gardienne contrôle RÉELLEMENT la permission", () => {
    /*
     * On lit les migrations : la fonction doit contenir un `has_permission`
     * suivi d'un refus. Sans ce contrôle, inscrire une action dans la liste SQL
     * suffirait à la dispenser.
     */
    const migrations = readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join("supabase", "migrations", name), "utf8"))
      .join(NEWLINE);

    const ungarded: string[] = [];

    for (const [action, routine] of Object.entries(GUARDED_BY_SQL)) {
      /*
       * On vise la DÉCLARATION, pas la dernière mention. `lastIndexOf` sur
       * « function public.x( » tombait sur la ligne `grant execute on function
       * public.x(…)` en fin de fichier, dont les deux mille caractères suivants
       * ne contiennent évidemment aucune garde — le test accusait à tort trois
       * fonctions parfaitement protégées.
       */
      const start = migrations.indexOf(`create or replace function public.${routine}(`);
      if (start < 0) {
        ungarded.push(`${action} → ${routine} (fonction introuvable)`);
        continue;
      }

      const body = migrations.slice(start, start + 2000);
      if (!body.includes("has_permission") || !body.includes("raise exception")) {
        ungarded.push(`${action} → ${routine} (aucun contrôle de permission)`);
      }
    }

    expect(ungarded, `Fonctions SQL sans garde :${NEWLINE}${ungarded.join(NEWLINE)}`).toEqual([]);
  });

  it("les listes d'exception ne contiennent aucune entrée morte", () => {
    // Une exception qui ne correspond plus à aucune action est un vestige : elle
    // laisse croire qu'un cas est traité alors qu'il a disparu.
    const names = new Set(ALL_ACTIONS.map((action) => action.name));
    const stale = [
      ...Object.keys(DELIBERATELY_UNGUARDED),
      ...Object.keys(GUARDED_BY_SERVICE),
      ...Object.keys(GUARDED_BY_SQL),
    ].filter((name) => !names.has(name));

    expect(stale, `Exceptions sans action correspondante :\n${stale.join("\n")}`).toEqual([]);
  });

  it("chaque dispense porte une raison écrite", () => {
    for (const [action, reason] of Object.entries(DELIBERATELY_UNGUARDED)) {
      expect(reason.length, action).toBeGreaterThan(20);
    }
  });
});
