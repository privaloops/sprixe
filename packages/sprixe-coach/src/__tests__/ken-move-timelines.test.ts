import { describe, it, expect } from 'vitest';
import { animPtrAtFrame, type MoveTimeline } from '../agent/tas/ken-move-timelines';

describe('animPtrAtFrame', () => {
  const tl: MoveTimeline = [
    { animPtr: 0xAAAA, frames: 1 },
    { animPtr: 0xBBBB, frames: 14 },
    { animPtr: 0xCCCC, frames: 3 },
  ];

  it('returns the first entry at frame 0', () => {
    expect(animPtrAtFrame(tl, 0)).toBe(0xAAAA);
  });

  it('advances into the next entry after the first hold expires', () => {
    expect(animPtrAtFrame(tl, 1)).toBe(0xBBBB);
  });

  it('stays on the long entry across all its hold frames', () => {
    expect(animPtrAtFrame(tl, 5)).toBe(0xBBBB);
    expect(animPtrAtFrame(tl, 14)).toBe(0xBBBB);
  });

  it('jumps to the last entry at the right boundary', () => {
    expect(animPtrAtFrame(tl, 15)).toBe(0xCCCC);
    expect(animPtrAtFrame(tl, 17)).toBe(0xCCCC);
  });

  it('returns null past the end of the timeline', () => {
    expect(animPtrAtFrame(tl, 18)).toBeNull();
    expect(animPtrAtFrame(tl, 100)).toBeNull();
  });

  it('returns null for negative offsets', () => {
    expect(animPtrAtFrame(tl, -1)).toBeNull();
  });

  it('handles an empty timeline', () => {
    expect(animPtrAtFrame([], 0)).toBeNull();
  });
});
