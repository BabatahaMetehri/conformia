"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LOCALES } from "@/config/constants";
import { setLocaleAction } from "@/features/auth/actions/locale";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useActionRunner } from "@/hooks/use-action-runner";

/**
 * Choix de langue sur les écrans d'authentification.
 *
 * ⚠️ IL EXISTE PARCE QUE LE MENU UTILISATEUR N'EST PAS ENCORE ATTEIGNABLE.
 *
 * Le sélecteur principal vit dans le menu de l'application — donc derrière la
 * connexion. Une personne qui ne lit pas le français se retrouvait alors devant
 * un formulaire qu'elle ne comprend pas, sans aucun moyen d'en changer la
 * langue : il fallait d'abord réussir à se connecter pour pouvoir demander sa
 * propre langue. C'est le genre d'impasse qu'on ne voit pas quand on lit la
 * langue par défaut.
 *
 * ⚠️ Rendu en BOUTONS, pas en menu déroulant. Deux langues n'en justifient pas
 * un, et un menu ajouterait un geste — ouvrir, puis choisir — sur l'écran où
 * l'utilisateur est le plus démuni.
 */
export function LocaleSwitch() {
  const t = useTranslations("layout");
  const current = useLocale();
  const pathname = usePathname();
  // Voir user-menu.tsx : l'attente sert à empêcher deux redirections concurrentes.
  const [switching, run] = useActionRunner();

  return (
    <div className="flex items-center justify-center gap-1 text-sm">
      <Languages aria-hidden="true" className="size-4 text-text-muted" />
      <span className="sr-only">{t("language")}</span>

      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          /*
           * ⚠️ `lang` sur le bouton : « العربية » doit être annoncé en arabe par
           * un lecteur d'écran, même quand la page est en français. Sans cet
           * attribut, la synthèse vocale lit des caractères arabes avec des
           * règles françaises.
           */
          lang={locale}
          aria-current={locale === current ? "true" : undefined}
          disabled={switching || locale === current}
          onClick={() => {
            if (locale === current) return;
            run(async () => {
              await setLocaleAction(locale, pathname);
            });
          }}
          className={cn(
            "rounded-md px-2 py-1 transition-colors",
            locale === current
              ? "font-medium text-text-primary"
              : "text-text-secondary underline-offset-2 hover:text-text-primary hover:underline",
          )}
        >
          {t(`locales.${locale}`)}
        </button>
      ))}
    </div>
  );
}
