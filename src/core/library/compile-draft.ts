import { BoardDef, type BoardDraft, type PinDef } from '../schema';

const round = (n: number) => Math.round(n * 100) / 100;

/** Черновик ИИ → BoardDef: считает координаты пинов и помечает плату как непроверенную. */
export function compileBoardDraft(draft: BoardDraft, now: Date = new Date()): BoardDef {
  const pins: PinDef[] = [];
  for (const header of draft.headers) {
    let offset = 0;
    header.pins.forEach((p, i) => {
      offset += (i === 0 ? 0 : 1) + Math.max(0, p.gapBefore);
      const along = offset * header.pitch;
      pins.push({
        id: p.id,
        label: p.label,
        functions: p.functions.length ? p.functions : ['other'],
        electrical: p.electrical,
        ...(p.voltage !== null && { voltage: p.voltage }),
        ...(p.maxCurrentMa !== null && { maxCurrentMa: p.maxCurrentMa }),
        ...(p.physicalPin !== null && { physicalPin: p.physicalPin }),
        flags: p.flags,
        notes: p.notes,
        position: {
          x: round(header.originX + (header.direction === 'right' ? along : 0)),
          y: round(header.originY + (header.direction === 'down' ? along : 0)),
        },
      });
    });
  }
  return BoardDef.parse({
    id: draft.id,
    name: draft.name,
    aliases: draft.aliases,
    mcu: draft.mcu,
    logicVoltage: draft.logicVoltage,
    supply: { min: draft.supplyMinV, max: draft.supplyMaxV, pins: draft.supplyPinIds },
    rails: draft.rails.map((r) => ({
      pinId: r.pinId,
      voltage: r.voltage,
      maxCurrentMa: r.maxCurrentMa,
      ...(r.note && { note: r.note }),
    })),
    pins,
    ...(draft.maxTotalCurrentMa !== null && { maxTotalCurrentMa: draft.maxTotalCurrentMa }),
    languages: draft.languages,
    simulator: draft.simulator,
    size: { width: draft.widthMm, height: draft.heightMm },
    art: draft.art,
    verified: false,
    source: 'ai',
    generatedAt: now.toISOString(),
    provenance: draft.notes,
  });
}
