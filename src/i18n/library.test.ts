import { describe, expect, it } from 'vitest';
import { components } from '@/core/library';
import { demoProjects } from '@/core/fixtures';
import { categoryLabel, componentName, projectTexts } from './library';

describe('library translations', () => {
  it('translates every library component into all three languages', () => {
    for (const c of components) {
      const names = (['ru', 'en', 'uk'] as const).map((l) => componentName(c.id, '', l));
      expect(names.every(Boolean), c.id).toBe(true);
      expect(componentName(c.id, '', 'ru')).toBe(c.name);
    }
  });

  it('translates demo projects and falls back for AI projects', () => {
    for (const d of demoProjects) {
      const en = projectTexts(d.id, d.project, 'en');
      expect(en.title).not.toBe(d.project.title);
      expect(projectTexts(d.id, d.project, 'ru').title).toBe(d.project.title);
    }
    const ai = { title: 'X', description: 'Y' };
    expect(projectTexts('generated', ai, 'uk')).toEqual({ title: 'X', description: 'Y' });
  });

  it('translates catalogue categories and keeps unknown ones', () => {
    expect(categoryLabel('Sensors', 'ru')).toBe('Датчики');
    expect(categoryLabel('Sensors', 'uk')).toBe('Датчики');
    expect(categoryLabel('Sensors', 'en')).toBe('Sensors');
    expect(categoryLabel('Weird new thing', 'ru')).toBe('Weird new thing');
  });
});
