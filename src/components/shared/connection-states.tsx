"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Les trois états qu'un écran oublie toujours : hors ligne, session expirée,
 * conflit de modification.
 *
 * ⚠️ Ce sont les seuls états où l'utilisateur a fait quelque chose de juste et
 * n'obtient pas le résultat attendu. Les taire produit la pire expérience du
 * produit : un bouton qui ne fait rien, sans explication, et une saisie perdue
 * sans qu'on sache pourquoi.
 */

/**
 * État de la connexion réseau du navigateur.
 *
 * ⚠️ Initialisé à `true` et corrigé après montage, jamais lu au premier rendu.
 * `navigator` n'existe pas côté serveur : le lire au rendu initial ferait
 * diverger le HTML serveur du HTML client, et React remplacerait tout l'arbre à
 * l'hydratation.
 *
 * ⚠️ `navigator.onLine` dit que la CARTE RÉSEAU est active, pas qu'Internet
 * répond. C'est une heuristique — suffisante pour expliquer un échec, jamais
 * pour bloquer une action. On n'empêche donc rien : on informe.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = (): void => {
      setOnline(navigator.onLine);
    };

    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

/**
 * Bandeau de perte de connexion, affiché dans la coquille de l'application.
 *
 * ⚠️ `role="status"` et non `role="alert"` : la perte de réseau n'interrompt
 * rien, elle explique. Un `alert` couperait la parole au lecteur d'écran au
 * milieu d'une saisie, pour une information qui peut attendre la fin de la
 * phrase.
 */
export function OfflineBanner() {
  const t = useTranslations("states.offline");
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      role="status"
      className="border-status-warning/40 bg-status-warning-bg flex items-start gap-3 border-b px-4 py-2.5 text-sm"
    >
      <WifiOff aria-hidden="true" className="text-status-warning mt-0.5 size-4 shrink-0" />
      <p className="text-text-primary">
        <span className="font-medium">{t("title")}</span>{" "}
        <span className="text-text-secondary">{t("description")}</span>
      </p>
    </div>
  );
}

/**
 * Conflit de modification concurrente.
 *
 * ⚠️ Le message dit explicitement QUE RIEN N'A ÉTÉ ÉCRASÉ. C'est la première
 * question que se pose quelqu'un dont l'action vient d'être refusée — et sans
 * réponse, il recommence, ou pire, il renonce en croyant avoir cassé quelque
 * chose.
 */
export function ConflictState({
  onReload,
  className,
}: {
  readonly onReload: () => void;
  readonly className?: string;
}) {
  const t = useTranslations("states.conflict");

  return (
    <div
      role="alert"
      className={cn(
        "border-status-warning/40 bg-status-warning-bg flex flex-col items-start gap-3 rounded-lg border px-4 py-3",
        className,
      )}
    >
      <div>
        <p className="text-sm font-medium text-text-primary">{t("title")}</p>
        <p className="mt-1 max-w-prose text-sm text-text-secondary">{t("description")}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onReload}>
        <RefreshCw aria-hidden="true" className="size-4" />
        {t("action")}
      </Button>
    </div>
  );
}

/**
 * Session expirée.
 *
 * ⚠️ On ne redirige PAS d'office vers la connexion. Une redirection automatique
 * perd la saisie en cours sans prévenir ; l'utilisateur peut vouloir copier son
 * texte avant de partir. Le lien est proposé, le geste reste le sien.
 */
export function SessionExpiredState({
  loginHref,
  className,
}: {
  readonly loginHref: string;
  readonly className?: string;
}) {
  const t = useTranslations("states.sessionExpired");

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3",
        className,
      )}
    >
      <div>
        <p className="text-sm font-medium text-text-primary">{t("title")}</p>
        <p className="mt-1 max-w-prose text-sm text-text-secondary">{t("description")}</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <a href={loginHref}>{t("action")}</a>
      </Button>
    </div>
  );
}
