"use client";

import { FileText, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { DocumentActions } from "@/components/shared/document-actions";
import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTimeFr } from "@/lib/dates";
import { Link } from "@/i18n/navigation";
import { useQueryNavigation } from "@/hooks/use-query-navigation";
import type { DocumentSearchRow } from "@/services/documents/search";

/**
 * Résultats de la recherche transverse.
 *
 * ⚠️ Tableau DISTINCT de celui des occurrences et de celui du référentiel, bien
 * qu'il leur ressemble. Ils portent des métiers différents et évolueront
 * séparément : une abstraction commune coûterait plus cher que la répétition
 * (CLAUDE.md §3.4).
 *
 * La pagination est côté serveur : la vue est filtrée par la RLS ligne à ligne,
 * et ramener tout pour paginer dans le navigateur ferait porter au client le
 * volume que la base vient justement de restreindre.
 */
export function DocumentsTable({
  rows,
  total,
  page,
  pageSize,
}: {
  readonly rows: readonly DocumentSearchRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}) {
  const t = useTranslations("documents");
  const tSearch = useTranslations("documents.search");
  const params = useSearchParams();
  const { navigate } = useQueryNavigation();

  if (rows.length === 0) {
    return <EmptyState title={tSearch("empty")} />;
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  function goTo(next: number): void {
    const query = new URLSearchParams(params.toString());
    query.set("page", String(next));
    navigate(query);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">{tSearch("resultCount", { count: total })}</p>

      {/* Le tableau défile dans son propre conteneur : la page, elle, ne part
          jamais en défilement horizontal. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-start">
              <Th>{t("columns.document")}</Th>
              <Th>{t("columns.obligation")}</Th>
              <Th>{t("columns.period")}</Th>
              <Th>{t("columns.authority")}</Th>
              <Th>{t("uploadedBy")}</Th>
              <Th>{t("columns.integrity")}</Th>
              <Th>{t("columns.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/documents/${row.id}`}
                    className="flex items-start gap-2 text-text-primary hover:underline"
                  >
                    <FileText
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-text-muted"
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{row.originalFilename}</span>
                      <span className="block text-xs text-text-muted" data-numeric>
                        {formatBytes(row.sizeBytes, t)} · {t("columns.version")} {row.version}
                        {row.isCurrentVersion ? "" : ` · ${t("detail.previousVersions")}`}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className="block text-text-primary">{row.obligationName}</span>
                  <span className="block text-xs text-text-muted" data-numeric>
                    {row.obligationCode}
                  </span>
                </td>
                <td className="px-3 py-2" data-numeric>
                  {row.periodKey}
                </td>
                <td className="px-3 py-2 text-text-secondary">{row.authorityName ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className="block text-text-secondary">{row.uploaderName ?? "—"}</span>
                  <span className="block text-xs text-text-muted">
                    {formatDateTimeFr(new Date(row.uploadedAt))}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <IntegrityBadge status={row.integrityStatus} checkedAt={row.integrityCheckedAt} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <DocumentActions documentId={row.id} compact />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lastPage > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => {
              goTo(page - 1);
            }}
          >
            {tSearch("previous")}
          </Button>
          <span className="text-sm text-text-muted" data-numeric>
            {tSearch("page", { page, total: lastPage })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= lastPage}
            onClick={() => {
              goTo(page + 1);
            }}
          >
            {tSearch("next")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-start text-xs font-medium tracking-wide text-text-muted uppercase">
      {children}
    </th>
  );
}

/**
 * État d'intégrité.
 *
 * ⚠️ PENDING n'affiche PAS un signe rassurant. L'empreinte a été calculée par le
 * navigateur au dépôt et n'a été confrontée à rien : la présenter comme vérifiée
 * ferait passer une déclaration pour une preuve.
 */
export function IntegrityBadge({
  status,
  checkedAt,
}: {
  readonly status: string;
  readonly checkedAt: string | null;
}) {
  const tIntegrity = useTranslations("documents.integrity");

  if (status === "VERIFIED") {
    return (
      <Badge variant="outline" className="text-status-validated">
        <ShieldCheck aria-hidden="true" className="size-3" />
        {checkedAt === null
          ? tIntegrity("VERIFIED")
          : tIntegrity("verifiedOn", { date: formatDateTimeFr(new Date(checkedAt)) })}
      </Badge>
    );
  }

  if (status === "MISMATCH" || status === "MISSING") {
    return (
      <Badge variant="outline" className="text-destructive">
        <ShieldAlert aria-hidden="true" className="size-3" />
        {tIntegrity(status)}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-text-muted" title={tIntegrity("pendingHint")}>
      <ShieldQuestion aria-hidden="true" className="size-3" />
      {tIntegrity("PENDING")}
    </Badge>
  );
}

/**
 * ⚠️ Répétée depuis l'onglet « Dossier » plutôt que remontée dans une couche
 * partagée : quatre lignes de mise en forme, dont le seul point commun avec
 * l'autre est la coïncidence. Les mutualiser créerait une dépendance entre deux
 * features que la barrière interdit précisément (CLAUDE.md §3.4).
 */
function formatBytes(bytes: number, t: (key: string, values: { value: string }) => string): string {
  if (bytes < 1024) return t("size.bytes", { value: String(bytes) });
  if (bytes < 1024 * 1024) return t("size.kilobytes", { value: (bytes / 1024).toFixed(0) });
  return t("size.megabytes", { value: (bytes / (1024 * 1024)).toFixed(1) });
}
