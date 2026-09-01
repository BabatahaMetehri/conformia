/**
 * Taille de l'échantillon du contrôle d'intégrité.
 *
 * Fonction PURE, isolée du job qui l'emploie : celui-ci charge le client
 * `service_role`, marqué `server-only`, et serait donc intestable ailleurs que
 * dans un vrai processus serveur. La RÈGLE, elle, doit pouvoir être éprouvée
 * seule — c'est elle qui décide de la couverture réelle du contrôle.
 */

/**
 * Le plus grand entre le pourcentage et le plancher, borné par l'existant.
 *
 * Les deux moitiés comptent : sur une petite installation, 10 % de 40 documents
 * feraient quatre contrôles par mois — une couverture qui ne prouve rien. Sur
 * une grande, le plancher seul serait dérisoire.
 *
 * ⚠️ La borne haute n'est pas cosmétique : sans elle, une base de douze pièces
 * demanderait un échantillon de cinquante, la requête en rendrait douze, et le
 * rapport annoncerait une couverture de contrôles qui n'ont pas eu lieu.
 */
export function sampleSize(total: number, ratioPercent: number, minimum: number): number {
  if (total === 0) return 0;
  return Math.min(total, Math.max(Math.ceil((total * ratioPercent) / 100), minimum));
}
