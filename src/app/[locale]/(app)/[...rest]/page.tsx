import { notFound } from "next/navigation";

/**
 * Attrape-tout de la zone authentifiée.
 *
 * Sans lui, une URL inconnue sous une locale sortirait de la coquille et
 * rendrait le 404 racine, hors fournisseur i18n : l'utilisateur perdrait la
 * navigation au moment précis où il s'est perdu. Ici, il garde la barre
 * latérale et peut repartir d'un clic.
 *
 * Les segments déclarés l'emportent sur un attrape-tout : cette route ne capte
 * que ce qui n'a trouvé personne d'autre.
 */
export default function CatchAll(): never {
  notFound();
}
