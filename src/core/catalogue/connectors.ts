/**
 * Каталог разъёмов и кабелей: расходники, которые нужны для сборки, но не участвуют в электрической модели.
 * Список собирается генератором из семейств (шаг, число выводов, длина, цвет), поэтому он компактен и проверяем тестом.
 * Иллюстрации — семь общих картинок на семейство (public/parts), их сгенерировали в Higgsfield.
 */

export type PartGroup = 'connectors' | 'wires' | 'cables' | 'power' | 'prototyping';
export type PartImage =
  | 'pin-headers'
  | 'jumper-wires'
  | 'wire-spool'
  | 'usb-cable'
  | 'dc-jack'
  | 'jst'
  | 'terminal'
  | 'breadboard';

export interface CataloguePart {
  /** Стабильный id: "<семейство>-<параметры>" в kebab-case. */
  id: string;
  name: string;
  group: PartGroup;
  /** Подгруппа для подписи карточки, например "Pin headers". */
  family: string;
  image: PartImage;
  /** Примерная цена за штуку/упаковку, $. */
  priceUsd: number;
  tags: string[];
}

export const PART_GROUPS: PartGroup[] = ['connectors', 'wires', 'cables', 'power', 'prototyping'];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/["”]/g, 'in')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const out: CataloguePart[] = [];
function add(p: Omit<CataloguePart, 'id'> & { id?: string }) {
  out.push({ ...p, id: p.id ?? slug(p.name) });
}

// ───── разъёмы: гребёнки 2,54 мм ─────
const HEADER_LAYOUTS: {
  gender: 'Male' | 'Female';
  angle: 'Straight' | 'Right Angle';
  rows: 1 | 2;
  sizes: number[];
}[] = [
  { gender: 'Male', angle: 'Straight', rows: 1, sizes: [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 40] },
  { gender: 'Male', angle: 'Right Angle', rows: 1, sizes: [2, 3, 4, 6, 8, 10, 15, 40] },
  { gender: 'Female', angle: 'Straight', rows: 1, sizes: [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 40] },
  { gender: 'Female', angle: 'Right Angle', rows: 1, sizes: [4, 6, 8, 10, 15, 20] },
  { gender: 'Male', angle: 'Straight', rows: 2, sizes: [3, 4, 5, 6, 8, 10, 20] },
  { gender: 'Female', angle: 'Straight', rows: 2, sizes: [3, 4, 5, 8, 10, 20] },
];
for (const l of HEADER_LAYOUTS)
  for (const n of l.sizes)
    add({
      name: `0.1" (2.54 mm) ${l.gender} Pin Header ${l.rows}x${n} ${l.angle}`,
      group: 'connectors',
      family: 'Pin headers',
      image: 'pin-headers',
      priceUsd: Math.round((0.1 + 0.04 * n * l.rows) * 100) / 100,
      tags: ['header', 'pin', '2.54', l.gender.toLowerCase(), l.angle.toLowerCase()],
    });

// ───── разъёмы: JST и Qwiic ─────
for (const [series, pitch, sizes] of [
  ['JST-PH', '2.0 mm', [2, 3, 4, 5]],
  ['JST-XH', '2.54 mm', [2, 3, 4, 5]],
  ['JST-SH', '1.0 mm', [4, 5, 6]],
] as const)
  for (const n of sizes)
    add({
      name: `${series} ${pitch} ${n}-pin Cable (150 mm)`,
      group: 'connectors',
      family: 'JST connectors',
      image: 'jst',
      priceUsd: 0.6 + n * 0.12,
      tags: ['jst', series.toLowerCase(), 'pigtail'],
    });
for (const len of [50, 100, 200, 500])
  add({
    name: `Qwiic / STEMMA QT 4-pin Cable (${len} mm)`,
    group: 'connectors',
    family: 'JST connectors',
    image: 'jst',
    priceUsd: 0.95 + len / 500,
    tags: ['qwiic', 'stemma', 'i2c'],
  });
for (const n of [2, 3, 4, 5, 6, 8, 10])
  add({
    name: `Screw Terminal Block 5.08 mm ${n}-position`,
    group: 'connectors',
    family: 'Terminal blocks',
    image: 'terminal',
    priceUsd: 0.25 * n,
    tags: ['terminal', 'screw', '5.08'],
  });
for (const n of [2, 3, 4, 6])
  add({
    name: `Pluggable Terminal Block 3.5 mm ${n}-position`,
    group: 'connectors',
    family: 'Terminal blocks',
    image: 'terminal',
    priceUsd: 0.35 * n,
    tags: ['terminal', 'pluggable', '3.5'],
  });

// ───── провода ─────
const COLORS = ['Red', 'Black', 'Blue', 'Green', 'Yellow', 'White', 'Orange'];
for (const [kind, awg, len, cols] of [
  ['Solid-core hookup wire', 22, '25 ft', COLORS],
  ['Stranded hookup wire', 24, '25 ft', COLORS.slice(0, 6)],
  ['Stranded hookup wire', 26, '25 ft', COLORS.slice(0, 4)],
  ['Silicone-insulated wire', 22, '10 m', ['Red', 'Black', 'Blue', 'Yellow']],
  ['"Wire Wrap" prototyping wire', 30, '50 m', ['Blue', 'White', 'Red', 'Yellow']],
] as const)
  for (const c of cols)
    add({
      name: `${kind} ${awg}AWG ${c} (${len})`,
      group: 'wires',
      family: 'Wire spools',
      image: 'wire-spool',
      priceUsd: kind.includes('Silicone') ? 6.5 : 4.5,
      tags: ['wire', `${awg}awg`, c.toLowerCase()],
    });
for (const [type, short] of [
  ['Male to Male', 'M/M'],
  ['Male to Female', 'M/F'],
  ['Female to Female', 'F/F'],
] as const)
  for (const len of [100, 200, 300])
    add({
      name: `Dupont Jumper Wires ${short} ${len / 10} cm (40 pcs)`,
      group: 'wires',
      family: 'Jumper wires',
      image: 'jumper-wires',
      priceUsd: 2.5 + len / 200,
      tags: ['jumper', 'dupont', type.toLowerCase()],
    });
add({
  name: 'Breadboard Jumper Wire Kit (65 pcs, pre-cut)',
  group: 'wires',
  family: 'Jumper wires',
  image: 'jumper-wires',
  priceUsd: 5.5,
  tags: ['jumper', 'breadboard', 'kit'],
});
add({
  name: 'Rainbow Ribbon Cable 10-wire (1 m)',
  group: 'wires',
  family: 'Jumper wires',
  image: 'jumper-wires',
  priceUsd: 3.2,
  tags: ['ribbon', 'cable'],
});

// ───── кабели ─────
for (const [name, lens] of [
  ['USB-A to USB-C Data Cable', ['0.5 m', '1 m', '2 m']],
  ['USB-C to USB-C Data Cable', ['0.5 m', '1 m', '2 m']],
  ['USB-A to Micro-B Data Cable', ['0.3 m', '1 m']],
  ['USB-A to Mini-B Cable', ['0.5 m', '1 m']],
  ['USB-A to USB-B (Printer) Cable', ['1.8 m']],
  ['USB-C OTG Adapter Cable', ['0.1 m']],
  ['USB-A to TTL Serial Cable (CP2102)', ['1 m']],
] as const)
  for (const len of lens)
    add({
      name: `${name} (${len})`,
      group: 'cables',
      family: 'USB cables',
      image: 'usb-cable',
      priceUsd: 3 + parseFloat(len) * 1.5,
      tags: ['usb', 'cable', 'data'],
    });
for (const n of [6, 8, 10, 15, 24, 40])
  add({
    name: `FFC Ribbon Cable 0.5 mm ${n}-pin (100 mm)`,
    group: 'cables',
    family: 'Ribbon & FFC',
    image: 'jumper-wires',
    priceUsd: 0.8 + n * 0.04,
    tags: ['ffc', 'ribbon', 'flat'],
  });
for (const n of [10, 14, 16, 20, 26, 40])
  add({
    name: `IDC Ribbon Cable ${n}-pin (30 cm)`,
    group: 'cables',
    family: 'Ribbon & FFC',
    image: 'jumper-wires',
    priceUsd: 1.5 + n * 0.05,
    tags: ['idc', 'ribbon'],
  });
for (const [n, l] of [
  ['Alligator Clip Test Leads (10 pcs)', 5.5],
  ['Banana to Alligator Test Lead (1 m)', 4.5],
  ['Test Probe Hook Clips (2 pcs)', 3.8],
  ['SMA to u.FL Antenna Pigtail (15 cm)', 3.5],
  ['3.5 mm TRS Audio Cable (1 m)', 3.2],
] as const)
  add({
    name: n,
    group: 'cables',
    family: 'Test & RF',
    image: 'jumper-wires',
    priceUsd: l,
    tags: ['test', 'clip'],
  });

// ───── питание ─────
for (const [jack, id] of [
  ['5.5 x 2.1 mm', 'a'],
  ['5.5 x 2.5 mm', 'b'],
  ['3.5 x 1.35 mm', 'c'],
] as const)
  for (const kind of ['Plug with Screw Terminals', 'Panel-mount Jack', 'Plug to Wire Pigtail']) {
    add({
      id: `dc-${id}-${slug(kind)}`,
      name: `DC Barrel ${kind} ${jack}`,
      group: 'power',
      family: 'DC connectors',
      image: 'dc-jack',
      priceUsd: 1.2,
      tags: ['dc', 'barrel', 'power'],
    });
  }
for (const [n, price] of [
  ['9V Battery Clip with Wires', 0.8],
  ['2x AA Battery Holder with Switch', 1.4],
  ['4x AA Battery Holder with Leads', 1.6],
  ['18650 Single Cell Holder', 1.2],
  ['LiPo JST-PH 2-pin Charger Cable', 2.4],
  ['Coin Cell Holder CR2032', 0.9],
] as const)
  add({
    name: n,
    group: 'power',
    family: 'Battery holders',
    image: 'dc-jack',
    priceUsd: price,
    tags: ['battery', 'power'],
  });

// ───── макетирование ─────
for (const [n, price] of [
  ['Solderless Breadboard Full-size 830 tie-points', 6.5],
  ['Solderless Breadboard Half-size 400 tie-points', 4.5],
  ['Solderless Breadboard Mini 170 tie-points', 2.2],
  ['Transparent Breadboard Half-size', 5.5],
  ['Breadboard Power Supply Module 3.3V/5V', 3.2],
  ['Perma-Proto Half-size PCB', 6.0],
] as const)
  add({
    name: n,
    group: 'prototyping',
    family: 'Breadboards',
    image: 'breadboard',
    priceUsd: price,
    tags: ['breadboard', 'proto'],
  });

export const connectorsCatalogue: readonly CataloguePart[] = out;

export const findCataloguePart = (id: string): CataloguePart | undefined =>
  out.find((p) => p.id === id);

export function searchCatalogue(
  query: string,
  group?: PartGroup,
  list: readonly CataloguePart[] = out,
): CataloguePart[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(
    (p) =>
      (!group || p.group === group) &&
      words.every((w) => `${p.name} ${p.family} ${p.tags.join(' ')}`.toLowerCase().includes(w)),
  );
}
