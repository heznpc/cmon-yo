import { describe, test, expect } from 'vitest';
import matrix from '../contracts/fixtures/matrix.json' with { type: 'json' };
import { meetupDetailSchema } from '../src/contracts/meetup';
describe('shared TS/Swift contract matrix', () => {
  for (const row of matrix)
    test(row.name, () => {
      expect(meetupDetailSchema.safeParse(row.document).success).toBe(row.valid);
    });
  test('unknown sport is not a known success value', () => {
    expect(
      meetupDetailSchema.parse(matrix.find((r) => r.name === 'unknown sport')!.document).meetup
        .sport,
    ).toBe('unknown');
  });
});
