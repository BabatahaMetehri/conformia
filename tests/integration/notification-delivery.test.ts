// @vitest-environment node

/**
 * ENVOI RÉEL DE COURRIELS, DE BOUT EN BOUT.
 *
 * ⚠️ CE QUI MANQUAIT : `runNotificationJob` n'était appelé par AUCUN test, les
 * deux fournisseurs n'étaient jamais instanciés, et les gabarits n'étaient
 * jamais rendus par le chemin qui les rend en production. Le module de
 * notification était donc entièrement écrit et entièrement non éprouvé — la
 * pire des situations, parce qu'elle a l'air d'être la meilleure : le code est
 * là, il est relu, il est commenté, et personne n'a jamais vu un message partir.
 *
 * ⚠️ AUCUN SIMULACRE D'ENVOI. Mailpit — la boîte aux lettres locale de Supabase —
 * reçoit de VRAIS messages par SMTP et les rend interrogeables. Un `vi.mock` du
 * fournisseur vérifierait qu'on appelle une fonction ; il ne vérifierait ni que
 * le message part, ni qu'il porte le bon destinataire, ni que son corps tient
 * debout. Or c'est exactement ce qui casse.
 *
 * ⚠️ LES DEUX FOURNISSEURS SONT ÉPROUVÉS PAR LES MÊMES SCÉNARIOS. `smtp` parle
 * directement à Mailpit ; `resend` parle au vrai SDK, qui parle en HTTP à un
 * relais local, qui remet le message à Mailpit (voir tests/helpers/resend-shim.ts).
 * Le code de production est IDENTIQUE dans les deux cas — c'est ce qui donne un
 * sens à la promesse « changer de fournisseur est une écriture en base ».
 *
 * Prérequis : `supabase start`. Lancement : `npm run test:rls`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runNotificationJob } from "@/server/jobs/process-notifications";
import { EMAIL_RETRY_BASE_MS, MAX_EMAIL_ATTEMPTS } from "@/config/notifications";

import { clearMailbox, listMessages, messageBody, messagesTo, settle } from "../helpers/mailpit";
import { startResendShim, type ResendShim } from "../helpers/resend-shim";
import {
  DORMANT_CHANNELS,
  UnconfiguredChannelProvider,
  type DormantChannelProvider,
} from "@/services/notifications/providers/dormant-channels";
import { ResendProvider } from "@/services/notifications/providers/resend";
import { SmtpProvider } from "@/services/notifications/providers/smtp";
import { createTestScope, destroyTestScope, type TestScope } from "../helpers/test-scope";

// ─── Repères de temps ────────────────────────────────────────────────────────

/**
 * Midi UTC, aujourd'hui — donc 13 h à Alger, sans ambiguïté de date.
 *
 * ⚠️ `due_notification_candidates` calcule sa journée de référence en heure
 * d'ALGER. À 23 h 30 UTC, Alger est déjà le lendemain ; un instant choisi au
 * hasard ferait basculer tous les jalons d'un jour, une fois sur vingt-quatre.
 * Midi est le seul moment qui ne peut pas se tromper de date.
 *
 * C'est aussi 13 h, et non 07 h : le résumé hebdomadaire part le lundi à 07 h,
 * et le déclencher au milieu de ces scénarios ajouterait des messages qui ne
 * leur appartiennent pas.
 */
const NOW = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00.000Z`);

/** Échéance interne telle que `interne + décalage = aujourd'hui`. */
function echeancePourDecalage(decalage: number): string {
  const date = new Date(NOW.getTime());
  date.setUTCDate(date.getUTCDate() - decalage);
  return date.toISOString().slice(0, 10);
}

function plusDeJours(iso: string, jours: number): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + jours);
  return date.toISOString().slice(0, 10);
}

// ─── Contexte partagé ────────────────────────────────────────────────────────

let scope: TestScope;
let shim: ResendShim;

/** Adresse d'un compte du contexte. */
async function adresse(userId: string): Promise<string> {
  const { rows } = await scope.pool.query<{ email: string }>(
    "select email from public.profiles where id = $1",
    [userId],
  );
  return rows[0]?.email ?? "";
}

/**
 * Destinataires DISTINCTS de ce dossier appartenant à MON entité, sur ce canal.
 *
 * ⚠️ `DISTINCT`, ET C'EST UNE PROPRIÉTÉ DU MODÈLE, PAS UNE COMMODITÉ. Une même
 * personne peut être visée DEUX FOIS pour le même dossier et le même jour : une
 * fois par le jalon (`notification_rules`) et une fois par le palier d'escalade
 * (`escalation_policies`) — à J+1, le responsable l'est par les deux. Ce sont
 * deux lignes légitimes, portant deux `rule_id`/`escalation_policy_id`
 * différents, et la clé de déduplication les distingue à dessein.
 *
 * Elles ne produisent pourtant qu'UN SEUL courriel : le regroupement horaire les
 * réunit. C'est donc l'ENSEMBLE des destinataires, et non le compte des lignes,
 * qui se compare à ce qui arrive dans la boîte.
 */
async function destinatairesInternes(
  occurrenceId: string,
  canal: "EMAIL" | "IN_APP",
): Promise<string[]> {
  const { rows } = await scope.pool.query<{ recipient_id: string }>(
    `select distinct n.recipient_id
       from public.notifications n
       join public.profiles p on p.id = n.recipient_id
      where n.occurrence_id = $1
        and n.channel = $2::public.notification_channel
        and p.entity_id = $3`,
    [occurrenceId, canal, scope.entityId],
  );
  return rows.map((row) => row.recipient_id).sort();
}

/**
 * Messages de la boîte adressés à MON contexte.
 *
 * ⚠️ FILTRÉ SUR MES ADRESSES, et pas « tous les messages ». L'audience
 * `DIRECTION` désigne les porteurs du rôle dans TOUTE la base : une escalade
 * J+7 sur mon dossier prévient légitimement la direction d'AGROESPACE, dont les
 * comptes ne m'appartiennent pas. Compter la boîte entière ferait dépendre mes
 * assertions du référentiel chargé — exactement le défaut que la garde
 * d'hygiène de cette suite existe pour empêcher.
 */
async function messagesInternes(adresses: readonly string[]): Promise<string[]> {
  const tous = await listMessages();
  return tous
    .filter((message) => message.to.some((destinataire) => adresses.includes(destinataire)))
    .map((message) => message.id);
}

async function attendreMessagesInternes(
  adresses: readonly string[],
  attendus: number,
): Promise<string[]> {
  const limite = Date.now() + 20_000;
  let vus: string[] = [];
  while (Date.now() < limite) {
    vus = await messagesInternes(adresses);
    if (vus.length >= attendus) return vus;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return vus;
}

/** Bascule le fournisseur d'envoi. C'est un RÉGLAGE EN BASE, pas une variable. */
async function choisirFournisseur(nom: "smtp" | "resend"): Promise<void> {
  /*
   * ⚠️ LA LIGNE, PAS UNE COLONNE. `app_settings` a porte un temps une colonne
   * `email_provider` doublant cette ligne clé/valeur. L'ecran ecrivait la ligne,
   * le repartiteur lisait la colonne : la bascule n'avait aucun effet. La
   * migration 0026 a supprime la colonne ; ce test ecrit desormais la seule
   * source qui existe.
   */
  await scope.pool.query(
    "update public.app_settings set value = to_jsonb($1::text) where key = 'email_provider'",
    [nom],
  );
}

/**
 * Porteurs du rôle DIRECTION dans MON entité.
 *
 * ⚠️ L'AUDIENCE `DIRECTION` DÉSIGNE UN RÔLE, PAS UNE PERSONNE — c'est justement
 * ce qui la distingue des trois autres, qui lisent une colonne du dossier. Un
 * scénario qui attendrait « le compte que je viens de créer » deviendrait faux
 * dès qu'un scénario voisin en crée un second, et l'échec accuserait la chaîne
 * d'escalade d'un défaut qui n'est pas le sien.
 */
async function directionsInternes(): Promise<string[]> {
  const { rows } = await scope.pool.query<{ user_id: string }>(
    `select distinct ur.user_id
       from public.user_roles ur
       join public.roles r on r.id = ur.role_id
       join public.profiles p on p.id = ur.user_id
      where r.code = 'DIRECTION'
        and ur.revoked_at is null
        and (ur.expires_at is null or ur.expires_at > now())
        and p.entity_id = $1`,
    [scope.entityId],
  );
  return rows.map((row) => row.user_id);
}

/**
 * Adresse d'un relais qu'on vient de fermer : la connexion y sera REFUSÉE.
 *
 * On ouvre puis referme un vrai serveur pour obtenir un port dont on sait qu'il
 * est libre. Un numéro écrit en dur risquerait de tomber sur un service qui
 * répond — ou, s'il est réservé, sur un système qui laisse la connexion expirer
 * au lieu de la refuser.
 */
async function portFerme(): Promise<string> {
  const mort = await startResendShim();
  await mort.stop();
  return mort.baseUrl;
}

/**
 * Solde la file d'envoi DE MON CONTEXTE : ses lignes passent pour remises.
 *
 * ⚠️ MARQUÉES ENVOYÉES, ET SURTOUT PAS SUPPRIMÉES — la première version le
 * faisait, et se retournait contre elle-même. La déduplication REPOSE sur ces
 * lignes : c'est leur présence, via l'index unique
 * `notifications_rule_dedup_key`, qui empêche le cycle suivant de réannoncer une
 * alerte déjà annoncée. Les effacer rendait aux dossiers des scénarios
 * précédents — qui existent toujours, et dont l'échéance tombe toujours
 * aujourd'hui — le droit de repartir : un scénario qui n'attendait que trois
 * requêtes en voyait treize.
 *
 * Poser `sent_at` vide la file SANS toucher à la clé de déduplication. C'est
 * exactement ce que fait `mark_notifications_sent` en exploitation.
 *
 * ⚠️ DEUX CRITÈRES, ET LE SECOND N'EST PAS REDONDANT. Une alerte porte deux
 * rattachements : son DESTINATAIRE et son DOSSIER. L'escalade J+7 vise l'audience
 * `DIRECTION`, c'est-à-dire les porteurs du rôle dans toute la base — des comptes
 * étrangers à l'entité de test, dont la notification concerne pourtant l'un de mes
 * dossiers. N'agir que par destinataire les laissait en file, où elles
 * consommaient les tentatives et les temporisations du scénario suivant.
 */
async function soldeMaFile(): Promise<void> {
  await scope.pool.query(
    `update public.notifications n
        set sent_at = pg_catalog.now()
       from public.profiles p
      where p.id = n.recipient_id and p.entity_id = $1 and n.sent_at is null`,
    [scope.entityId],
  );
  await scope.pool.query(
    `update public.notifications n
        set sent_at = pg_catalog.now()
       from public.obligation_occurrences oc
      where oc.id = n.occurrence_id and oc.entity_id = $1 and n.sent_at is null`,
    [scope.entityId],
  );
}

// ─── Mise en place ───────────────────────────────────────────────────────────

beforeAll(async () => {
  scope = await createTestScope();
  shim = await startResendShim();

  /*
   * ⚠️ LE SDK RESEND TROUVE LE RELAIS SEUL. Le paquet lit `RESEND_BASE_URL` à la
   * construction du client, et la fabrique construit un client neuf à chaque
   * lot : la variable posée ici est donc prise en compte sans redémarrage, et
   * sans qu'aucune ligne de `resend.ts` n'ait été touchée.
   */
  process.env["RESEND_BASE_URL"] = shim.baseUrl;

  /*
   * ⚠️ UNE SAUVEGARDE RÉCENTE, POSÉE EXPRÈS. Sans elle, le cycle constate qu'il
   * n'existe aucune sauvegarde réussie et prévient TOUS les administrateurs par
   * courriel — un comportement juste, mais qui n'appartient à aucun de ces
   * scénarios et fausserait chacun de leurs comptages.
   */
  await scope.pool.query(
    `insert into public.backup_runs (started_at, finished_at, status, kind, detail)
     values (now() - interval '2 hours', now() - interval '1 hour', 'SUCCEEDED', 'DAILY',
             'TEST-notification-delivery')`,
  );

  /*
   * ⚠️ LES ALERTES D'EXPLOITATION DÉJÀ EN FILE SONT TENUES POUR REMISES.
   *
   * Les autres fichiers de la suite exécutent le cycle sans poser de sauvegarde
   * fraîche : chacun laisse derrière lui une alerte « sauvegarde périmée » par
   * administrateur, sur un compte qui n'appartient à aucune entité de test et que
   * personne ne nettoie. Ces lignes prendraient des places dans le lot — plafonné
   * à cinquante — et feraient échouer le scénario des cinquante destinataires
   * pour une raison qui n'est pas la sienne.
   *
   * La sélection est ÉTROITE, et c'est ce qui la rend acceptable : `occurrence_id
   * is null` ne désigne que les alertes d'EXPLOITATION. Aucune alerte rattachée à
   * un dossier n'est touchée : celles-là appartiennent au scénario qui les a
   * produites, et en disposer serait s'arroger un droit qu'un test n'a pas.
   */
  await scope.pool.query(
    `update public.notifications
        set sent_at = pg_catalog.now()
      where channel = 'EMAIL' and sent_at is null and occurrence_id is null`,
  );
});

afterAll(async () => {
  await scope.pool.query(
    "delete from public.backup_runs where detail = 'TEST-notification-delivery'",
  );
  await scope.pool.query(
    "update public.app_settings set value = to_jsonb('resend'::text) where key = 'email_provider'",
  );
  delete process.env["RESEND_BASE_URL"];
  await shim.stop();
  await destroyTestScope(scope);
});

beforeEach(async () => {
  /*
   * ⚠️ AVANT, ET NON APRÈS. Un nettoyage en fin de test laisse la boîte pleine
   * si le test échoue en cours de route, et le suivant compte alors des messages
   * qui ne sont pas les siens — un échec qui se déplace d'un test à l'autre à
   * chaque exécution.
   */
  await clearMailbox();

  /*
   * ⚠️ ET LA FILE AVEC, POUR LA MÊME RAISON. Un lot prend jusqu'à cinquante
   * lignes ; une ligne laissée en échec par un scénario précédent serait
   * reprise par le suivant, consommerait ses temporisations et ferait dépendre
   * sa durée — donc son verdict — de l'ordre d'exécution.
   */
  await soldeMaFile();
});

// ═════════════════════════════════════════════════════════════════════════════
// LES MÊMES SCÉNARIOS, SUR LES DEUX FOURNISSEURS
// ═════════════════════════════════════════════════════════════════════════════

describe.each(["smtp", "resend"] as const)("acheminement réel — fournisseur %s", (fournisseur) => {
  beforeAll(async () => {
    await choisirFournisseur(fournisseur);
  });

  it("un courriel part pour chaque alerte due, et un seul", async () => {
    const responsable = await scope.createProfile();
    const suppleant = await scope.createProfile();
    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(1);

    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: `${fournisseur}-vol-01`,
      ownerId: responsable,
      deputyId: suppleant,
      internalDueDate: interne,
      legalDueDate: plusDeJours(interne, 7),
    });

    await runNotificationJob(scope.admin, NOW);

    // J+1 vise le RESPONSABLE et le SUPPLÉANT, sur les deux canaux.
    const parCourriel = await destinatairesInternes(dossier, "EMAIL");
    expect(parCourriel).toEqual([responsable, suppleant].sort());

    const adresses = await Promise.all([adresse(responsable), adresse(suppleant)]);
    const recus = await attendreMessagesInternes(adresses, parCourriel.length);

    /*
     * ⚠️ L'IDENTITÉ EST L'ASSERTION : autant de messages DANS LA BOÎTE que de
     * destinataires visés, ni plus ni moins. Compter seulement « au moins un »
     * laisserait passer le défaut qui coûte le plus cher — le message envoyé
     * deux fois. Et l'exiger ÉGAL, plutôt que supérieur, est ce qui rend le
     * regroupement observable : le responsable est visé deux fois à J+1, par le
     * jalon et par l'escalade, et ne reçoit pourtant qu'un message.
     */
    expect(recus).toHaveLength(parCourriel.length);
    await settle();
    expect(await messagesInternes(adresses)).toHaveLength(parCourriel.length);
  });

  it("les destinataires sont ceux de l'audience, et personne d'autre", async () => {
    const responsable = await scope.createProfile();
    const suppleant = await scope.createProfile();
    const superviseur = await scope.createProfile();
    const etranger = await scope.createProfile();
    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(3);

    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: `${fournisseur}-aud-01`,
      ownerId: responsable,
      deputyId: suppleant,
      validatorId: superviseur,
      internalDueDate: interne,
      legalDueDate: plusDeJours(interne, 7),
    });

    await runNotificationJob(scope.admin, NOW);

    // J+3 ajoute le SUPERVISEUR au responsable et au suppléant.
    expect(await destinatairesInternes(dossier, "EMAIL")).toEqual(
      [responsable, suppleant, superviseur].sort(),
    );

    const adresses = await Promise.all([
      adresse(responsable),
      adresse(suppleant),
      adresse(superviseur),
    ]);
    expect(await attendreMessagesInternes(adresses, 3)).toHaveLength(3);

    /*
     * ⚠️ Le collègue sans lien avec le dossier ne reçoit RIEN. Un test qui ne
     * vérifie que les destinataires attendus passerait aussi bien si l'audience
     * était « tout le monde » — et une alerte de conformité adressée à qui n'a
     * pas à la connaître est une fuite, pas une maladresse.
     */
    expect(await messagesTo(await adresse(etranger))).toHaveLength(0);
  });

  it("deux exécutions ne produisent qu'un seul courriel — la contrainte tranche", async () => {
    const responsable = await scope.createProfile();
    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(7);

    await scope.createOccurrence({
      obligationId: obligation,
      periodKey: `${fournisseur}-dedup-01`,
      ownerId: responsable,
      internalDueDate: interne,
      legalDueDate: plusDeJours(interne, 7),
    });

    const premier = await runNotificationJob(scope.admin, NOW);
    const second = await runNotificationJob(scope.admin, NOW);

    /*
     * ⚠️ CE TEST ÉCHOUE SI L'ON RETIRE `notifications_rule_dedup_key`. Rien dans
     * le planificateur ne cherche ce qu'il a déjà envoyé : il propose à chaque
     * cycle, et c'est l'index UNIQUE qui refuse la seconde insertion. Retirer
     * l'index ferait passer le second cycle de « 0 créée, 1 doublon » à
     * « 1 créée », et un deuxième courriel arriverait — ce que la boîte dirait.
     */
    expect(premier.scheduled).toBeGreaterThan(0);
    expect(second.scheduled).toBe(0);
    expect(second.duplicates).toBeGreaterThan(0);

    const boite = await adresse(responsable);
    await settle();
    expect(await messagesTo(boite)).toHaveLength(1);
  });

  it("un dossier déposé, archivé ou sans objet ne déclenche rien", async () => {
    const responsable = await scope.createProfile();
    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(1);
    const legale = plusDeJours(interne, 7);

    for (const statut of ["SUBMITTED", "ARCHIVED"] as const) {
      await scope.createOccurrence({
        obligationId: obligation,
        periodKey: `${fournisseur}-clos-${statut}`,
        ownerId: responsable,
        status: statut,
        internalDueDate: interne,
        legalDueDate: legale,
      });
    }

    /*
     * `NOT_APPLICABLE` exige un motif — une contrainte de table. La fabrique ne
     * le propose pas : on insère donc directement, dans MON entité.
     */
    await scope.pool.query(
      `insert into public.obligation_occurrences
         (entity_id, obligation_type_id, period_key, period_start, period_end,
          legal_due_date, internal_due_date, status, owner_id, na_reason)
       values ($1, $2, $3, date '2026-01-01', date '2026-01-31', $4::date, $5::date,
               'NOT_APPLICABLE', $6, 'Aucune activité sur la période')`,
      [scope.entityId, obligation, `${fournisseur}-clos-NA`, legale, interne, responsable],
    );

    await runNotificationJob(scope.admin, NOW);

    /*
     * ⚠️ Le silence est ici le comportement JUSTE. Rappeler une échéance à
     * quelqu'un qui a déposé son dossier lui apprend que les alertes du système
     * ne veulent rien dire — et il cessera de lire les autres.
     */
    await settle();
    expect(await messagesTo(await adresse(responsable))).toHaveLength(0);
  });

  it("plusieurs alertes de la même heure partent en UN seul message", async () => {
    const responsable = await scope.createProfile();
    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(7);

    for (const suffixe of ["a", "b"]) {
      await scope.createOccurrence({
        obligationId: obligation,
        periodKey: `${fournisseur}-groupe-${suffixe}`,
        ownerId: responsable,
        internalDueDate: interne,
        legalDueDate: plusDeJours(interne, 7),
      });
    }

    await runNotificationJob(scope.admin, NOW);

    const boite = await adresse(responsable);
    await settle();
    const recus = await messagesTo(boite);

    /*
     * ⚠️ DEUX ALERTES, UN MESSAGE. La clé de regroupement est (destinataire,
     * heure prévue) — le planificateur pose la même `scheduled_for` sur toutes
     * les lignes d'un cycle, précisément pour que ce rapprochement soit une
     * égalité et non une arithmétique sur des horodatages.
     */
    expect(recus).toHaveLength(1);

    const premier = recus[0];
    expect(premier).toBeDefined();
    if (premier === undefined) return;

    const corps = await messageBody(premier.id);

    /*
     * Le message groupé énumère les dossiers, une ligne chacun. Son en-tête
     * annonce le nombre — c'est ce qui le distingue d'une alerte ordinaire
     * répétée, et ce qui évite d'intituler « Votre semaine » un message arrivé
     * un mardi après-midi.
     */
    expect(premier.subject).toContain("2");
    expect(corps.text).toContain("Obligation de test");
    expect(corps.text.split("Obligation de test").length - 1).toBeGreaterThanOrEqual(2);
    expect(corps.html.length).toBeGreaterThan(0);
    expect(corps.text).toContain("aucune pièce jointe");
  });

  it("l'alerte destinée à un absent est reçue par son suppléant, mention comprise", async () => {
    const absent = await scope.createProfile({ fullName: "Karim Belhadj" });
    const suppleant = await scope.createProfile({ fullName: "Amine Cherif" });
    const obligation = await scope.createObligation();
    // J-7 : seul le RESPONSABLE est visé. Le déroutement est donc isolé — à J+1,
    // le suppléant serait aussi destinataire à son propre titre et les deux
    // alertes se fondraient en un message groupé, sans mention.
    const interne = echeancePourDecalage(-7);

    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: `${fournisseur}-absence-01`,
      ownerId: absent,
      deputyId: suppleant,
      internalDueDate: interne,
      legalDueDate: plusDeJours(interne, 7),
    });

    await scope.createAbsence({ userId: absent });

    await runNotificationJob(scope.admin, NOW);

    await settle();
    const versSuppleant = await messagesTo(await adresse(suppleant));
    expect(versSuppleant).toHaveLength(1);

    // ⚠️ L'ABSENT NE REÇOIT PAS LE COURRIEL : c'est tout l'objet du déroutement.
    expect(await messagesTo(await adresse(absent))).toHaveLength(0);

    const premier = versSuppleant[0];
    expect(premier).toBeDefined();
    if (premier === undefined) return;

    const corps = await messageBody(premier.id);
    /*
     * ⚠️ LA MENTION, ET LE NOM. Sans elle, le suppléant reçoit une alerte sur un
     * dossier dont il n'est pas responsable et cherche d'abord ce qu'il a
     * lui-même oublié de faire.
     */
    expect(corps.text).toContain("Karim Belhadj");
    expect(corps.text).toContain("suppléant");

    /*
     * ⚠️ L'IN-APP RESTE À L'ABSENT. C'est la contrepartie du déroutement : à son
     * retour, il doit retrouver le contexte. Une alerte redirigée PUIS effacée
     * de sa liste lui ferait découvrir un dossier traité sans qu'il ait jamais
     * su qu'il lui était confié.
     */
    expect(await destinatairesInternes(dossier, "IN_APP")).toEqual([absent]);
    expect(await destinatairesInternes(dossier, "EMAIL")).toEqual([suppleant]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CHAÎNES D'ALERTE
// ═════════════════════════════════════════════════════════════════════════════

describe("chaînes d'alerte", () => {
  beforeAll(async () => {
    await choisirFournisseur("smtp");
  });

  it("la chaîne standard élargit le cercle à J+1, J+3 puis J+7", async () => {
    const responsable = await scope.createProfile();
    const suppleant = await scope.createProfile();
    const superviseur = await scope.createProfile();
    await scope.createUserWithRole("DIRECTION");
    const obligation = await scope.createObligation({ criticality: "MEDIUM" });

    const dossiers = new Map<number, string>();
    for (const decalage of [1, 3, 7]) {
      const interne = echeancePourDecalage(decalage);
      dossiers.set(
        decalage,
        await scope.createOccurrence({
          obligationId: obligation,
          periodKey: `chaine-J+${String(decalage)}`,
          ownerId: responsable,
          deputyId: suppleant,
          validatorId: superviseur,
          internalDueDate: interne,
          legalDueDate: plusDeJours(interne, 7),
        }),
      );
    }

    await runNotificationJob(scope.admin, NOW);

    /*
     * ⚠️ L'ÉLARGISSEMENT EST PROGRESSIF, ET C'EST LA RÈGLE MÉTIER. Prévenir la
     * Direction dès le premier jour de retard rendrait l'alerte insignifiante ;
     * ne la prévenir jamais rendrait le dispositif inutile. Les trois paliers
     * sont des DONNÉES (`notification_rules`) — ce test lit leur effet, il ne
     * réécrit pas la chaîne.
     */
    expect(await destinatairesInternes(dossiers.get(1) ?? "", "EMAIL")).toEqual(
      [responsable, suppleant].sort(),
    );
    expect(await destinatairesInternes(dossiers.get(3) ?? "", "EMAIL")).toEqual(
      [responsable, suppleant, superviseur].sort(),
    );
    expect(await destinatairesInternes(dossiers.get(7) ?? "", "EMAIL")).toEqual(
      [responsable, suppleant, superviseur, ...(await directionsInternes())].sort(),
    );

    // La Direction n'entre qu'au dernier palier : sans cela, l'élargissement
    // n'en serait pas un.
    const directions = await directionsInternes();
    expect(directions.length).toBeGreaterThan(0);
    for (const membre of directions) {
      expect(await destinatairesInternes(dossiers.get(3) ?? "", "EMAIL")).not.toContain(membre);
    }
  });

  it("un dossier CRITIQUE suit la chaîne accélérée, dès le jour de l'échéance", async () => {
    const responsable = await scope.createProfile();
    const suppleant = await scope.createProfile();
    const superviseur = await scope.createProfile();
    await scope.createUserWithRole("DIRECTION");

    const critique = await scope.createObligation({ criticality: "CRITICAL" });
    const ordinaire = await scope.createObligation({ criticality: "MEDIUM" });

    const trio = { ownerId: responsable, deputyId: suppleant, validatorId: superviseur };
    const jourJ = echeancePourDecalage(0);
    const deuxJours = echeancePourDecalage(2);

    const critiqueJ0 = await scope.createOccurrence({
      obligationId: critique,
      periodKey: "critique-J+0",
      ...trio,
      internalDueDate: jourJ,
      legalDueDate: plusDeJours(jourJ, 7),
    });
    const critiqueJ2 = await scope.createOccurrence({
      obligationId: critique,
      periodKey: "critique-J+2",
      ...trio,
      internalDueDate: deuxJours,
      legalDueDate: plusDeJours(deuxJours, 7),
    });
    const ordinaireJ0 = await scope.createOccurrence({
      obligationId: ordinaire,
      periodKey: "ordinaire-J+0",
      ...trio,
      internalDueDate: jourJ,
      legalDueDate: plusDeJours(jourJ, 7),
    });

    await runNotificationJob(scope.admin, NOW);

    /*
     * ⚠️ J+0 : le trio complet est prévenu LE JOUR MÊME. Sur une obligation
     * critique, un retard d'un jour n'est plus un retard administratif.
     */
    expect(await destinatairesInternes(critiqueJ0, "EMAIL")).toEqual(
      [responsable, suppleant, superviseur].sort(),
    );
    // J+2 : la Direction entre, deux jours au lieu de sept.
    expect(await destinatairesInternes(critiqueJ2, "EMAIL")).toEqual(
      [responsable, suppleant, superviseur, ...(await directionsInternes())].sort(),
    );

    /*
     * ⚠️ LA CONTRE-ÉPREUVE. Le même jour, la même échéance, la même équipe :
     * seule la criticité change, et rien ne part. Sans elle, le test ci-dessus
     * passerait aussi si TOUS les dossiers alertaient à J+0.
     */
    expect(await destinatairesInternes(ordinaireJ0, "EMAIL")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RÉSILIENCE
//
// ⚠️ Ces scénarios s'exécutent sous `resend`, parce que le relais local sait
// REFUSER un message à la demande. Ce qu'ils éprouvent — reprises, échec
// définitif, panne totale — vit dans `dispatcher.ts`, c'est-à-dire AU-DESSUS de
// l'interface de fournisseur : le comportement est le même quel que soit celui
// qui échoue.
// ═════════════════════════════════════════════════════════════════════════════

describe("résilience de la diffusion", () => {
  beforeAll(async () => {
    await choisirFournisseur("resend");
    process.env["RESEND_BASE_URL"] = shim.baseUrl;
  });

  it("un refus persistant épuise trois tentatives, avec temporisation croissante", async () => {
    const responsable = await scope.createProfile();
    const administrateur = await scope.createUserWithRole("ADMIN");
    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(-7);

    await scope.createOccurrence({
      obligationId: obligation,
      periodKey: "reprise-01",
      ownerId: responsable,
      internalDueDate: interne,
      legalDueDate: plusDeJours(interne, 7),
    });

    const boite = await adresse(responsable);
    shim.reject(boite);

    const avant = shim.requestCount();
    const debut = Date.now();
    await runNotificationJob(scope.admin, NOW);
    const ecoule = Date.now() - debut;

    /*
     * ⚠️ TROIS TENTATIVES DANS LE PREMIER CYCLE, séparées de 1 s puis 2 s. La
     * durée est l'assertion : un code qui réessaierait trois fois SANS
     * attendre passerait un test qui ne compte que les appels, et se ferait
     * limiter par le fournisseur au premier incident réel.
     */
    expect(shim.requestCount() - avant).toBe(MAX_EMAIL_ATTEMPTS);
    expect(ecoule).toBeGreaterThanOrEqual(EMAIL_RETRY_BASE_MS + EMAIL_RETRY_BASE_MS * 2);

    // Rien n'est arrivé : le refus est un refus.
    expect(await messagesTo(boite)).toHaveLength(0);

    const { rows } = await scope.pool.query<{ retry_count: number; error_message: string }>(
      `select n.retry_count, n.error_message
           from public.notifications n
          where n.recipient_id = $1 and n.channel = 'EMAIL'`,
      [responsable],
    );
    expect(rows[0]?.retry_count).toBe(1);
    // ⚠️ Le motif est CONSERVÉ. « L'envoi a échoué » sans le dire pourquoi
    // oblige à rejouer le lot pour apprendre ce que la ligne savait déjà.
    expect(rows[0]?.error_message ?? "").toContain("Invalid recipient");

    /*
     * Deux cycles de plus épuisent le budget — il est GLOBAL à la ligne, pas
     * au cycle, sans quoi « échec définitif » ne voudrait rien dire.
     */
    await runNotificationJob(scope.admin, NOW);
    await runNotificationJob(scope.admin, NOW);

    const { rows: apres } = await scope.pool.query<{ retry_count: number }>(
      `select n.retry_count from public.notifications n
          where n.recipient_id = $1 and n.channel = 'EMAIL'`,
      [responsable],
    );
    expect(apres[0]?.retry_count).toBe(MAX_EMAIL_ATTEMPTS);

    /*
     * ⚠️ L'ADMINISTRATEUR EST PRÉVENU — EN INTERNE. Signaler par courriel qu'un
     * courriel ne part pas supposerait résolu le problème qu'on annonce.
     */
    const { rows: alerte } = await scope.pool.query<{ n: string }>(
      `select count(*) as n from public.notifications n
          where n.recipient_id = $1 and n.kind = 'DELIVERY_FAILURE' and n.channel = 'IN_APP'`,
      [administrateur],
    );
    expect(Number(alerte[0]?.n ?? 0)).toBe(1);
  }, 120_000);

  it("cinquante destinataires, un seul invalide : les quarante-neuf autres sont servis", async () => {
    /*
     * ⚠️ LE LOT EST PLAFONNÉ À CINQUANTE LIGNES, et ce scénario en demande
     * exactement cinquante. Ma propre file est vidée avant chaque scénario ;
     * reste à vérifier qu'aucune ligne ÉTRANGÈRE ne subsiste, car elle
     * prendrait une place et ferait échouer le test pour une raison qui n'est
     * pas la sienne. On le DIT plutôt que de laisser chercher — et on ne
     * l'efface pas : disposer des lignes d'un voisin serait s'arroger un droit
     * qu'un test n'a pas.
     */
    const { rows: residu } = await scope.pool.query<{ n: string }>(
      `select count(*) as n from public.notifications n
          where n.channel = 'EMAIL' and n.sent_at is null and n.retry_count < $1`,
      [MAX_EMAIL_ATTEMPTS],
    );
    expect(Number(residu[0]?.n ?? 0)).toBe(0);

    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(-7);
    const adresses: string[] = [];

    for (let index = 0; index < 50; index += 1) {
      const responsable = await scope.createProfile();
      adresses.push(await adresse(responsable));
      await scope.createOccurrence({
        obligationId: obligation,
        periodKey: `lot-${String(index).padStart(2, "0")}`,
        ownerId: responsable,
        internalDueDate: interne,
        legalDueDate: plusDeJours(interne, 7),
      });
    }

    const invalide = adresses[0] ?? "";
    shim.reject(invalide);

    const rapport = await runNotificationJob(scope.admin, NOW);

    /*
     * ⚠️ LE RAPPORT D'ABORD, LA BOÎTE ENSUITE. Les deux doivent concorder, et
     * les lire tous les deux distingue deux incidents que « il manque un
     * message » confondrait : quarante-neuf remises annoncées pour
     * quarante-huit reçues désignent le transport ; quarante-huit annoncées
     * désignent le diffuseur.
     */
    expect(rapport.sent).toBe(49);

    /*
     * ⚠️ LA PROMESSE EST « UN ÉCHEC N'INTERROMPT JAMAIS LE LOT ». Elle ne se
     * vérifie qu'avec un lot : sur un seul message, tout code la tient. Ici la
     * ligne fautive est la PREMIÈRE — la position qui aurait emporté les
     * quarante-neuf suivantes si l'exception s'échappait de la boucle.
     */
    const servis = await attendreMessagesInternes(adresses, 49);
    expect(servis).toHaveLength(49);
    expect(await messagesTo(invalide)).toHaveLength(0);
  }, 240_000);

  it("une panne totale du fournisseur laisse les notifications in-app intactes", async () => {
    const responsable = await scope.createProfile();
    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(-15);

    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: "panne-01",
      ownerId: responsable,
      internalDueDate: interne,
      legalDueDate: plusDeJours(interne, 7),
    });

    /*
     * ⚠️ PANNE RÉELLE, PAS SIMULÉE : on pointe le fournisseur sur un port qui
     * vient d'être fermé. Le SDK échoue sur une connexion refusée — l'incident
     * exact d'un fournisseur injoignable, et non une exception que nous aurions
     * nous-mêmes levée.
     *
     * Un port ÉPHÉMÈRE effectivement libéré, et non un numéro bas choisi au
     * hasard : selon le système, une connexion vers un port réservé est refusée
     * aussitôt ou expire au bout d'une minute — et le test mesurerait alors la
     * pile réseau, pas le diffuseur.
     */
    process.env["RESEND_BASE_URL"] = await portFerme();

    try {
      const rapport = await runNotificationJob(scope.admin, NOW);

      /*
       * ⚠️ LE CYCLE N'ÉCHOUE PAS : il est PARTIEL. La planification a réussi, et
       * c'est elle qui compte — une file remplie repartira à l'heure suivante,
       * une file vide ne rattrapera rien.
       */
      expect(rapport.status).toBe("PARTIAL");
      expect(rapport.sent).toBe(0);

      /*
       * ⚠️ ET C'EST LE POINT : la notification IN-APP est là. Elle est écrite par
       * le planificateur, que le diffuseur soit en panne ou non — les deux étapes
       * sont séparées exactement pour cela.
       */
      expect(await destinatairesInternes(dossier, "IN_APP")).toEqual([responsable]);
      expect(await messagesTo(await adresse(responsable))).toHaveLength(0);

      const { rows } = await scope.pool.query<{ n: string }>(
        `select count(*) as n from public.notifications n
          where n.recipient_id = $1 and n.channel = 'EMAIL' and n.sent_at is null`,
        [responsable],
      );
      // La ligne reste EN FILE : rien n'est perdu, tout est rejouable.
      expect(Number(rows[0]?.n ?? 0)).toBe(1);
    } finally {
      process.env["RESEND_BASE_URL"] = shim.baseUrl;
    }
  }, 120_000);

  it("le lot reprend après la panne : la ligne restée en file part au cycle suivant", async () => {
    /*
     * ⚠️ LE COROLLAIRE DU SCÉNARIO PRÉCÉDENT, et il fallait l'écrire. « La ligne
     * reste en file » ne vaut que si elle en sort un jour : sans ce test, une
     * régression qui laisserait les lignes en file pour toujours passerait tous
     * les autres contrôles, et l'incident se lirait comme une réussite.
     */
    const responsable = await scope.createProfile();
    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(-30);

    await scope.createOccurrence({
      obligationId: obligation,
      periodKey: "reprise-apres-panne",
      ownerId: responsable,
      internalDueDate: interne,
      legalDueDate: plusDeJours(interne, 7),
    });

    process.env["RESEND_BASE_URL"] = await portFerme();
    await runNotificationJob(scope.admin, NOW);
    process.env["RESEND_BASE_URL"] = shim.baseUrl;

    const boite = await adresse(responsable);
    expect(await messagesTo(boite)).toHaveLength(0);

    // Le fournisseur revient. Aucune alerte nouvelle n'est planifiée — la
    // déduplication l'interdit — et pourtant le message part.
    const rapport = await runNotificationJob(scope.admin, NOW);
    expect(rapport.scheduled).toBe(0);

    expect(await attendreMessagesInternes([boite], 1)).toHaveLength(1);
  }, 120_000);

  it("un canal dormant ne remplit jamais la file", async () => {
    /*
     * ⚠️ DÉCISION ARRÊTÉE : le courriel est le SEUL canal externe. `SMS` et
     * `WHATSAPP` restent DÉCLARÉS dans l'énumération — le modèle les prévoit —
     * mais `due_notification_candidates` les écarte à la source.
     *
     * Ce que cela évite : qu'un administrateur crée une règle sur le canal SMS,
     * ne reçoive rien, et cherche pendant une semaine où le message s'est perdu.
     * Ici la file ne se remplit même pas, et l'échec ne se répète pas à chaque
     * cycle en noyant les vrais incidents dans le journal.
     */
    const responsable = await scope.createProfile();
    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(-1);

    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: "canal-dormant",
      ownerId: responsable,
      internalDueDate: interne,
      legalDueDate: plusDeJours(interne, 7),
    });

    // Une règle par canal dormant, visant CETTE obligation.
    for (const canal of DORMANT_CHANNELS) {
      await scope.pool.query(
        `insert into public.notification_rules
           (obligation_type_id, offset_days, channel, audience, template_key, is_active)
         values ($1, -1, $2::public.notification_channel, 'RESPONSIBLE', 'UpcomingDeadline', true)`,
        [obligation, canal],
      );
    }

    const { rows: proposees } = await scope.pool.query<{ channel: string }>(
      "select channel::text as channel from public.due_notification_candidates($1) where occurrence_id = $2",
      [NOW.toISOString(), dossier],
    );

    // ⚠️ Aucune candidate SMS ni WHATSAPP : les canaux sont écartés PAR LA
    // REQUÊTE, pas par une vérification de l'appelant qu'on pourrait oublier
    // d'écrire ailleurs.
    expect(proposees.map((row) => row.channel).sort()).toEqual(["EMAIL", "IN_APP"]);

    /*
     * ⚠️ ET SI L'ON PASSE OUTRE, LE REFUS EST LISIBLE. La barrière SQL empêche
     * la file de se remplir ; celle-ci répond à l'appel direct. Les deux sont
     * nécessaires : la première évite l'accumulation silencieuse, la seconde
     * évite qu'un appelant futur croie à un oubli plutôt qu'à un choix.
     */
    for (const canal of DORMANT_CHANNELS) {
      const dormant: DormantChannelProvider = new UnconfiguredChannelProvider(canal);
      const refus = await dormant.send({ to: "+213555000000", text: "Rappel" });
      expect(refus.ok).toBe(false);
      if (refus.ok) continue;
      expect(refus.error.details?.["channel"]).toBe(canal);
    }

    await scope.pool.query("delete from public.notification_rules where obligation_type_id = $1", [
      obligation,
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LE CONTRAT DES DEUX FOURNISSEURS
//
// ⚠️ UNE SEULE PROMESSE, ET ELLE EST STRUCTURANTE : `send()` NE LÈVE JAMAIS. Un
// échec d'envoi est un résultat attendu du domaine, pas un bug — et une exception
// qui s'échapperait d'ici interromprait la boucle du diffuseur, donc les envois
// SUIVANTS. Le message d'un destinataire injoignable ferait perdre celui des
// quarante-neuf autres.
//
// Les deux scénarios ci-dessous ne simulent rien : l'un parle à un port
// réellement fermé, l'autre à un service qui répond réellement de travers.
// ════════════════════════════════════════════════════════════════════════════

describe("contrat des fournisseurs", () => {
  const EXPEDITEUR = { sender: "conformia@agroespace.dz" };
  const MESSAGE = {
    to: "contrat@test.dz",
    toName: "Contrôle",
    subject: "Contrôle du contrat",
    html: "<p>Corps</p>",
    text: "Corps",
  };

  it("SMTP : un serveur injoignable rend une erreur, il ne lève pas", async () => {
    const port = Number(new URL(await portFerme()).port);
    const fournisseur = new SmtpProvider(
      { host: "127.0.0.1", port, user: "x", password: "x" },
      EXPEDITEUR,
    );

    const resultat = await fournisseur.send(MESSAGE);

    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.error.code).toBe("EXTERNAL_SERVICE_FAILED");
    // Le fournisseur se NOMME dans le détail : dans un journal, « échec de
    // service externe » sans autre précision oblige à rouvrir le code.
    expect(resultat.error.details?.["service"]).toBe("smtp");
  }, 60_000);

  it("Resend : une réponse inattendue rend une erreur, elle ne lève pas", async () => {
    /*
     * ⚠️ LE CAS QUE LE SDK NE COUVRE PAS LUI-MÊME. Il traduit les pannes réseau
     * et les refus en `error` ; il ne dit rien d'une réponse 200 dont le corps ne
     * porte aucun identifiant. Notre code lisait alors `response.data.id` sur
     * `null` — une exception, dans la boucle d'envoi, qui aurait emporté le lot.
     */
    shim.respondEmpty(MESSAGE.to);
    process.env["RESEND_BASE_URL"] = shim.baseUrl;

    const fournisseur = new ResendProvider("re_test_relais_local", EXPEDITEUR);
    const resultat = await fournisseur.send(MESSAGE);

    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.error.code).toBe("EXTERNAL_SERVICE_FAILED");
    expect(resultat.error.details?.["service"]).toBe("resend");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// QUI NE DOIT PAS RECEVOIR
//
// ⚠️ CES TROIS FILTRES ONT DISPARU SANS BRUIT, et c'est ce qui justifie de les
// éprouver ici. La réécriture de `due_notification_candidates` en 0022 — pour y
// ajouter l'acheminement vers le suppléant — est repartie de la version de 0014
// et en a perdu trois garanties. Une fonction réécrite en entier ne dit pas ce
// qu'elle a cessé de faire ; seul un test le dit. Un seul des trois en avait un.
// 0023 les rétablit ; ce qui suit fait qu'ils ne repartiront plus.
// ════════════════════════════════════════════════════════════════════════════

describe("filtres de destinataire", () => {
  beforeAll(async () => {
    await choisirFournisseur("smtp");
  });

  /** Un dossier à J-7 : seul le RESPONSABLE est visé, sur les deux canaux. */
  async function dossierPourUnResponsable(responsable: string, cle: string): Promise<string> {
    const obligation = await scope.createObligation();
    const interne = echeancePourDecalage(-7);
    return scope.createOccurrence({
      obligationId: obligation,
      periodKey: cle,
      ownerId: responsable,
      internalDueDate: interne,
      legalDueDate: plusDeJours(interne, 7),
    });
  }

  it("une préférence de canal coupée supprime le courriel, PAS la notification", async () => {
    const responsable = await scope.createProfile();
    const dossier = await dossierPourUnResponsable(responsable, "pref-01");

    await scope.pool.query(
      `insert into public.user_notification_preferences (user_id, channel, is_enabled)
       values ($1, 'EMAIL', false)
       on conflict (user_id, channel) do update set is_enabled = false`,
      [responsable],
    );

    await runNotificationJob(scope.admin, NOW);

    /*
     * ⚠️ LE DÉFAUT LE PLUS TRAÎTRE DE CETTE FAMILLE. L'écran de préférences
     * enregistre le choix, l'affiche coché, et le confirme à chaque visite. Si le
     * planificateur ne le lit pas, l'utilisateur croit avoir agi — le système lui
     * donne raison à l'écran — et rien ne change dans sa boîte. Il n'a alors
     * aucune raison de signaler quoi que ce soit : il pense que ça ne marche pas
     * pour lui.
     */
    await settle();
    expect(await messagesTo(await adresse(responsable))).toHaveLength(0);
    expect(await destinatairesInternes(dossier, "EMAIL")).toEqual([]);

    // Couper un canal n'en coupe pas un autre : c'est tout l'intérêt d'une ligne
    // par canal plutôt que d'une notification à deux sorties.
    expect(await destinatairesInternes(dossier, "IN_APP")).toEqual([responsable]);
  });

  it("un compte DÉSACTIVÉ ne reçoit plus rien", async () => {
    const parti = await scope.createProfile();

    /*
     * ⚠️ DÉSACTIVÉ, PAS SUPPRIMÉ : le profil demeure pour la traçabilité — son
     * nom doit rester lisible dans l'audit des années après son départ. Son
     * adresse professionnelle, elle, n'est plus relevée par lui ; au mieux
     * personne ne la lit, au pire son successeur.
     *
     * ⚠️ LA DÉSACTIVATION VIENT AVANT LE DOSSIER, et l'ordre n'est pas un
     * arrangement de test : `enforce_deactivation_requires_handover` REFUSE de
     * fermer un compte auquel des dossiers ouverts restent affectés. La situation
     * éprouvée ici est donc celle qui subsiste malgré cette garde — un dossier
     * créé APRÈS le départ, par la génération automatique, sur une règle
     * d'affectation par défaut que personne n'a mise à jour. C'est précisément le
     * cas où l'alerte partirait vers une boîte que plus personne ne relit.
     */
    await scope.pool.query(
      "update public.profiles set deactivated_at = pg_catalog.now() where id = $1",
      [parti],
    );

    const dossier = await dossierPourUnResponsable(parti, "desactive-01");

    await runNotificationJob(scope.admin, NOW);

    await settle();
    expect(await messagesTo(await adresse(parti))).toHaveLength(0);
    expect(await destinatairesInternes(dossier, "EMAIL")).toEqual([]);
    expect(await destinatairesInternes(dossier, "IN_APP")).toEqual([]);
  });

  it("un profil SANS ADRESSE ne remplit pas la file de courriels impossibles", async () => {
    const sansAdresse = await scope.createProfile();
    const dossier = await dossierPourUnResponsable(sansAdresse, "sans-adresse-01");

    await scope.pool.query("update public.profiles set email = null where id = $1", [sansAdresse]);

    await runNotificationJob(scope.admin, NOW);

    /*
     * ⚠️ UN ENVOI IMPOSSIBLE N'EST PAS UN ENVOI RATÉ. Sans ce filtre la ligne
     * partait en file, échouait, consommait ses trois tentatives, puis déclenchait
     * l'alerte d'échec définitif aux administrateurs — pour une adresse qui
     * n'existe pas. À l'échelle d'un annuaire incomplet, cette alerte devient du
     * bruit, et le jour où un vrai incident la déclenche, personne ne la lit.
     */
    expect(await destinatairesInternes(dossier, "EMAIL")).toEqual([]);

    // L'IN-APP, elle, reste : c'est le canal qui n'a besoin d'aucune adresse.
    expect(await destinatairesInternes(dossier, "IN_APP")).toEqual([sansAdresse]);
  });
});
