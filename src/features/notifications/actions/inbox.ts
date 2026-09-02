"use server";

/**
 * Server Actions du centre de notifications.
 *
 * ⚠️ Aucune de ces actions ne vérifie à qui appartient un message. Ce n'est pas
 * un oubli : la politique RLS de `notifications` borne toute lecture et toute
 * écriture au destinataire, et le trigger d'immuabilité interdit de toucher au
 * contenu comme à l'état de livraison. Marquer lu le message d'un tiers ne
 * touche donc zéro ligne — pas parce qu'on l'a testé ici, mais parce que la base
 * ne le permet pas.
 *
 * ⚠️ AUCUN ENVOI SYNCHRONE. Rien ici ne déclenche un courriel : la file est
 * remplie par le planificateur et vidée par le diffuseur. Un envoi depuis une
 * action ferait attendre l'utilisateur sur un service tiers, et ferait échouer
 * son geste quand ce service, lui, échoue.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toClientError, AppError } from "@/lib/errors";
import { requireAuthContext } from "@/services/auth/context";
import {
  hide,
  loadPage,
  loadPanel,
  ownCalendarFeed,
  preferencesWithDefaults,
  readAll,
  readOne,
  rotateCalendarFeed,
  unreadCount,
  updatePreference,
} from "@/services/notifications/inbox";
import { NOTIFICATION_CHANNELS } from "@/config/constants";
import type {
  CalendarFeedOutcome,
  CountOutcome,
  InboxOutcome,
  PlainOutcome,
  PreferencesOutcome,
} from "./types";

const NOTIFICATIONS_PATH = "/notifications";

/** Les identifiants viennent du client : ils sont validés, jamais crus. */
const idSchema = z.coerce.number().int().positive();

const preferenceSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS as [string, ...string[]]),
  isEnabled: z.boolean(),
  digestFrequency: z.enum(["NONE", "DAILY", "WEEKLY"]),
});

export async function loadPanelAction(): Promise<InboxOutcome> {
  const result = await loadPanel();
  return result.ok
    ? { status: "success", data: result.value }
    : { status: "error", error: toClientError(result.error) };
}

export async function loadPageAction(includeRead: boolean): Promise<InboxOutcome> {
  const result = await loadPage(includeRead);
  return result.ok
    ? { status: "success", data: result.value }
    : { status: "error", error: toClientError(result.error) };
}

/**
 * Compteur de non-lues.
 *
 * ⚠️ Une lecture ratée rend une ERREUR, pas zéro. La cloche distingue les deux :
 * elle n'affiche aucun badge tant qu'elle ne sait pas, plutôt qu'un « 0 » qui
 * affirmerait qu'il n'y a rien à lire.
 */
export async function unreadCountAction(): Promise<CountOutcome> {
  const count = await unreadCount();
  return count === null
    ? { status: "error", error: toClientError(AppError.internal()) }
    : { status: "success", data: count };
}

export async function markReadAction(id: number): Promise<PlainOutcome> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return {
      status: "error",
      error: toClientError(AppError.validationFailed({ field: "id" })),
    };
  }

  const result = await readOne(parsed.data);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(NOTIFICATIONS_PATH);
  return { status: "success", data: true };
}

export async function markAllReadAction(): Promise<PlainOutcome> {
  const result = await readAll();
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(NOTIFICATIONS_PATH);
  return { status: "success", data: true };
}

export async function dismissAction(id: number): Promise<PlainOutcome> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return {
      status: "error",
      error: toClientError(AppError.validationFailed({ field: "id" })),
    };
  }

  const result = await hide(parsed.data);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(NOTIFICATIONS_PATH);
  return { status: "success", data: true };
}

export async function loadPreferencesAction(): Promise<PreferencesOutcome> {
  const result = await preferencesWithDefaults();
  return result.ok
    ? { status: "success", data: result.value }
    : { status: "error", error: toClientError(result.error) };
}

export async function savePreferenceAction(input: unknown): Promise<PreferencesOutcome> {
  const parsed = preferenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: toClientError(AppError.validationFailed({ field: "preference" })),
    };
  }

  const context = await requireAuthContext();
  if (!context.ok) return { status: "error", error: toClientError(context.error) };

  /*
   * ⚠️ L'identifiant vient de la SESSION, jamais du formulaire. Le laisser
   * arriver du client permettrait de couper les alertes d'un collègue — la
   * politique RLS l'interdirait, mais un contrôle qui repose entièrement sur le
   * dernier rempart est un contrôle qu'on finit par contourner sans le savoir.
   */
  const saved = await updatePreference(context.value.userId, {
    channel: parsed.data.channel as (typeof NOTIFICATION_CHANNELS)[number],
    isEnabled: parsed.data.isEnabled,
    digestFrequency: parsed.data.digestFrequency,
  });

  if (!saved.ok) return { status: "error", error: toClientError(saved.error) };

  const refreshed = await preferencesWithDefaults();
  return refreshed.ok
    ? { status: "success", data: refreshed.value }
    : { status: "error", error: toClientError(refreshed.error) };
}

export async function calendarFeedAction(): Promise<CalendarFeedOutcome> {
  const result = await ownCalendarFeed();
  return result.ok
    ? { status: "success", data: result.value }
    : { status: "error", error: toClientError(result.error) };
}

/**
 * Rotation du jeton de flux.
 *
 * ⚠️ IRRÉVERSIBLE ET IMMÉDIATE : l'ancienne adresse cesse de fonctionner à
 * l'instant, et tout agenda déjà abonné se tait. L'écran le dit avant, pas
 * après — c'est le genre d'action dont on découvre l'effet une semaine plus
 * tard, quand une échéance n'est pas apparue.
 */
export async function regenerateCalendarTokenAction(): Promise<CalendarFeedOutcome> {
  const result = await rotateCalendarFeed();
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath("/profile/calendar");
  return { status: "success", data: result.value };
}
