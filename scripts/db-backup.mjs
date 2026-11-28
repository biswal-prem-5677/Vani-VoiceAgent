import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function printUsage() {
  console.log('Usage:');
  console.log('  node scripts/db-backup.mjs backup [output-file.db]');
  console.log('  node scripts/db-backup.mjs restore <backup-file.db>');
}

const [, , command = 'backup', targetArg] = process.argv;
const configuredDataDir = process.env.DATA_DIR?.trim();
const dataDir = configuredDataDir ? path.resolve(configuredDataDir) : path.resolve(process.cwd(), 'data');
const liveDbPath = path.join(dataDir, 'vanivoice.db');

if (command === 'backup') {
  if (!fs.existsSync(liveDbPath)) {
    console.error(`Source database not found at ${liveDbPath}. Start the server once to initialize it.`);
    process.exit(1);
  }

  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = targetArg
    ? path.resolve(process.cwd(), targetArg)
    : path.join(backupDir, `vanivoice-${stamp}.db`);

  if (fs.existsSync(outPath)) {
    fs.unlinkSync(outPath);
  }

  const db = new DatabaseSync(liveDbPath);
  try {
    const escapedPath = outPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedPath}'`);
    const stats = fs.statSync(outPath);
    console.log(JSON.stringify({ ok: true, action: 'backup', backupPath: outPath, bytes: stats.size }));
  } finally {
    db.close();
  }
} else if (command === 'restore') {
  if (!targetArg) {
    printUsage();
    process.exit(1);
  }
  const sourceBackup = path.resolve(process.cwd(), targetArg);
  if (!fs.existsSync(sourceBackup)) {
    console.error(`Backup file not found: ${sourceBackup}`);
    process.exit(1);
  }

  // Validate integrity of backup before overwriting live DB
  const checkDb = new DatabaseSync(sourceBackup);
  try {
    const row = checkDb.prepare('PRAGMA integrity_check').get();
    if (!row || row.integrity_check !== 'ok') {
      console.error('Integrity check failed on backup file:', row);
      process.exit(1);
    }
  } finally {
    checkDb.close();
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const safetyCopy = path.join(dataDir, `vanivoice.pre-restore-${Date.now()}.db`);
  if (fs.existsSync(liveDbPath)) {
    fs.copyFileSync(liveDbPath, safetyCopy);
  }
  fs.copyFileSync(sourceBackup, liveDbPath);
  console.log(
    JSON.stringify({
      ok: true,
      action: 'restore',
      restoredFrom: sourceBackup,
      liveDbPath,
      previousSafetyCopy: fs.existsSync(safetyCopy) ? safetyCopy : null,
    })
  );
} else {
  printUsage();
  process.exit(1);
}
