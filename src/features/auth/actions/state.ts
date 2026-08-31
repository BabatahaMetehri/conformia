import type { ClientError } from "@/lib/errors";

/**
 * Etat partage des formulaires d'authentification.
 *
 * Declare A PART du module d'actions : un fichier « use server » ne peut
 * exporter QUE des fonctions asynchrones. Y placer une constante compile et
 * construit sans broncher, puis echoue a la premiere requete —
 * « A "use server" file can only export async functions, found object ».
 */
export interface ActionState {
  readonly status: "idle" | "success" | "error";
  readonly error?: ClientError;
  /** Renseigne par les actions dont l'ecran affiche une confirmation. */
  readonly message?: string;
}

export const initialActionState: ActionState = { status: "idle" };
