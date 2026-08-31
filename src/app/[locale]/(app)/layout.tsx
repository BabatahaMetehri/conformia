import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { getResolvedNavigation } from "@/services/navigation";

/**
 * Coquille de la zone authentifiée.
 *
 * ⚠️ La navigation est résolue ICI, sur le serveur. Ce qui descend au navigateur
 * est l'arbre DÉJÀ FILTRÉ : une section interdite n'est pas rendue puis masquée,
 * elle est absente de la charge utile. Le code source de la page ne la mentionne
 * pas — c'est vérifiable dans l'inspecteur, et c'est la seule preuve qui compte.
 *
 * Défense en profondeur malgré tout : chaque écran rejoue la garde
 * (`requireSectionAccess`), et la RLS refuse la donnée en dernier ressort. Trois
 * barrières indépendantes, dont une seule — la dernière — est réellement une
 * barrière de sécurité.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const navigation = await getResolvedNavigation();

  // Sans session, il n'y a pas de coquille à rendre. Le middleware a normalement
  // déjà redirigé : ce cas ne survient qu'en cas de session expirée entre le
  // middleware et le rendu. On refait le geste plutôt que de rendre une barre
  // latérale vide.
  if (!navigation.ok) {
    redirect(`/${locale}/login`);
  }

  return (
    <AppShell items={navigation.value.items} counters={navigation.value.counters} locale={locale}>
      {children}
    </AppShell>
  );
}
