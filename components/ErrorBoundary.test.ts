import { captureError } from '@/lib/sentry';

import { ErrorBoundary } from './ErrorBoundary';

// NR1 Job 1 — pin the boundary's reporting wiring + the privacy property
// (only a structured tag ever reaches the reporting path, never the error
// text). Rendering the recovery UI needs the RN tree; the correctness that
// matters here is testable without it.
jest.mock('@/lib/sentry', () => ({ captureError: jest.fn() }));

describe('ErrorBoundary (NR1 Job 1)', () => {
  beforeEach(() => (captureError as jest.Mock).mockClear());

  it('getDerivedStateFromError flips into the recovery state', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });

  it('componentDidCatch routes to the single reporting path with the boundary tag ONLY', () => {
    const boundary = new ErrorBoundary({ label: 'root', children: null });
    const err = new Error('boom — a reflection line must never ride along in a tag');

    boundary.componentDidCatch(err);

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(err, { boundary: 'root' });

    // Privacy bar (NR1 §privacy): the context is the structured boundary
    // tag and nothing else — the error's own message is never lifted into
    // the tags object as free text.
    const [, ctx] = (captureError as jest.Mock).mock.calls[0];
    expect(Object.keys(ctx)).toEqual(['boundary']);
    expect(JSON.stringify(ctx)).not.toContain('reflection line');
  });

  it('carries the label through so each boundary is distinguishable', () => {
    new ErrorBoundary({ label: 'tab:circle', children: null }).componentDidCatch(new Error('x'));
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { boundary: 'tab:circle' });
  });
});
