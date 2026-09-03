import type { ReactNode } from "react";

import { APP_NAME } from "@/config/constants";
import { LocaleSwitch } from "@/features/auth/components/locale-switch";

/**
 * Coquille des écrans d'authentification : aucune navigation, aucun lien vers
 * l'application. Une page atteinte sans session ne doit rien laisser deviner de
 * la structure interne.
 *
 * ⚠️ LE CHOIX DE LANGUE Y FIGURE, et c'est la seule exception à la règle
 * ci-dessus. Le sélecteur principal vit dans le menu de l'application, donc
 * derrière la connexion : sans celui-ci, une personne qui ne lit pas le français
 * devait d'abord réussir à se connecter pour pouvoir demander sa propre langue.
 * Il ne révèle rien — ni structure, ni existence de compte.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <h1 className="text-center text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
      {children}
      <LocaleSwitch />
    </main>
  );
}
