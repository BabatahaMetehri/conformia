import { getTranslations } from "next-intl/server";

import { DemoDialogs, DemoDropzone } from "./demo-interactive";
import { DemoTable } from "./demo-table";

import { AuditTrailList } from "@/components/shared/audit-trail-list";
import { DueDateIndicator } from "@/components/shared/due-date-indicator";
import {
  CriticalityIndicator,
  PeriodicityBadge,
  RectificationBadge,
  StatusBadge,
} from "@/components/shared/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CRITICALITIES, OCCURRENCE_STATUSES, PERIODICITIES } from "@/config/constants";

/**
 * ⚠️ PAGE DE RÉFÉRENCE INTERNE — À SUPPRIMER AVANT LA MISE EN PRODUCTION.
 *
 * Elle présente chaque primitive dans tous ses états, pour qu'une régression
 * visuelle se voie sur une seule page plutôt qu'au détour d'un écran métier.
 * Elle ne lit aucune donnée : tout est figé dans le fichier.
 *
 * Le dossier s'appelle `%5Fdesign-system` : Next traite un dossier commençant par
 * `_` comme privé et ne le route pas. `%5F` est la forme documentée pour obtenir
 * un underscore littéral dans l'URL — la page est donc bien servie sur
 * `/fr/_design-system`.
 */

/** Jetons présentés dans la grille de couleurs. */
const SURFACE_TOKENS = [
  "bg-background",
  "bg-surface",
  "bg-surface-raised",
  "bg-primary",
  "bg-primary-subtle",
] as const;

const TEXT_TOKENS = [
  "text-text-primary",
  "text-text-secondary",
  "text-text-muted",
  "text-primary",
] as const;

const TYPE_SCALE = [
  { className: "text-2xs", label: "text-2xs · 11px" },
  { className: "text-xs", label: "text-xs · 12px" },
  { className: "text-sm", label: "text-sm · 14px" },
  { className: "text-base", label: "text-base · 16px" },
  { className: "text-lg", label: "text-lg · 18px" },
  { className: "text-xl", label: "text-xl · 24px" },
] as const;

const DUE_SAMPLES = [
  { days: 42, date: "20/02/2026", iso: "2026-02-20" },
  { days: 6, date: "30/01/2026", iso: "2026-01-30" },
  { days: 1, date: "21/01/2026", iso: "2026-01-21" },
  { days: -9, date: "11/01/2026", iso: "2026-01-11" },
] as const;

const AUDIT_SAMPLE = [
  {
    id: "1",
    fromStatus: null,
    toStatus: "TODO" as const,
    actorName: null,
    onBehalfOfName: null,
    reason: null,
    formattedAt: "01/01/2026 03:00",
    isoAt: "2026-01-01T02:00:00Z",
  },
  {
    id: "2",
    fromStatus: "TODO" as const,
    toStatus: "IN_PROGRESS" as const,
    actorName: "Amina Belkacem",
    onBehalfOfName: null,
    reason: null,
    formattedAt: "05/01/2026 09:14",
    isoAt: "2026-01-05T08:14:00Z",
  },
  {
    id: "3",
    fromStatus: "PENDING_VALIDATION" as const,
    toStatus: "REJECTED" as const,
    actorName: "Karim Meziane",
    onBehalfOfName: "Sofiane Haddad",
    reason: "Annexe 3 manquante.",
    formattedAt: "09/01/2026 16:42",
    isoAt: "2026-01-09T15:42:00Z",
  },
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      <div className="rounded-lg border border-border bg-surface p-6">{children}</div>
    </section>
  );
}

export default async function DesignSystemPage() {
  const t = await getTranslations("designSystem");

  return (
    <div className="space-y-10 pb-16">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-text-primary">{t("title")}</h1>
        <p
          role="note"
          className="rounded-md border border-status-pending/40 bg-status-pending-bg px-3 py-2 text-sm text-status-pending"
        >
          {t("warning")}
        </p>
      </header>

      <Section title={t("sections.colors")}>
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3">
            {SURFACE_TOKENS.map((token) => (
              <div key={token} className="space-y-1">
                <div className={`size-20 rounded-md border border-border ${token}`} />
                <code className="text-2xs text-text-muted">{token}</code>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-6">
            {TEXT_TOKENS.map((token) => (
              <p key={token} className={`text-sm ${token}`}>
                {token}
              </p>
            ))}
          </div>
        </div>
      </Section>

      <Section title={t("sections.typography")}>
        <div className="space-y-3">
          {TYPE_SCALE.map((step) => (
            <p key={step.className} className={step.className}>
              {step.label} — Déclaration G50 · 1 234 567 · 30/09/2026
            </p>
          ))}
          <Separator />
          <p className="text-xs text-text-muted">
            Les chiffres ci-dessus sont à chasse fixe : 11/01, 30/09 et 28/02 occupent exactement la
            même largeur.
          </p>
        </div>
      </Section>

      <Section title={t("sections.status")}>
        <div className="flex flex-wrap gap-2">
          {OCCURRENCE_STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section title={t("sections.due")}>
        <div className="flex flex-col gap-3">
          {DUE_SAMPLES.map((sample) => (
            <DueDateIndicator
              key={sample.iso}
              formattedDate={sample.date}
              isoDate={sample.iso}
              daysRemaining={sample.days}
            />
          ))}
        </div>
      </Section>

      <Section title={t("sections.badges")}>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PERIODICITIES.map((periodicity) => (
              <PeriodicityBadge key={periodicity} periodicity={periodicity} />
            ))}
          </div>
          <div className="flex flex-wrap gap-6">
            {CRITICALITIES.map((criticality) => (
              <CriticalityIndicator key={criticality} criticality={criticality} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <RectificationBadge index={1} />
            <RectificationBadge index={2} originalHref="#originale" />
          </div>
        </div>
      </Section>

      <Section title={t("sections.identity")}>
        <div className="flex flex-wrap items-center gap-6">
          <UserAvatar fullName="Amina Belkacem" size="sm" />
          <UserAvatar fullName="Karim Meziane" size="md" showName />
          <UserAvatar fullName="Sofiane Haddad" size="lg" />
          <UserAvatar fullName={null} />
        </div>
      </Section>

      <Section title={t("sections.states")}>
        <div className="space-y-8">
          <EmptyState
            title="Aucune échéance sur cette période"
            description="Élargissez la période ou retirez un filtre pour voir davantage de dossiers."
            action={<Button variant="outline">Réinitialiser les filtres</Button>}
          />
          <ErrorState
            title="Le chargement a échoué"
            description="La liste n'a pas pu être récupérée. Réessayez, puis contactez le support si le problème persiste."
            correlationId="req_8f3c2a91"
            action={<Button variant="outline">Réessayer</Button>}
          />
          <LoadingState variant="table" label="Chargement du tableau" rows={3} />
          <LoadingState variant="card" label="Chargement des indicateurs" rows={3} />
          <LoadingState variant="detail" label="Chargement du dossier" />
        </div>
      </Section>

      <Section title={t("sections.table")}>
        <DemoTable />
      </Section>

      <Section title={t("sections.dialogs")}>
        <DemoDialogs />
      </Section>

      <Section title={t("sections.forms")}>
        <div className="grid max-w-md gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ds-input">Numéro de dépôt</Label>
            <Input id="ds-input" placeholder="AR-2026-000123" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ds-textarea">Motif</Label>
            <Textarea id="ds-textarea" rows={3} placeholder="Annexe 3 manquante." />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="ds-checkbox" />
            <Label htmlFor="ds-checkbox">Pièce vérifiée</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="ds-switch" />
            <Label htmlFor="ds-switch">Notifications par courriel</Label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button>Principal</Button>
            <Button variant="secondary">Secondaire</Button>
            <Button variant="outline">Contour</Button>
            <Button variant="ghost">Discret</Button>
            <Button variant="destructive">Destructif</Button>
            <Button disabled>Désactivé</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Badge</Badge>
            <Badge variant="secondary">Secondaire</Badge>
            <Badge variant="outline">Contour</Badge>
          </div>
        </div>
      </Section>

      <Section title={t("sections.upload")}>
        <DemoDropzone />
      </Section>

      <Section title={t("sections.audit")}>
        <AuditTrailList entries={AUDIT_SAMPLE} />
      </Section>
    </div>
  );
}
