"use client";

import {
  ArrowRight,
  FileUp,
  PenLine,
  ShieldCheck,
  UserRound,
  UserRoundCog,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTimeFr } from "@/lib/dates";
import type { OccurrenceDetailView, TimelineEntry } from "@/services/occurrences/detail";

/**
 * Onglet « Historique » : transitions, dépôts et actions d'audit, fusionnés.
 *
 * ⚠️ CHAQUE LIGNE DIT À QUEL TITRE SON AUTEUR A AGI. « Validé par Amine » ne
 * suffit pas : la même personne peut être responsable d'un dossier, suppléante
 * d'un autre et superviseure d'un troisième, et la séparation des pouvoirs se
 * juge sur la QUALITÉ, pas sur le nom. La valeur vient de
 * `occurrence_transitions.acted_as`, résolue en base par `resolve_acted_as()` —
 * jamais recalculée ici, sans quoi deux règles finiraient par se contredire.
 *
 * ⚠️ Les actions DÉLÉGUÉES affichent les DEUX identités : celle qui a agi et
 * celle au nom de qui elle a agi. Une délégation n'efface pas l'auteur.
 *
 * ⚠️ LA QUALITÉ NE REPOSE PAS SUR LA SEULE COULEUR : chaque qualité porte une
 * icône ET une mention textuelle. Un daltonien, une impression en noir et
 * blanc, un écran mal réglé — trois façons ordinaires de perdre l'information
 * si elle n'existe que dans la teinte.
 */

const ALL = "__all__";

/** Qualités connues, dans l'ordre de la triade. */
const QUALITIES = ["RESPONSABLE", "SUPPLEANT", "SUPERVISEUR", "DIRECTION"] as const;

export function OccurrenceTimeline({ detail }: { readonly detail: OccurrenceDetailView }) {
  const t = useTranslations("occurrences.detail");
  const tQuality = useTranslations("occurrences.actedAs");

  const [actor, setActor] = useState(ALL);
  const [quality, setQuality] = useState(ALL);

  /*
   * Les intervenants proposés sont ceux qui figurent RÉELLEMENT dans cette
   * chronologie. Proposer l'annuaire entier offrirait des filtres qui ne
   * rendent jamais rien, et ferait douter du filtre plutôt que des données.
   */
  const actors = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of detail.timeline) {
      if (entry.actorName !== null && entry.actorName !== "") seen.add(entry.actorName);
    }
    return [...seen].sort((left, right) => left.localeCompare(right, "fr"));
  }, [detail.timeline]);

  const qualities = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of detail.timeline) {
      if (entry.actedAs !== null) seen.add(entry.actedAs);
    }
    return QUALITIES.filter((value) => seen.has(value));
  }, [detail.timeline]);

  const entries = useMemo(
    () =>
      detail.timeline.filter(
        (entry) =>
          (actor === ALL || entry.actorName === actor) &&
          (quality === ALL || entry.actedAs === quality),
      ),
    [detail.timeline, actor, quality],
  );

  if (detail.timeline.length === 0) {
    return <EmptyState title={t("noHistory")} />;
  }

  return (
    <div className="space-y-4">
      {actors.length > 1 || qualities.length > 1 ? (
        <div className="flex flex-wrap gap-4">
          <div className="min-w-48">
            <Label htmlFor="timeline-actor">{t("filterActor")}</Label>
            <Select value={actor} onValueChange={setActor}>
              <SelectTrigger id="timeline-actor" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filterAll")}</SelectItem>
                {actors.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {qualities.length > 0 ? (
            <div className="min-w-48">
              <Label htmlFor="timeline-quality">{t("filterQuality")}</Label>
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger id="timeline-quality" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("filterAll")}</SelectItem>
                  {qualities.map((value) => (
                    <SelectItem key={value} value={value}>
                      {tQuality(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState title={t("noHistoryForFilter")} />
      ) : (
        <ol className="space-y-1">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-3 border-s border-border ps-4 pb-3 last:pb-0">
              <span className="mt-0.5 shrink-0 text-text-muted">
                <EntryIcon entry={entry} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
                  <TimelineLabel entry={entry} />
                </p>

                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-muted">
                  <span>
                    {entry.onBehalfOfName === null
                      ? (entry.actorName ?? t("systemActor"))
                      : t("onBehalfOf", {
                          actor: entry.actorName ?? t("systemActor"),
                          delegator: entry.onBehalfOfName,
                        })}
                  </span>
                  <QualityTag actedAs={entry.actedAs} />
                  <span>· {formatDateTimeFr(new Date(entry.occurredAt))}</span>
                </p>

                {entry.reason === null ? null : (
                  <p className="mt-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary">
                    {entry.reason}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * La qualité, en icône ET en mots.
 *
 * ⚠️ Rendue depuis `acted_as`, jamais depuis le rôle courant de la personne. Un
 * responsable devenu superviseur n'a pas rétroactivement validé en tant que
 * superviseur : la trace dit ce qui s'est passé, pas ce qui serait vrai
 * aujourd'hui.
 */
function QualityTag({ actedAs }: { readonly actedAs: string | null }) {
  const t = useTranslations("occurrences.actedAs");
  if (actedAs === null) return null;

  const Icon =
    actedAs === "SUPPLEANT" ? Users : actedAs === "RESPONSABLE" ? UserRound : ShieldCheck;

  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-2xs text-text-secondary">
      <Icon aria-hidden="true" className="size-3" />
      {/*
       * On traduit, on n'affiche jamais la valeur brute : un `SUPPLEANT` en
       * capitales est une fuite du modèle de données vers l'utilisateur.
       */}
      {t(actedAs)}
    </span>
  );
}

function EntryIcon({ entry }: { readonly entry: TimelineEntry }) {
  if (entry.kind === "DOCUMENT") return <FileUp aria-hidden="true" className="size-4" />;
  if (entry.kind === "AUDIT") return <UserRoundCog aria-hidden="true" className="size-4" />;
  return <PenLine aria-hidden="true" className="size-4" />;
}

function TimelineLabel({ entry }: { readonly entry: TimelineEntry }) {
  const t = useTranslations("occurrences.detail");

  if (entry.kind === "TRANSITION") {
    return (
      <>
        {entry.fromStatus === null ? (
          <span>{t("created")}</span>
        ) : (
          <>
            <StatusBadge status={entry.fromStatus} />
            <ArrowRight aria-hidden="true" className="size-3.5 text-text-muted" />
          </>
        )}
        {entry.toStatus === null ? null : <StatusBadge status={entry.toStatus} />}
      </>
    );
  }

  if (entry.kind === "DOCUMENT") {
    return <span>{t("depositedPiece", { name: entry.detail ?? "" })}</span>;
  }

  return (
    <span>
      {t("auditChange", {
        fields:
          entry.changedFields.length === 0 ? t("auditNoFields") : entry.changedFields.join(", "),
      })}
    </span>
  );
}
