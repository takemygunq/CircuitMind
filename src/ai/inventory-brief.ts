import { itemLabel, type Inventory } from '@/core/inventory';

/** Запасы пользователя в виде списка для промта модели. */
export function inventoryBrief(inv: Inventory): string {
  const lines = inv.items.map(
    (i) =>
      `- ${i.qty}× ${itemLabel(i)} (${i.kind === 'board' ? 'board' : i.kind === 'accessory' ? 'accessory, not part of the circuit' : 'component'} id "${i.id}"${i.value ? `, value "${i.value}"` : ''})`,
  );
  if (inv.unknown.length)
    lines.push(
      '',
      `Unrecognised notes from the user (ignore as stock, but they may hint at interests): ${inv.unknown.join('; ')}`,
    );
  return lines.length ? lines.join('\n') : '(the user owns nothing yet)';
}
