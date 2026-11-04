/** Validación y armado del movimiento de la captura rápida (puro, sin React). */
import { z } from "zod";

import type { TransaccionNueva, Transferencia } from "@/shared/api/tipos";
import { parseMonto } from "@/shared/lib/formato";

import type { TipoMovimiento } from "./CapturaContexto";

export interface Borrador {
  tipo: TipoMovimiento;
  monto: string;
  descripcion: string;
  categoriaId: number | null;
  cuentaId: number | null;
  destinoId: number | null;
  fecha: string;
  nota: string;
}

const esquema = z
  .object({
    tipo: z.enum(["gasto", "ingreso", "transferencia"]),
    monto: z.string().refine((v) => parseMonto(v) !== null, "Escribe un monto mayor que cero"),
    descripcion: z.string().max(200),
    categoriaId: z.number().nullable(),
    cuentaId: z.number({ message: "Elige la cuenta" }),
    destinoId: z.number().nullable(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Fecha inválida"),
    nota: z.string(),
  })
  .superRefine((b, ctx) => {
    if (b.tipo !== "transferencia" && b.categoriaId === null) {
      ctx.addIssue({ code: "custom", path: ["categoriaId"], message: "Elige una categoría" });
    }
    if (b.tipo === "transferencia" && (b.destinoId === null || b.destinoId === b.cuentaId)) {
      ctx.addIssue({ code: "custom", path: ["destinoId"], message: "Elige una cuenta de destino distinta" });
    }
  });

export type Errores = Partial<Record<keyof Borrador, string>>;

export type Resultado =
  | { ok: true; tipo: "movimiento"; datos: TransaccionNueva }
  | { ok: true; tipo: "transferencia"; datos: Transferencia }
  | { ok: false; errores: Errores };

/** Convierte el borrador en el cuerpo de la API (montos en centavos, signo según el tipo). */
export function validar(b: Borrador): Resultado {
  const r = esquema.safeParse(b);
  if (!r.success) {
    const errores: Errores = {};
    for (const issue of r.error.issues) {
      const campo = issue.path[0] as keyof Borrador;
      errores[campo] ??= issue.message;
    }
    return { ok: false, errores };
  }
  const monto = parseMonto(b.monto) as number;
  const cuenta = b.cuentaId as number;
  if (b.tipo === "transferencia") {
    return {
      ok: true,
      tipo: "transferencia",
      datos: {
        origen_id: cuenta,
        destino_id: b.destinoId as number,
        monto,
        fecha: b.fecha,
        descripcion: b.descripcion || "Transferencia",
      },
    };
  }
  return {
    ok: true,
    tipo: "movimiento",
    datos: {
      cuenta_id: cuenta,
      monto: b.tipo === "gasto" ? -monto : monto,
      categoria_id: b.categoriaId,
      fecha: b.fecha,
      descripcion: b.descripcion.trim(),
      nota: b.nota.trim(),
      estado: "confirmada",
      origen_categoria: "usuario",
    },
  };
}
