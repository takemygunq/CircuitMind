import type { Project } from '../schema';
import { blinkUno } from './blink-uno';
import { symbolsUno } from './symbols-uno';
import { brokenEsp32 } from './broken-esp32';
import { weatherEsp32 } from './weather-esp32';

export { blinkUno, brokenEsp32, symbolsUno, weatherEsp32 };

export const demoProjects: { id: string; project: Project }[] = [
  { id: 'weather-esp32', project: weatherEsp32 },
  { id: 'blink-uno', project: blinkUno },
  { id: 'broken-esp32', project: brokenEsp32 },
];

export { mockVariantInputs } from './variant-drafts';
