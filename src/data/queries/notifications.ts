import "server-only";

/**
 * Accès aux notifications.
 *
 * Deux publics, deux régimes, dans un seul fichier parce qu'ils lisent la même
 * table :
 *
 *  • les lectures de l'UTILISATEUR (sa cloche, son panneau, ses préférences)
 *    passent par le client de session et sont bornées par la RLS — chacun ne
 *    voit que son propre courrier, sans exception, pas même pour l'audit ;
 *  • les écritures du PLANIFICATEUR passent par un client injecté et des
 *    fonctions SECURITY DEFINER. La table refuse l'INSERT à tout le monde, y
 *    compris au rôle de service : produire une notification est un acte du
 *    système, jamais d'une session.
 *
 * Comme `generation.ts`, les fonctions de planification prennent leur client en
 * paramètre : la tâche est joignable par une route de secours, où la clé de
 * service ne peut pas être chargée (CLAUDE.md §6).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseAnonClient, createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type NotificationClient = SupabaseClient<Database>;

type ChannelValue = Database["public"]["Enums"]["notification_channel"];

// ─── Planification ───────────────────────────────────────────────────────────

/** Une alerte à produire pour un destinataire, telle que la base la voit. */
export interface NotificationCandidate {
  readonly occurrenceId: string;
  readonly ruleId: string | null;
  readonly escalationPolicyId: string | null;
  readonly recipientId: string;
  readonly channel: ChannelValue;
  readonly kind: string;
  readonly templateKey: string;
  readonly offsetDays: number;
  readonly obligationCode: string;
  readonly obligationName: string;
  readonly authorityName: string | null;
  readonly criticality: Database["public"]["Enums"]["criticality"];
  readonly periodKey: string;
  readonly internalDueDate: string;
  readonly legalDueDate: string;
  readonly status: Database["public"]["Enums"]["occurrence_status"];
  readonly recipientEmail: string | null;
  readonly recipientName: string | null;
  readonly ownerName: string | null;
  /**
   * Nom de la personne INITIALEMENT visée, quand le courriel a été dérouté vers
   * son suppléant parce qu'elle est absente. `null` dans tous les autres cas.
   *
   * ⚠️ C'est ce champ qui déclenche le gabarit `AbsenceRouting` plutôt que
   * l'alerte ordinaire. Sans lui, le suppléant recevrait une alerte sur un
   * dossier dont il n'est pas responsable, sans comprendre pourquoi.
   */
  readonly absentRecipientName: string | null;
}

/**
 * Ce qui doit être notifié aujourd'hui, heure d'Alger.
 *
 * En lecture seule et rejouable : appeler cette fonction n'engage rien. C'est
 * `enqueueNotification` qui écrit, et c'est la contrainte d'unicité — pas cette
 * requête — qui garantit qu'un même jalon ne part qu'une fois.
 */
export async function listDueCandidates(
  client: NotificationClient,
  now: Date,
): Promise<Result<readonly NotificationCandidate[]>> {
  const { data, error } = await client.rpc("due_notification_candidates", {
    p_now: now.toISOString(),
  });

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      occurrenceId: row.occurrence_id,
      ruleId: row.rule_id,
      escalationPolicyId: row.escalation_policy_id,
      recipientId: row.recipient_id,
      channel: row.channel,
      kind: row.kind,
      templateKey: row.template_key,
      offsetDays: row.offset_days,
      obligationCode: row.obligation_code,
      obligationName: row.obligation_name,
      authorityName: row.authority_name,
      criticality: row.criticality,
      periodKey: row.period_key,
      internalDueDate: row.internal_due_date,
      legalDueDate: row.legal_due_date,
      status: row.status,
      recipientEmail: row.recipient_email,
      recipientName: row.recipient_name,
      ownerName: row.owner_name,
      /*
       * ⚠️ LE TYPE GÉNÉRÉ MENT ICI, ET LE MODÈLE DIT VRAI. `supabase gen types`
       * déclare les colonnes d'un `returns table` non nullables, faute de pouvoir
       * les analyser ; celle-ci vaut NULL dans le cas ordinaire — aucun
       * déroutement. `NotificationCandidate` la déclare donc `string | null`, et
       * c'est cette déclaration qui gouverne : le planificateur compare bien à
       * `null` pour choisir le gabarit.
       */
      absentRecipientName: row.absent_recipient_name,
    })),
  );
}

export interface EnqueueInput {
  readonly occurrenceId: string | null;
  readonly ruleId: string | null;
  readonly escalationPolicyId: string | null;
  readonly recipientId: string;
  readonly channel: ChannelValue;
  readonly kind: string;
  readonly subject: string;
  readonly bodyHtml: string | null;
  readonly bodyText: string;
  readonly scheduledFor: Date;
}

/**
 * Insère une notification, ou constate qu'elle existait déjà.
 *
 * ⚠️ `null` N'EST PAS UNE ERREUR : c'est « déjà notifié ». Traiter le doublon
 * comme un échec ferait passer une exécution parfaitement idempotente pour un
 * incident, et le rapport de la tâche deviendrait illisible dès le second cycle.
 */
export async function enqueueNotification(
  client: NotificationClient,
  input: EnqueueInput,
): Promise<Result<number | null>> {
  const { data, error } = await client.rpc("enqueue_notification", {
    p_recipient: input.recipientId,
    p_channel: input.channel,
    p_kind: input.kind,
    p_subject: input.subject,
    p_body_text: input.bodyText,
    p_scheduled_for: input.scheduledFor.toISOString(),
    /*
     * ⚠️ Les paramètres facultatifs sont OMIS, pas passés à `undefined`.
     *
     * Ils portent un défaut en SQL, si bien que le générateur de types les rend
     * optionnels ; et `exactOptionalPropertyTypes` refuse qu'une propriété
     * optionnelle reçoive explicitement `undefined`. Les omettre est d'ailleurs
     * plus juste : PostgreSQL applique alors son défaut, qui est NULL — c'est
     * exactement ce qu'on veut dire, et le seul cas où l'absence porte du sens.
     */
    ...(input.occurrenceId === null ? {} : { p_occurrence: input.occurrenceId }),
    ...(input.ruleId === null ? {} : { p_rule: input.ruleId }),
    ...(input.escalationPolicyId === null ? {} : { p_escalation: input.escalationPolicyId }),
    ...(input.bodyHtml === null ? {} : { p_body_html: input.bodyHtml }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

// ─── Diffusion ───────────────────────────────────────────────────────────────

export interface PendingEmail {
  readonly id: number;
  readonly recipientId: string;
  readonly recipientEmail: string;
  readonly recipientName: string | null;
  readonly subject: string;
  readonly bodyHtml: string | null;
  readonly bodyText: string;
  readonly scheduledFor: string;
  readonly retryCount: number;
}

/** File d'envoi, ordonnée pour que les messages à fusionner soient contigus. */
export async function listPendingEmails(
  client: NotificationClient,
  now: Date,
  limit: number,
  maxAttempts: number,
): Promise<Result<readonly PendingEmail[]>> {
  const { data, error } = await client.rpc("pending_email_notifications", {
    p_now: now.toISOString(),
    p_limit: limit,
    p_max_attempts: maxAttempts,
  });

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      recipientId: row.recipient_id,
      recipientEmail: row.recipient_email,
      recipientName: row.recipient_name,
      subject: row.subject,
      bodyHtml: row.body_html,
      bodyText: row.body_text,
      scheduledFor: row.scheduled_for,
      retryCount: row.retry_count,
    })),
  );
}

export async function markSent(
  client: NotificationClient,
  ids: readonly number[],
): Promise<Result<number>> {
  if (ids.length === 0) return ok(0);
  const { data, error } = await client.rpc("mark_notifications_sent", { p_ids: [...ids] });
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export async function markFailed(
  client: NotificationClient,
  ids: readonly number[],
  reason: string,
): Promise<Result<number>> {
  if (ids.length === 0) return ok(0);
  const { data, error } = await client.rpc("mark_notifications_failed", {
    p_ids: [...ids],
    p_error: reason,
  });
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

/** Prévient les administrateurs des échecs définitifs. Canal in-app seulement. */
export async function notifyAdminsOfFailures(
  client: NotificationClient,
  maxAttempts: number,
): Promise<Result<number>> {
  const { data, error } = await client.rpc("notify_admins_of_delivery_failures", {
    p_max_attempts: maxAttempts,
  });
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

/**
 * Alerte « aucune sauvegarde réussie depuis N heures ».
 *
 * ⚠️ Appelée à CHAQUE cycle horaire, et non par une tâche dédiée. Une alerte de
 * sauvegarde portée par son propre planificateur dépendrait d'un dispositif dont
 * personne ne surveille la santé — et se tairait exactement quand elle devrait
 * parler.
 */
export async function notifyStaleBackup(
  client: NotificationClient,
  hours: number,
): Promise<Result<number>> {
  const { data, error } = await client.rpc("notify_admins_of_stale_backup", { p_hours: hours });
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

// ─── Réglages d'installation ─────────────────────────────────────────────────

export interface NotificationSettings {
  readonly emailProvider: "resend" | "smtp";
  readonly sender: string;
  readonly weeklyDigestDay: number;
  readonly weeklyDigestHour: number;
}

/**
 * Réglages de notification, lus dans les LIGNES clé/valeur.
 *
 * ⚠️ PAS DANS DES COLONNES, ET C'EST UNE CORRECTION. `app_settings` a porté un
 * temps quatre colonnes doublant ces mêmes réglages. L'écran Administration →
 * Réglages écrivait la ligne, cette fonction lisait la colonne : changer le
 * fournisseur depuis l'administration ne produisait aucun effet — pas une
 * erreur, pas un refus, juste un réglage qui s'enregistre et ne change rien.
 *
 * Pire, les colonnes étaient portées par CHAQUE ligne de la table et la lecture
 * se faisait sans tri : elle prenait une copie quelconque. La migration 0026 a
 * supprimé les colonnes ; il ne reste qu'une vérité.
 */
export async function loadNotificationSettings(
  client: NotificationClient,
): Promise<Result<NotificationSettings>> {
  const { data, error } = await client
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "email_provider",
      "notification_sender",
      "weekly_digest_day",
      "weekly_digest_hour",
    ]);

  if (error !== null) return err(mapPostgrestError(error));

  const byKey = new Map(data.map((row) => [row.key, row.value]));

  /*
   * Les défauts ne sont PAS des valeurs de confort : ils ne servent que si la
   * ligne manque, ce que la migration 0026 rend impossible et que son contrôle
   * final vérifie. Les écrire ici évite seulement qu'une base à moitié migrée
   * fasse tomber le lot entier de notifications.
   */
  const asText = (key: string, fallback: string): string => {
    const raw = byKey.get(key);
    return typeof raw === "string" && raw.length > 0 ? raw : fallback;
  };
  const asNumber = (key: string, fallback: number): number => {
    const raw = byKey.get(key);
    return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  };

  const provider = asText("email_provider", "resend");

  return ok({
    // Le déclencheur `app_settings_validate` borne la valeur en base ; ce test
    // protège le cas d'une base antérieure à 0026, où rien ne la bornait.
    emailProvider: provider === "smtp" ? "smtp" : "resend",
    sender: asText("notification_sender", "conformia@agroespace.dz"),
    weeklyDigestDay: asNumber("weekly_digest_day", 1),
    weeklyDigestHour: asNumber("weekly_digest_hour", 7),
  });
}

// ─── Lectures de l'utilisateur ───────────────────────────────────────────────

export interface InboxItem {
  readonly id: number;
  readonly kind: string;
  readonly channel: ChannelValue;
  readonly subject: string | null;
  readonly bodyText: string | null;
  readonly reason: string | null;
  readonly occurrenceId: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly dismissedAt: string | null;
}

const INBOX_COLUMNS =
  "id, kind, channel, subject, body_text, reason, occurrence_id, created_at, read_at, dismissed_at";

/**
 * Le courrier de l'utilisateur courant.
 *
 * ⚠️ Canal IN_APP uniquement. Les lignes EMAIL sont la file d'envoi, pas des
 * messages à lire : les afficher montrerait chaque alerte en double, une fois
 * comme courriel et une fois comme notification.
 */
export async function listInbox(
  limit: number,
  includeRead: boolean,
): Promise<Result<readonly InboxItem[]>> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("notifications")
    .select(INBOX_COLUMNS)
    .eq("channel", "IN_APP")
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeRead) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      kind: row.kind,
      channel: row.channel,
      subject: row.subject,
      bodyText: row.body_text,
      reason: row.reason,
      occurrenceId: row.occurrence_id,
      createdAt: row.created_at,
      readAt: row.read_at,
      dismissedAt: row.dismissed_at,
    })),
  );
}

/**
 * Compteur de la cloche.
 *
 * ⚠️ Rend `null` en cas d'échec, jamais 0. Afficher « 0 » sur une lecture ratée
 * affirmerait qu'il n'y a rien à lire, ce que l'échec ne permet pas de savoir —
 * c'est la promesse que porte déjà le composant depuis sa première version.
 */
export async function countUnread(): Promise<number | null> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("channel", "IN_APP")
    .is("read_at", null)
    .is("dismissed_at", null);

  if (error !== null) return null;
  return count ?? null;
}

export async function markRead(ids: readonly number[]): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", [...ids])
    .is("read_at", null)
    .select("id");

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.length);
}

export async function markAllRead(): Promise<Result<number>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("channel", "IN_APP")
    .is("read_at", null)
    .select("id");

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.length);
}

export async function dismiss(id: number): Promise<Result<void>> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(undefined);
}

// ─── Préférences ─────────────────────────────────────────────────────────────

export interface ChannelPreference {
  readonly channel: ChannelValue;
  readonly isEnabled: boolean;
  readonly digestFrequency: Database["public"]["Enums"]["digest_frequency"];
}

export async function loadPreferences(): Promise<Result<readonly ChannelPreference[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_notification_preferences")
    .select("channel, is_enabled, digest_frequency");

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      channel: row.channel,
      isEnabled: row.is_enabled,
      digestFrequency: row.digest_frequency,
    })),
  );
}

export async function savePreference(
  userId: string,
  preference: ChannelPreference,
): Promise<Result<void>> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("user_notification_preferences").upsert(
    {
      user_id: userId,
      channel: preference.channel,
      is_enabled: preference.isEnabled,
      digest_frequency: preference.digestFrequency,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,channel" },
  );

  if (error !== null) return err(mapPostgrestError(error));
  return ok(undefined);
}

// ─── Flux calendrier ─────────────────────────────────────────────────────────

export interface CalendarEntry {
  readonly occurrenceId: string;
  readonly obligationCode: string;
  readonly obligationName: string;
  readonly authorityName: string | null;
  readonly periodKey: string;
  readonly internalDueDate: string;
  readonly legalDueDate: string;
  readonly status: Database["public"]["Enums"]["occurrence_status"];
  readonly criticality: Database["public"]["Enums"]["criticality"];
  readonly updatedAt: string;
}

/**
 * Occurrences visibles par le porteur du jeton.
 *
 * ⚠️ Appelée SANS session : la route du flux est authentifiée par le jeton seul.
 * Le cloisonnement est donc réappliqué dans la fonction SQL, pour ce profil.
 */
export async function loadCalendarFeed(
  token: string,
  months: number,
): Promise<Result<readonly CalendarEntry[]>> {
  /*
   * ⚠️ Client ANONYME, sans cookie. La route du flux est appelée par un agenda,
   * qui n'en présente aucun : demander les cookies de la requête lèverait hors
   * contexte de requête, et n'apporterait rien — `calendar_feed` ne consulte pas
   * `auth.uid()`. C'est le jeton qui désigne le porteur, et la fonction SQL qui
   * réapplique son cloisonnement. Employer ici la clé de service donnerait au
   * flux le droit de tout lire, en s'en remettant à un argument pour ne pas le
   * faire.
   */
  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase.rpc("calendar_feed", {
    p_token: token,
    p_months: months,
  });

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      occurrenceId: row.occurrence_id,
      obligationCode: row.obligation_code,
      obligationName: row.obligation_name,
      authorityName: row.authority_name,
      periodKey: row.period_key,
      internalDueDate: row.internal_due_date,
      legalDueDate: row.legal_due_date,
      status: row.status,
      criticality: row.criticality,
      updatedAt: row.updated_at,
    })),
  );
}

export interface OwnCalendarToken {
  readonly token: string;
  readonly rotatedAt: string | null;
}

/**
 * Le jeton de l'utilisateur courant.
 *
 * Lu par la RLS — « le mien, et rien d'autre ». La fonction SECURITY DEFINER ne
 * sert que de FILET : un profil créé avant cette migration, ou par un chemin qui
 * aurait esquivé le trigger, n'a pas de ligne. Mieux vaut la créer à la volée
 * qu'afficher un écran vide sans expliquer pourquoi.
 */
export async function loadOwnIcsToken(): Promise<Result<OwnCalendarToken>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("calendar_feed_tokens")
    .select("token, rotated_at")
    .maybeSingle();

  if (error !== null) return err(mapPostgrestError(error));
  if (data !== null) return ok({ token: data.token, rotatedAt: data.rotated_at });

  const created = await supabase.rpc("own_ics_token");
  if (created.error !== null) return err(mapPostgrestError(created.error));
  return ok({ token: created.data, rotatedAt: null });
}

export async function regenerateIcsToken(): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("regenerate_ics_token");
  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}
