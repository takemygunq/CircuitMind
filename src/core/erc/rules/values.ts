import { checkCalculation, isStandard, nearestStandard } from '../../calc';
import type { ErcContext } from '../context';

export function valueRules(ctx: ErcContext): void {
  // номиналы резисторов: заданы и входят в E24
  for (const { inst, def } of ctx.knownParts()) {
    if (def.kind !== 'resistor') continue;
    const ohms = ctx.ohms(ctx.ep(`${inst.instanceId}:1`));
    if (!inst.value || !Number.isFinite(ohms) || ohms <= 0)
      ctx.add('invalid_value', 'error', [inst.instanceId], {
        part: inst.instanceId,
        value: inst.value ?? '',
      });
    else if (!isStandard(ohms, 'E24'))
      ctx.add('nonstandard_value', 'warning', [inst.instanceId], {
        part: inst.instanceId,
        value: inst.value,
        near: nearestStandard(ohms, 'E24'),
      });
  }

  // пересчёт расчётов ИИ собственными формулами
  for (const calc of ctx.project.calculations) {
    const check = checkCalculation(calc);
    if (check.status === 'invalid')
      ctx.add('calc_invalid', 'error', [calc.id], { id: calc.id, reason: check.reason });
    else if (check.status === 'mismatch')
      ctx.add('calc_mismatch', 'error', [calc.id], {
        id: calc.id,
        got: `${calc.result} ${calc.unit}`,
        expected: `${check.expected.result} ${check.expected.unit}`,
      });
  }
}
