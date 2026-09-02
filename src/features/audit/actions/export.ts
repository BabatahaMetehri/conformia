"use server";

/**
 * Export du journal d'audit.
 *
 * ⚠️ Vit dans la feature AUDIT et non dans `features/admin`, malgré la parenté
 * des deux écrans : une feature n'importe pas une autre feature, et l'écran de
 * journal a besoin de cette action. Le travail réel est dans
 * `services/admin/exportAuditCsv` — les deux features passent par le service,
 * jamais l'une par l'autre.
 */

import { z } from "zod";

import type { CsvOutcome } from "@/features/audit/actions/types";
import { toClientError } from "@/lib/errors";
import { AUDIT_EXPORT_MAX_ROWS, exportAuditCsv } from "@/services/admin";
import { uuidSchema } from "@/lib/schemas";

const ExportSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  actorId: uuidSchema.optional(),
  action: z.string().max(40).optional(),
  entityTable: z.string().max(80).optional(),
  ipAddress: z.string().max(60).optional(),
});

export async function exportAuditAction(input: unknown): Promise<CsvOutcome> {
  const parsed = ExportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: {
        code: "VALIDATION_FAILED",
        message: "errors.validationFailed",
        httpStatus: 422,
      },
    };
  }

  const result = await exportAuditCsv({
    ...parsed.data,
    limit: AUDIT_EXPORT_MAX_ROWS,
    offset: 0,
  });
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  return {
    status: "success",
    data: {
      csv: result.value.csv,
      rowCount: result.value.rowCount,
      filename: `audit-${new Date().toISOString().slice(0, 10)}.csv`,
    },
  };
}
