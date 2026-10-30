import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('be2 schema draft', () => {
  it('is outside the migration runner directory', async () => {
    const applied = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql'));
    const drafts = await readdir(new URL('../migrations/drafts/', import.meta.url));
    expect(applied.includes('0002_be2_consultations.sql')).toBe(false);
    expect(applied.some((name) => name.includes('be2'))).toBe(false);
    expect(drafts).toContain('0002_be2_consultations.sql');
    expect(drafts).toContain('0002_be2_consultations.checks.sql');
  });
});
