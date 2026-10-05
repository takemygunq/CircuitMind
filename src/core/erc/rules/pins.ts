import type { ErcContext } from '../context';

/** Ограничения конкретных пинов: input-only, flash, strapping, ADC2 при Wi-Fi. */
export function pinRules(ctx: ErcContext): void {
  const wifi = ctx.usesWifi();
  for (const net of ctx.nets.nets) {
    const eps = ctx.netEps(net.id);
    const boardPins = eps.filter((e) => e.isBoard && e.pin && !ctx.isGnd(e) && !ctx.isSupplyPin(e));
    for (const bp of boardPins) {
      const pin = bp.pin!;
      const others = eps.filter((e) => e.endpoint !== bp.endpoint && !e.isBoard);
      const v = ctx.signalVoltage(bp) ?? ctx.board.logicVoltage;
      const { loadMa } = ctx.netLoad(net.id, v, bp.endpoint);
      const needsDrive =
        loadMa > 0 ||
        others.some(
          (e) =>
            (e.pin?.electrical === 'input' || e.pin?.electrical === 'bidirectional') &&
            !e.pin.analog &&
            e.def?.kind !== 'button',
        );

      if (pin.flags.includes('input_only') && needsDrive)
        ctx.add('input_only_as_output', 'error', [bp.endpoint], { pin: pin.id });
      if (pin.flags.includes('flash') || pin.flags.includes('reserved'))
        ctx.add('flash_pin_used', 'error', [bp.endpoint], { pin: pin.id });
      if (pin.flags.includes('strapping') || pin.flags.includes('boot'))
        ctx.add('strapping_pin_used', 'warning', [bp.endpoint], { pin: pin.id });
      if (wifi && pin.flags.includes('adc2') && others.some((e) => e.pin?.analog))
        ctx.add('adc2_wifi', 'error', [bp.endpoint], { pin: pin.id });
    }
  }
}
