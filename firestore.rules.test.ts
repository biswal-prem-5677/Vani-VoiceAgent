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

test('Firestore Rules: Enforces global default-deny and verified identity invariants', () => {
  assert.ok(rulesText.includes("rules_version = '2';"), 'Rules version must be v2');
  assert.ok(
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;/.test(rulesText),
    'Global default-deny net must exist'
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

test('Firestore Rules: Every blueprint collection is governed by strict rules and schema validators', () => {
  const blueprintPaths = Object.keys(blueprint.firestore);
  assert.strictEqual(blueprintPaths.length, 9, 'Expected 9 collections in firebase-blueprint.json');

  for (const collectionPath of blueprintPaths) {
    assert.ok(
      rulesText.includes(`match ${collectionPath}`),
      `Missing match block in firestore.rules for blueprint collection ${collectionPath}`
    );
  }
});

test('Firestore Rules: Dirty Dozen adversarial protections exist', () => {
  // No self-elevation to super_admin on user create
  assert.ok(
    rulesText.includes("incoming().role == 'caller' && incoming().revoked == false"),
    'User self-create must restrict role to caller and revoked to false'
  );

  // Strict schema checks (hasAll / hasOnly) preventing ghost fields
  assert.ok(rulesText.includes('.keys().hasAll('), 'Schema must enforce required keys');
  assert.ok(rulesText.includes('.keys().hasOnly('), 'Schema must enforce exact field allowlist');

  // Server request.time & immutable createdAt/ownerUid checks
  assert.ok(rulesText.includes('incoming().createdAt == request.time'), 'Must enforce server request.time on create');
  assert.ok(rulesText.includes('incoming().createdAt == existing().createdAt'), 'Must lock createdAt immutability');
  assert.ok(rulesText.includes('incoming().ownerUid == existing().ownerUid'), 'Must lock ownerUid immutability');

  // Terminal state locking
  assert.ok(rulesText.includes("existing().status != 'resolved'"), 'Handoff updates must block resolved tickets');
  assert.ok(rulesText.includes("existing().status != 'cancelled'"), 'Appointment updates must block cancelled slots');

  // Append-only audit logs
  assert.ok(
    /match \/auditLogs\/\{logId\}[\s\S]*?allow update, delete: if false;/.test(rulesText),
    'Audit logs must be immutable append-only'
  );
});
