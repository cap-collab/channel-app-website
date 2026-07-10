import { describe, it, expect } from 'vitest';
import { isDJ, isBroadcaster, type UserRole } from './useUserRole';

// Regression guard for the collective-owner feature. Collective rights live on a
// SEPARATE axis (ownedCollectiveSlugs + collectiveTermsAcceptedAt) and must never
// change how `role` is read. These tests lock in the DJ-only role behavior so a
// future collective change that accidentally touches the role helpers fails here.

describe('isDJ — role-only, unaffected by collective ownership', () => {
  it('grants DJ access to dj / broadcaster / admin', () => {
    expect(isDJ('dj')).toBe(true);
    expect(isDJ('broadcaster')).toBe(true);
    expect(isDJ('admin')).toBe(true);
  });

  it('denies DJ access to plain user / null', () => {
    expect(isDJ('user')).toBe(false);
    expect(isDJ(null)).toBe(false);
  });

  it('is a pure function of role — a collective-only owner is role:user, so still not a DJ', () => {
    // A collective owner who is NOT a DJ has role 'user'. isDJ must stay false
    // for them; collective rights are checked separately, never through isDJ.
    const collectiveOnlyOwnerRole: UserRole = 'user';
    expect(isDJ(collectiveOnlyOwnerRole)).toBe(false);
  });
});

describe('isBroadcaster — role-only', () => {
  it('grants to broadcaster / admin only', () => {
    expect(isBroadcaster('broadcaster')).toBe(true);
    expect(isBroadcaster('admin')).toBe(true);
    expect(isBroadcaster('dj')).toBe(false);
    expect(isBroadcaster('user')).toBe(false);
    expect(isBroadcaster(null)).toBe(false);
  });
});
