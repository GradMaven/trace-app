import { describe, expect, it } from 'vitest';
import {
  applyScimGroupPatch,
  applyScimUserPatch,
  generateScimToken,
  normalizeScimPatch,
  parseScimFilter,
  parseScimGroup,
  parseScimUser,
  resolveScimRoleKeys,
  scimError,
  scimListResponse,
  scimManagedRoleKeys,
  scimPaginationParams,
  scimTokenMatches,
  scimUserResource,
  type ScimUserModel,
} from './scim';

const baseUser: ScimUserModel = {
  id: 'u1',
  externalId: 'ext-1',
  userName: 'ada@acme.test',
  active: true,
  givenName: 'Ada',
  familyName: 'Lovelace',
  displayName: 'Ada Lovelace',
  primaryEmail: 'ada@acme.test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('SCIM token', () => {
  it('generates a prefixed token and verifies in constant time', () => {
    const t = generateScimToken();
    expect(t.token.startsWith('scim_')).toBe(true);
    expect(t.prefix).toBe(t.token.slice(0, 12));
    expect(scimTokenMatches(t.token, t.hash)).toBe(true);
    expect(scimTokenMatches(t.token + 'x', t.hash)).toBe(false);
    expect(scimTokenMatches('scim_other', t.hash)).toBe(false);
  });
});

describe('parseScimUser', () => {
  it('requires userName and derives the primary email', () => {
    expect(parseScimUser({})).toEqual({ error: 'userName is required' });
    const p = parseScimUser({
      userName: 'ada@acme.test',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
      emails: [
        { value: 'alt@acme.test', primary: false },
        { value: 'ada@acme.test', primary: true },
      ],
    });
    expect(p).toMatchObject({
      userName: 'ada@acme.test',
      active: true,
      givenName: 'Ada',
      primaryEmail: 'ada@acme.test',
    });
  });
  it('defaults active to true and falls back to userName for email', () => {
    const p = parseScimUser({ userName: 'bob@acme.test' });
    expect(p).toMatchObject({ active: true, primaryEmail: 'bob@acme.test' });
  });
});

describe('parseScimGroup', () => {
  it('requires displayName and dedupes member ids', () => {
    expect(parseScimGroup({ members: [] })).toEqual({ error: 'displayName is required' });
    expect(
      parseScimGroup({
        displayName: 'Admins',
        members: [{ value: 'u1' }, { value: 'u2' }, { value: 'u1' }],
      }),
    ).toEqual({ displayName: 'Admins', externalId: null, memberIds: ['u1', 'u2'] });
  });
});

describe('normalizeScimPatch', () => {
  it('rejects an empty or malformed op set', () => {
    expect(normalizeScimPatch({ Operations: [] })).toEqual({
      error: 'Operations must be a non-empty array',
    });
    expect(normalizeScimPatch({ Operations: [{ op: 'frobnicate' }] })).toMatchObject({
      error: /unsupported op/,
    });
    expect(normalizeScimPatch({ Operations: [{ op: 'remove' }] })).toMatchObject({
      error: /requires a path/,
    });
  });
  it('lowercases the op and keeps path + value', () => {
    expect(
      normalizeScimPatch({ Operations: [{ op: 'Replace', path: 'active', value: false }] }),
    ).toEqual({ operations: [{ op: 'replace', path: 'active', value: false }] });
  });
});

describe('applyScimUserPatch', () => {
  it('toggles active, replaces name parts, and merges a no-path object', () => {
    const deactivated = applyScimUserPatch(baseUser, [
      { op: 'replace', path: 'active', value: false },
    ]);
    expect(deactivated.active).toBe(false);

    const renamed = applyScimUserPatch(baseUser, [
      { op: 'replace', path: 'name.givenName', value: 'Augusta' },
      { op: 'replace', path: 'displayName', value: 'Augusta Ada King' },
    ]);
    expect(renamed.givenName).toBe('Augusta');
    expect(renamed.displayName).toBe('Augusta Ada King');

    const merged = applyScimUserPatch(baseUser, [
      { op: 'replace', value: { active: false, emails: [{ value: 'NEW@acme.test', primary: true }] } },
    ]);
    expect(merged).toMatchObject({ active: false, primaryEmail: 'new@acme.test' });
  });
  it('ignores unknown paths', () => {
    expect(applyScimUserPatch(baseUser, [{ op: 'replace', path: 'title', value: 'x' }])).toEqual(
      baseUser,
    );
  });
});

describe('applyScimGroupPatch', () => {
  const state = { displayName: 'Admins', externalId: null, memberIds: ['a', 'b'] };
  it('adds, removes, replaces members and renames', () => {
    expect(applyScimGroupPatch(state, [{ op: 'add', path: 'members', value: [{ value: 'c' }] }]))
      .toMatchObject({ memberIds: ['a', 'b', 'c'] });
    expect(
      applyScimGroupPatch(state, [{ op: 'remove', path: 'members[value eq "a"]' }]),
    ).toMatchObject({ memberIds: ['b'] });
    expect(
      applyScimGroupPatch(state, [{ op: 'replace', path: 'members', value: [{ value: 'z' }] }]),
    ).toMatchObject({ memberIds: ['z'] });
    expect(
      applyScimGroupPatch(state, [{ op: 'replace', path: 'displayName', value: 'Owners' }]),
    ).toMatchObject({ displayName: 'Owners' });
  });
});

describe('serialisers', () => {
  it('scimUserResource has schema, meta and a work email', () => {
    const r = scimUserResource(baseUser, { baseUrl: 'https://x/scim/v2/acme' });
    expect(r.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:User']);
    expect((r.meta as { location: string }).location).toBe('https://x/scim/v2/acme/Users/u1');
    expect(r.emails).toEqual([{ value: 'ada@acme.test', primary: true, type: 'work' }]);
    expect(r.active).toBe(true);
  });
  it('scimListResponse + scimError shapes', () => {
    const list = scimListResponse([{ id: '1' }], { totalResults: 5, startIndex: 1 });
    expect(list).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 5,
      itemsPerPage: 1,
      Resources: [{ id: '1' }],
    });
    expect(scimError(404, 'gone', 'noTarget')).toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '404',
      scimType: 'noTarget',
      detail: 'gone',
    });
  });
});

describe('filter + pagination', () => {
  it('parses `attr eq "value"` and rejects richer grammar', () => {
    expect(parseScimFilter('userName eq "ada@acme.test"')).toEqual({
      attribute: 'userName',
      operator: 'eq',
      value: 'ada@acme.test',
    });
    expect(parseScimFilter('userName sw "ada"')).toBeNull();
    expect(parseScimFilter(undefined)).toBeNull();
  });
  it('clamps count and floors startIndex', () => {
    expect(scimPaginationParams({ startIndex: '0', count: '9999' })).toEqual({
      startIndex: 1,
      count: 200,
    });
    expect(scimPaginationParams({ count: '0' })).toEqual({ startIndex: 1, count: 0 });
    expect(scimPaginationParams({})).toEqual({ startIndex: 1, count: 100 });
  });
});

describe('role resolution', () => {
  const mapping = { 'TRACE Admins': ['organization_admin'], Sustainability: ['sustainability_manager'] };
  it('unions default + group roles and reports the managed set', () => {
    expect(
      resolveScimRoleKeys(['esg_analyst'], mapping, ['TRACE Admins', 'Unmapped']).sort(),
    ).toEqual(['esg_analyst', 'organization_admin']);
    expect(scimManagedRoleKeys(['esg_analyst'], mapping).sort()).toEqual([
      'esg_analyst',
      'organization_admin',
      'sustainability_manager',
    ]);
  });
});
