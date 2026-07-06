// __tests__/app/room-mappings/helpers.test.ts
// Unit tests for the N-way room mapping group/member logic (Phase C rework).
// Mirrors the lightweight logic-test convention used elsewhere in this repo
// (no DB integration — pure functions extracted/mirrored from the route + page logic).

type Member = {
  memberId: number;
  groupId: number;
  source: string;
  roomNameId: number;
  roomName: string;
  memberStatus: 'manual' | 'ai';
  confidence: number | null;
};

type Group = {
  groupId: number;
  hotelId: number;
  source: 'manual' | 'ai';
  confidence: number | null;
  members: Member[];
};

const SOURCE_ORDER = ['amello', 'booking', 'check24', 'brand'];

function sortSources(sources: string[]): string[] {
  return [...sources].sort((a, b) => {
    const ai = SOURCE_ORDER.indexOf(a);
    const bi = SOURCE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

describe('Room Mappings — column source ordering', () => {
  it('orders known sources amello, booking, check24, brand first', () => {
    expect(sortSources(['check24', 'amello', 'brand', 'booking']))
      .toEqual(['amello', 'booking', 'check24', 'brand']);
  });

  it('appends unknown sources alphabetically after known ones', () => {
    expect(sortSources(['zeta', 'amello', 'alpha', 'booking']))
      .toEqual(['amello', 'booking', 'alpha', 'zeta']);
  });
});

describe('Room Mappings — group full/partial classification', () => {
  function isFull(group: Group, availableSourceCount: number): boolean {
    return group.members.length >= availableSourceCount && availableSourceCount > 0;
  }

  const member = (source: string, status: 'manual' | 'ai' = 'manual'): Member => ({
    memberId: Math.random(), groupId: 1, source, roomNameId: Math.random(),
    roomName: source, memberStatus: status, confidence: null,
  });

  it('classifies a group with a member for every available source as full', () => {
    const group: Group = { groupId: 1, hotelId: 1, source: 'manual', confidence: null, members: [member('amello'), member('booking')] };
    expect(isFull(group, 2)).toBe(true);
  });

  it('classifies a group with fewer members than available sources as partial', () => {
    const group: Group = { groupId: 1, hotelId: 1, source: 'manual', confidence: null, members: [member('amello')] };
    expect(isFull(group, 3)).toBe(false);
  });

  it('a 1-member group is a valid partial group, not full, when more sources exist', () => {
    const group: Group = { groupId: 1, hotelId: 1, source: 'manual', confidence: null, members: [member('amello')] };
    expect(isFull(group, 2)).toBe(false);
    expect(group.members.length).toBe(1); // still persists as a valid group
  });
});

describe('Room Mappings — AI suggestion apply-target resolution', () => {
  // Mirrors the attach-vs-create decision in the page's runAiAll(): if one side
  // of a suggested pair is already grouped, attach to that group; if neither
  // side is grouped, create a new group with both members as AI-pending.
  type Suggestion = { sourceA: string; sourceB: string; roomNameIdA: number; roomNameIdB: number };

  function resolveApplyTarget(groups: Group[], s: Suggestion) {
    const groupWithA = groups.find(g => g.members.some(m => m.roomNameId === s.roomNameIdA));
    const groupWithB = groups.find(g => g.members.some(m => m.roomNameId === s.roomNameIdB));

    if (groupWithA && !groupWithA.members.some(m => m.source === s.sourceB)) {
      return { action: 'attach', groupId: groupWithA.groupId, addSource: s.sourceB, addRoomNameId: s.roomNameIdB };
    }
    if (groupWithB && !groupWithB.members.some(m => m.source === s.sourceA)) {
      return { action: 'attach', groupId: groupWithB.groupId, addSource: s.sourceA, addRoomNameId: s.roomNameIdA };
    }
    if (!groupWithA && !groupWithB) {
      return { action: 'create' };
    }
    return { action: 'skip' };
  }

  const member = (source: string, roomNameId: number): Member => ({
    memberId: Math.random(), groupId: 1, source, roomNameId, roomName: source, memberStatus: 'manual', confidence: null,
  });

  it('creates a new group when neither side is already grouped', () => {
    const result = resolveApplyTarget([], { sourceA: 'amello', sourceB: 'booking', roomNameIdA: 1, roomNameIdB: 2 });
    expect(result.action).toBe('create');
  });

  it('attaches to the existing group when side A is already grouped', () => {
    const groups: Group[] = [{ groupId: 5, hotelId: 1, source: 'manual', confidence: null, members: [member('amello', 1)] }];
    const result = resolveApplyTarget(groups, { sourceA: 'amello', sourceB: 'booking', roomNameIdA: 1, roomNameIdB: 2 });
    expect(result).toEqual({ action: 'attach', groupId: 5, addSource: 'booking', addRoomNameId: 2 });
  });

  it('attaches to the existing group when side B is already grouped', () => {
    const groups: Group[] = [{ groupId: 7, hotelId: 1, source: 'manual', confidence: null, members: [member('booking', 2)] }];
    const result = resolveApplyTarget(groups, { sourceA: 'amello', sourceB: 'booking', roomNameIdA: 1, roomNameIdB: 2 });
    expect(result).toEqual({ action: 'attach', groupId: 7, addSource: 'amello', addRoomNameId: 1 });
  });

  it('skips when the target group already has a member from the source being added', () => {
    const groups: Group[] = [{ groupId: 5, hotelId: 1, source: 'manual', confidence: null, members: [member('amello', 1), member('booking', 99)] }];
    const result = resolveApplyTarget(groups, { sourceA: 'amello', sourceB: 'booking', roomNameIdA: 1, roomNameIdB: 2 });
    expect(result.action).toBe('skip');
  });
});
