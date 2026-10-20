import { describe, expect, it } from 'vitest';
import { markAsTest } from './message.ts';

describe('markAsTest', () => {
  it('labels the subject and says who would have received it', () => {
    const marked = markAsTest({ subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' }, 'ada@example.com');
    expect(marked.subject).toBe('[TEST] Hello');
    expect(marked.text).toMatch(/^TEST MESSAGE: in live mode this would have gone to ada@example.com\./);
    expect(marked.html).toContain('<p>Hi</p>');
  });

  it('escapes the address it shows', () => {
    expect(markAsTest({ subject: 's', html: '', text: '' }, '<b>@x').html).toContain('&lt;b&gt;@x');
  });
});
