/** Contrat de retour de l'export d'audit. Hors module « use server ». */

import type { ClientError } from "@/lib/errors";

export type CsvOutcome =
  | {
      readonly status: "success";
      readonly data: {
        readonly csv: string;
        readonly rowCount: number;
        readonly filename: string;
      };
    }
  | { readonly status: "error"; readonly error: ClientError };
