import type { ReactNode } from "react";

import { APP_NAME } from "@/config/constants";

/**
 * Coquille des écrans d'authentification : aucune navigation, aucun lien vers
 * l'application. Une page atteinte sans session ne doit rien laisser deviner de
 * la structure interne.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <h1 className="text-center text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
      {children}
    </main>
  );
}
