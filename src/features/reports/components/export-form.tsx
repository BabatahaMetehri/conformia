"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  exportReportAction,
  exportRegisterReportAction,
  exportTabularAction,
  planPeriodExportAction,
} from "@/features/reports/actions/exports";
import type { DownloadPayload } from "@/features/reports/actions/types";
import { useActionRunner } from "@/hooks/use-action-runner";

/**
 * Formulaire d'export.
 *
 * ⚠️ Le téléchargement se déclenche depuis le NAVIGATEUR, à partir des octets
 * rendus par l'action. C'est ce qui permet à l'action de rester une action —
 * elle produit une valeur — plutôt qu'une réponse HTTP dont il faudrait gérer
 * les en-têtes à la main.
 *
 * ⚠️ Le dossier ZIP, lui, passe par un LIEN vers un gestionnaire de route : une
 * archive de plusieurs dizaines de mégaoctets ne doit pas transiter en base64
 * dans une réponse d'action.
 */

type ExportType =
  "OCCURRENCES" | "COMPLIANCE" | "WORKLOAD" | "LATE_REASONS" | "REGISTERS" | "REPORT" | "PERIOD";

/**
 * Genres qui offrent un choix de FORMAT (CSV ou classeur).
 *
 * ⚠️ `REGISTERS` en fait partie bien qu'il ne prenne pas les filtres de l'écran :
 * les deux notions sont indépendantes. Le format est une question de fichier, le
 * périmètre une question de mesure.
 */
const TABULAR: ReadonlySet<string> = new Set([
  "OCCURRENCES",
  "COMPLIANCE",
  "WORKLOAD",
  "LATE_REASONS",
  "REGISTERS",
]);

/** Déclenche l'enregistrement d'un fichier reçu en base64. */
function saveFile(payload: DownloadPayload): void {
  const binary = atob(payload.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  const url = URL.createObjectURL(new Blob([bytes], { type: payload.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.fileName;
  link.click();
  // Libéré au tour suivant : révoquer immédiatement annule le téléchargement
  // sur certains navigateurs.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export function ExportForm({
  domains,
  authorities,
  onProduced,
}: {
  readonly domains: readonly { readonly id: string; readonly label: string }[];
  readonly authorities: readonly { readonly id: string; readonly name: string }[];
  readonly onProduced: () => void;
}) {
  const t = useTranslations();
  const groupId = useId();
  const [type, setType] = useState<ExportType>("OCCURRENCES");
  const [format, setFormat] = useState<"XLSX" | "CSV">("XLSX");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [domainId, setDomainId] = useState("ALL");
  const [authorityId, setAuthorityId] = useState("ALL");
  const [pending, run] = useActionRunner();

  const filters = {
    ...(from.length === 0 ? {} : { from }),
    ...(to.length === 0 ? {} : { to }),
    ...(domainId === "ALL" ? {} : { domainId }),
    ...(authorityId === "ALL" ? {} : { authorityId }),
  };

  const submit = () => {
    /*
     * ⚠️ LA FONCTION ANONYME AUTO-APPELÉE A DISPARU. `startTransition(() => {
     * void (async () => { ... })(); })` refermait la transition sur place :
     * l'export partait, le drapeau d'attente retombait, et le bouton
     * « Générer » redevenait cliquable pendant la production du fichier.
     */
    run(async () => {
      if (type === "PERIOD") {
        const planned = await planPeriodExportAction(filters);
        if (planned.status === "error") {
          toast.error(t("exports.page.failed"));
          return;
        }
        if (planned.data.mode === "ASYNC") {
          // Au-delà du seuil : on le DIT. Un écran qui laisserait attendre un
          // téléchargement qui ne vient pas serait pire que l'attente.
          toast.info(t("exports.page.asyncQueued"));
        } else {
          toast.success(t("exports.page.generate"));
        }
        onProduced();
        return;
      }

      /*
       * ⚠️ « Situation par registre » NE PREND PAS LES FILTRES DE L'ÉCRAN.
       *
       * C'est un écran de MESURE : le rapport porte sur TOUS les registres
       * visibles, un par ligne, et son taux écarte les obligations valant pour
       * toute l'entreprise. Lui appliquer un filtre de domaine ou de période
       * lui ferait mesurer autre chose que ce qu'il annonce.
       */
      const outcome =
        type === "REGISTERS"
          ? await exportRegisterReportAction({ format })
          : type === "REPORT"
            ? await exportReportAction(filters)
            : await exportTabularAction({ ...filters, kind: type, format });

      if (outcome.status === "error") {
        toast.error(
          outcome.error.details?.["reason"] === "EXPORT_EMPTY"
            ? t("exports.page.empty")
            : t("exports.page.failed"),
        );
        return;
      }

      saveFile(outcome.data);
      onProduced();
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <p className="max-w-prose text-sm text-text-secondary">{t("exports.page.intro")}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${groupId}-type`}>{t("exports.page.type")}</Label>
          <Select
            value={type}
            onValueChange={(value) => {
              setType(value as ExportType);
            }}
          >
            <SelectTrigger id={`${groupId}-type`} aria-label={t("exports.page.type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                [
                  "OCCURRENCES",
                  "COMPLIANCE",
                  "WORKLOAD",
                  "LATE_REASONS",
                  "REGISTERS",
                  "REPORT",
                  "PERIOD",
                ] as const
              ).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`exports.page.kinds.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {TABULAR.has(type) ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${groupId}-format`}>{t("exports.page.format")}</Label>
            <Select
              value={format}
              onValueChange={(value) => {
                setFormat(value as "XLSX" | "CSV");
              }}
            >
              <SelectTrigger id={`${groupId}-format`} aria-label={t("exports.page.format")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="XLSX">XLSX</SelectItem>
                <SelectItem value="CSV">CSV</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${groupId}-from`}>{t("exports.page.from")}</Label>
          <Input
            id={`${groupId}-from`}
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${groupId}-to`}>{t("exports.page.to")}</Label>
          <Input
            id={`${groupId}-to`}
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${groupId}-domain`}>{t("exports.page.domain")}</Label>
          <Select value={domainId} onValueChange={setDomainId}>
            <SelectTrigger id={`${groupId}-domain`} aria-label={t("exports.page.domain")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("exports.page.allDomains")}</SelectItem>
              {domains.map((domain) => (
                <SelectItem key={domain.id} value={domain.id}>
                  {domain.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${groupId}-authority`}>{t("exports.page.authority")}</Label>
          <Select value={authorityId} onValueChange={setAuthorityId}>
            <SelectTrigger id={`${groupId}-authority`} aria-label={t("exports.page.authority")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("exports.page.allAuthorities")}</SelectItem>
              {authorities.map((authority) => (
                <SelectItem key={authority.id} value={authority.id}>
                  {authority.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Button onClick={submit} disabled={pending}>
          <Download aria-hidden="true" className="size-4" />
          {pending ? t("exports.page.generating") : t("exports.page.generate")}
        </Button>
      </div>
    </section>
  );
}
