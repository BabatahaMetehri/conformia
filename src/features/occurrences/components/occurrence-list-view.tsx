"use client";

import type { SortingState } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Download, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CRITICALITIES, OCCURRENCE_STATUSES } from "@/config/constants";
import {
  exportOccurrencesAction,
  reassignOccurrencesAction,
  rememberFiltersAction,
} from "@/features/occurrences/actions";
import { OccurrencesTable } from "@/features/occurrences/components/occurrences-table";
import type { AssignableProfile, OccurrenceRowView } from "@/features/occurrences/components/types";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Enveloppe interactive de la liste : tri, pagination, sélection, export.
 *
 * ⚠️ Le tri est renvoyé AU SERVEUR par l'URL. Rien n'est réordonné ici : trier
 * les 50 lignes affichées donnerait un ordre faux sur un jeu de 10 000, et
 * l'utilisateur croirait voir les plus urgentes.
 */
export function OccurrenceListView({
  rows,
  nextCursor,
  hasPreviousPage,
  sort,
  direction,
  assignees,
  canAssign,
  canExport,
}: {
  readonly rows: readonly OccurrenceRowView[];
  readonly nextCursor: string | null;
  readonly hasPreviousPage: boolean;
  readonly sort: string;
  readonly direction: "asc" | "desc";
  readonly assignees: readonly AssignableProfile[];
  readonly canAssign: boolean;
  readonly canExport: boolean;
}) {
  const t = useTranslations("occurrences");
  const tCriticality = useTranslations("obligations.criticality");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [assignee, setAssignee] = useState<string>("");
  const [pending, startTransition] = useTransition();

  /*
   * Mémorisation des filtres.
   *
   * ⚠️ PAS au premier rendu, et pas à chaque frappe. Une écriture à chaque
   * changement de paramètre — montage compris — envoie une Server Action de plus
   * en concurrence avec la navigation en cours, sur l'écran le plus consulté de
   * l'application. Mesuré : la navigation de filtre mettait alors plus de quinze
   * secondes à valider son URL sous charge.
   *
   * On enregistre donc APRÈS un silence d'une seconde, et seulement si les
   * filtres ont réellement changé depuis le rendu initial.
   */
  const initialParams = useRef(params.toString());
  const search = params.toString();

  useEffect(() => {
    if (search === initialParams.current) return;

    const timer = setTimeout(() => {
      void rememberFiltersAction(Object.fromEntries(new URLSearchParams(search).entries()));
    }, 1000);

    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  // Une nouvelle page invalide la sélection : réaffecter des lignes qu'on ne
  // voit plus serait une action à l'aveugle.
  useEffect(() => {
    setSelection(new Set());
  }, [search]);

  function navigate(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    startTransition(() => {
      router.replace({ pathname, query: Object.fromEntries(next.entries()) });
    });
  }

  const sorting: SortingState = [{ id: sort, desc: direction === "desc" }];

  function onSortingChange(next: SortingState): void {
    const first = next[0];
    if (first === undefined) return;
    navigate({ sort: first.id, direction: first.desc ? "desc" : "asc", cursor: null });
  }

  const selected = [...selection];

  return (
    <div className="space-y-3">
      {canAssign || canExport ? (
        <div className="flex flex-wrap items-center gap-2">
          {canAssign ? (
            <>
              <span className="text-sm text-text-secondary" aria-live="polite">
                {t("selectedCount", { count: selected.length })}
              </span>

              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="w-56" aria-label={t("reassignTo")}>
                  <SelectValue placeholder={t("reassignTo")} />
                </SelectTrigger>
                <SelectContent>
                  {assignees.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                size="sm"
                disabled={pending || selected.length === 0 || assignee === ""}
                onClick={() => {
                  startTransition(async () => {
                    const outcome = await reassignOccurrencesAction({
                      occurrenceIds: selected,
                      ownerId: assignee,
                    });
                    if (outcome.status === "success") {
                      toast.success(t("reassigned", { count: outcome.data.updated }));
                      setSelection(new Set());
                      router.refresh();
                    } else {
                      toast.error(t(`errors.${outcome.error.code}`));
                    }
                  });
                }}
              >
                <UserCog aria-hidden="true" className="size-4" />
                {t("reassign")}
              </Button>
            </>
          ) : null}

          {canExport ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ms-auto"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  await runExport(params, t, tCriticality);
                });
              }}
            >
              <Download aria-hidden="true" className="size-4" />
              {t("export")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <OccurrencesTable
        rows={rows}
        sorting={sorting}
        onSortingChange={onSortingChange}
        selection={selection}
        onSelectionChange={setSelection}
        canAssign={canAssign}
      />

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasPreviousPage || pending}
          onClick={() => {
            // Retour arrière : on retire le curseur. La pagination par curseur
            // n'est pas bidirectionnelle — revenir en arrière, c'est repartir du
            // début, ce qui reste juste et évite d'empiler un historique.
            navigate({ cursor: null });
          }}
        >
          <ChevronLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          {t("firstPage")}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={nextCursor === null || pending}
          onClick={() => {
            if (nextCursor !== null) navigate({ cursor: nextCursor });
          }}
        >
          {t("nextPage")}
          <ChevronRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Déclenche l'export et remet le fichier à l'utilisateur.
 *
 * Le classeur arrive en base64 : une Server Action ne transporte pas d'octets
 * bruts. On le reconstitue en `Blob` côté navigateur — jamais d'URL publique
 * vers un export, qui contiendrait des données de dossiers.
 */
async function runExport(
  params: URLSearchParams,
  t: ReturnType<typeof useTranslations<"occurrences">>,
  tCriticality: ReturnType<typeof useTranslations<"obligations.criticality">>,
): Promise<void> {
  const labels = {
    sheetName: t("title"),
    obligation: t("obligation"),
    code: t("code"),
    period: t("period"),
    internalDue: t("internalDueDate"),
    legalDue: t("legalDueDate"),
    status: t("statusColumn"),
    owner: t("owner"),
    validator: t("validator"),
    documents: t("documents"),
    overdue: t("due.overdue"),
    domain: t("domain"),
    authority: t("authority"),
    criticality: t("criticalityColumn"),
    yes: t("yes"),
    no: t("no"),
    statuses: Object.fromEntries(OCCURRENCE_STATUSES.map((s) => [s, t(`status.${s}`)])),
    criticalities: Object.fromEntries(CRITICALITIES.map((c) => [c, tCriticality(c)])),
  };

  const outcome = await exportOccurrencesAction(Object.fromEntries(params.entries()), labels);

  if (outcome.status === "error") {
    toast.error(t(`errors.${outcome.error.code}`));
    return;
  }

  const binary = atob(outcome.data.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = outcome.data.filename;
  anchor.click();
  // Sans révocation, le blob reste en mémoire jusqu'au rechargement de l'onglet.
  URL.revokeObjectURL(url);

  toast.success(
    outcome.data.truncated
      ? t("exportTruncated", { count: outcome.data.rowCount })
      : t("exported", { count: outcome.data.rowCount }),
  );
}
