import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { DocumentActions } from "@/components/shared/document-actions";
import { EmptyState } from "@/components/shared/states";
import { IntegrityBadge } from "@/features/documents/components/documents-table";
import { formatDateTimeFr } from "@/lib/dates";
import { Link } from "@/i18n/navigation";
import { getDocumentFile } from "@/services/documents/file";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Fiche d'une pièce.
 *
 * ⚠️ Porte la MÊME garde que sa section : le droit de lister et celui d'ouvrir
 * une fiche ne se dissocient pas. Un échec produit l'écran « introuvable » et
 * jamais « accès refusé » — la politique de lecture rend déjà « absent » et
 * « interdit » indistinguables, et l'interface ne doit pas les redistinguer.
 */
export default async function Page({ params }: { params: Promise<{ documentId: string }> }) {
  await requireSectionAccess("/documents");

  const { documentId } = await params;
  const t = await getTranslations("documents");

  const file = await getDocumentFile(documentId);
  if (!file.ok) notFound();

  const { document, versions, accessLog, integrityChecks } = file.value;

  return (
    <>
      <SectionHeader titleKey="documents" />

      <header className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text-primary">{document.originalFilename}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
              <span data-numeric>{document.normalizedFilename}</span>
              <span data-numeric>
                {t("columns.version")} {document.version}
              </span>
              <Link
                href={`/echeancier/${document.occurrenceId}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                {t("detail.openDossier")}
              </Link>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <DocumentActions documentId={document.id} />
          </div>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("uploadedBy")} value={document.uploaderName ?? "—"} />
          <Field label={t("uploadedAt")} value={formatDateTimeFr(new Date(document.uploadedAt))} />
          <Field label={t("detail.storedSize")} value={`${String(document.sizeBytes)} o`} />
          <div>
            <dt className="text-xs font-medium tracking-wide text-text-muted uppercase">
              {t("integrity.title")}
            </dt>
            <dd className="mt-1">
              <IntegrityBadge
                status={document.integrityStatus}
                checkedAt={document.integrityCheckedAt}
              />
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-xs break-all text-text-muted" data-numeric>
          {t("detail.checksum")} · {document.sha256}
        </p>
        {document.integrityStatus === "PENDING" ? (
          // Dire explicitement ce que PENDING signifie : l'empreinte ci-dessus a
          // été calculée par le navigateur du déposant et n'a encore été
          // confrontée à rien.
          <p className="mt-1 text-xs text-text-muted">{t("integrity.pendingHint")}</p>
        ) : null}
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-text-primary">{t("detail.versions")}</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-text-muted">{t("detail.currentVersion")}</p>
        ) : (
          <ul className="space-y-1">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm"
              >
                <span className="text-text-primary">
                  {t("columns.version")} {version.version} · {version.originalFilename}
                </span>
                <span className="flex items-center gap-2 text-xs text-text-muted">
                  {formatDateTimeFr(new Date(version.uploadedAt))}
                  <DocumentActions documentId={version.id} compact />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-text-primary">{t("integrity.history")}</h2>
        {integrityChecks.length === 0 ? (
          <EmptyState title={t("integrity.noHistory")} />
        ) : (
          <ul className="space-y-1 text-sm">
            {integrityChecks.map((check) => (
              <li key={check.id} className="flex flex-wrap items-center gap-2">
                <IntegrityBadge status={check.status} checkedAt={check.checkedAt} />
                <span className="text-xs text-text-muted">
                  {formatDateTimeFr(new Date(check.checkedAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-text-primary">{t("detail.accessLog")}</h2>
        {accessLog.length === 0 ? (
          <EmptyState title={t("detail.noAccess")} />
        ) : (
          <ul className="space-y-1 text-sm">
            {accessLog.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2">
                <span className="text-text-primary">
                  {t(`detail.action.${entry.action}` as "detail.action.VIEW")}
                </span>
                <span className="text-text-secondary">{entry.actorName ?? "—"}</span>
                <span className="text-xs text-text-muted">
                  {formatDateTimeFr(new Date(entry.createdAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-text-primary">{value}</dd>
    </div>
  );
}
