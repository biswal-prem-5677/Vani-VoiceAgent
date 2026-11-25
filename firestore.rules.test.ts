import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const BLUEPRINT_PATH = path.resolve(process.cwd(), 'firebase-blueprint.json');

const rulesText = fs.readFileSync(RULES_PATH, 'utf8');
const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8')) as {
  entities: Record<string, any>;
  firestore: Record<string, { schema?: { $ref?: string }; description?: string }>;
};

test('Firestore Rules: Enforces global default-deny, zero hardcoded emails, and verified identity', () => {
  assert.ok(rulesText.includes("rules_version = '2';"), 'Rules version must be v2');
  assert.ok(
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;/.test(rulesText),
    'Global default-deny net must exist'
  );
  assert.ok(
    !rulesText.includes('@gmail.com') && !rulesText.includes('priyabratabiswal'),
    'Security rules must NEVER hardcode personal email addresses'
  );
  assert.ok(
    rulesText.includes('request.auth.token.email_verified == true'),
    'Must enforce verified email identity'
  );
  assert.ok(rulesText.includes('function isValidId(id)'), 'Must validate document ID bounds and charset');
  assert.ok(
    rulesText.includes("id.matches('^[a-zA-Z0-9_\\\\-]+$')"),
    'isValidId must enforce safe path-traversal-free characters'
  );
});

test('Firestore Rules: Blueprint collections are strictly governed and operational PII stays off client Firestore', () => {
  const blueprintPaths = Object.keys(blueprint.firestore);
  assert.deepStrictEqual(
    blueprintPaths.sort(),
    ['/admins/{uid}', '/tenants/{tenantId}', '/users/{uid}'],
    'Firestore blueprint must only store identity/RBAC/tenant metadata; operational PII stays in SQLite'
  );

  for (const collectionPath of blueprintPaths) {
    assert.ok(
      rulesText.includes(`match ${collectionPath}`),
      `Missing match block in firestore.rules for blueprint collection ${collectionPath}`
    );
  }

  for (const forbidden of ['/callSessions/', '/handoffs/', '/appointments/', '/integrations/']) {
    assert.ok(
      !rulesText.includes(forbidden),
      `Operational PII collection ${forbidden} must not be exposed to client Firestore rules`
    );
  }
});

test('Firestore Rules: Strict Super-Admin vs Tenant-Admin RBAC separation & tenant isolation', () => {
  // Admins collection must NOT allow any generic isAdmin() write; only isSuperAdmin() can elevate/manage admins
  assert.ok(rulesText.includes('function isSuperAdmin()'), 'Must distinguish super_admin from tenant_admin');
  assert.ok(
    rulesText.includes('function hasTenantAccess(tenantId)') &&
      rulesText.includes('tenantId in adminData().allowedTenants'),
    'Must enforce tenant_admin access strictly via allowedTenants list'
  );

  assert.ok(
    /match \/admins\/\{uid\}[\s\S]*?allow create: if isValidId\(uid\) && isSuperAdmin\(\)/.test(rulesText),
    'Only super_admin may create or elevate /admins entries'
  );
  assert.ok(
    /match \/admins\/\{uid\}[\s\S]*?allow update: if isValidId\(uid\) && isSuperAdmin\(\)/.test(rulesText),
    'Only super_admin may update /admins entries'
  );

  // Tenants must NOT allow open get/list to any verified user
  assert.ok(
    !/match \/tenants\/\{tenantId\}[\s\S]*?allow get:\s*if isValidId\(tenantId\) && isVerifiedUser\(\)/.test(rulesText),
    'Verified callers must NEVER be able to arbitrarily get tenant documents'
  );
  assert.ok(
    !/match \/tenants\/\{tenantId\}[\s\S]*?allow list:\s*if isVerifiedUser\(\);/.test(rulesText),
    'Verified callers must NEVER be able to list all tenants'
  );
  assert.ok(
    /match \/tenants\/\{tenantId\}[\s\S]*?allow get: if isValidId\(tenantId\) && hasTenantAccess\(tenantId\)/.test(
      rulesText
    ),
    'Tenant get must be restricted to hasTenantAccess(tenantId)'
  );
  assert.ok(
    /match \/tenants\/\{tenantId\}[\s\S]*?resource\.data\.memberUids\[request\.auth\.uid\] == true/.test(rulesText),
    'Tenant list must be scoped to memberUids map membership or super_admin'
  );

  // User self-signup locked to caller + non-revoked
  assert.ok(
    rulesText.includes("incoming().role == 'caller' && incoming().revoked == false"),
    'User self-create must restrict role to caller and revoked to false'
  );
  assert.ok(rulesText.includes('.keys().hasAll('), 'Schema must enforce required keys');
  assert.ok(rulesText.includes('.keys().hasOnly('), 'Schema must enforce exact field allowlist');
  assert.ok(rulesText.includes('incoming().ownerUid == existing().ownerUid'), 'Must lock ownerUid immutability');
});
