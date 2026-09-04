import { Building2, Info } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { RegisterCompliance } from "@/services/registers";

/**
 * Conformité PROPRE à un registre, sur le tableau de bord.
 *
 * ⚠️ MESURE EXCLUSIVE, ET C'EST TOUT L'ENJEU DE CE PANNEAU.
 *
 * Le tableau de bord est un écran de MESURE : la question posée est « quelle est
 * la conformité propre à cet établissement ? ». Y mêler les obligations valant
 * pour toute l'entreprise — 73 sur ce jeu de données, contre 3 propres au
 * registre — écraserait la mesure : tous les registres afficheraient
 * pratiquement le même taux, et le filtre ne servirait plus à rien.
 *
 * C'est l'inverse exact de /echeancier et /documents, écrans de CONSULTATION où
 * le filtre est inclusif. Les deux sont justes ; c'est la question posée qui
 * diffère. D'où la mention explicite en tête : un chiffre dont on ignore le
 * périmètre finit mal interprété en réunion.
 *
 * ⚠️ Le taux vient de `register_compliance()`, jamais d'un calcul refait ici. La
 * fonction écarte déjà les dossiers SANS OBJET du dénominateur et rend NULL —
 * pas 0 % — quand un établissement n'a rien à déclarer. Le recalculer côté
 * application produirait une seconde définition de la conformité.
 */
export async function RegisterScopePanel({
  compliance,
}: {
  readonly compliance: RegisterCompliance;
}) {
  const t = await getTranslations("registers");
  const tDash = await getTranslations("dashboard");

  return (
    <section
      aria-labelledby="register-scope-heading"
      className="mb-4 rounded-lg border border-accent/30 bg-accent/5 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="register-scope-heading"
            className="flex items-center gap-2 text-sm font-semibold text-text-primary"
          >
            <Building2 aria-hidden="true" className="size-4" />
            <Link
              href={`/registres/${compliance.registerId}`}
              className="underline-offset-2 hover:underline"
            >
              <span className="tabular-nums">{compliance.rcNumber}</span> — {compliance.label}
            </Link>
          </h2>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-text-secondary">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t("scope.exclusive")} {t("scope.exclusiveHint")}
            </span>
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-4">
        <Figure
          label={t("compliance.rate")}
          value={
            compliance.complianceRate === null
              ? t("compliance.noData")
              : `${String(compliance.complianceRate)} %`
          }
        />
        <Figure label={t("compliance.total")} value={String(compliance.total)} />
        <Figure label={t("compliance.submitted")} value={String(compliance.submitted)} />
        {/*
         * ⚠️ La clé est OMISE plutôt que mise à `undefined` :
         * `exactOptionalPropertyTypes` distingue « absent » de « présent et
         * indéfini », et c'est bien « absent » que l'on veut dire.
         */}
        <Figure
          label={tDash("overdue")}
          value={String(compliance.overdue)}
          {...(compliance.overdue > 0 ? { tone: "text-status-overdue" } : {})}
        />
      </dl>
    </section>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: string;
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-text-muted uppercase">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? "text-text-primary"}`}>
        {value}
      </dd>
    </div>
  );
}
