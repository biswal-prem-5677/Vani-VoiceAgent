import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';

const REPO_ROOT = process.cwd();
const SERVER_ENTRY = path.join(REPO_ROOT, 'server.ts');

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Could not determine free port')));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl: string, proc: ChildProcess, stderrChunks: string[]): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Server exited prematurely (${proc.exitCode}): ${stderrChunks.join('')}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // retry until healthy
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for server health: ${stderrChunks.join('')}`);
}

function makeTempWorkdir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanivoice-int-'));
  // Ensure dist/index.html exists for non-dev mode fallback checks
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<!doctype html><html><body>ok</body></html>');
  return dir;
}

test('Integration: Production mode fails fast when SESSION_SECRET or admin protection is missing', async () => {
  const workdir = makeTempWorkdir();
  const port = await getFreePort();

  try {
    const proc = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: workdir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        SESSION_SECRET: '',
        ADMIN_PASSCODE: '',
        ADMIN_BOOTSTRAP_TOKEN: '',
        GEMINI_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderrChunks: string[] = [];
    proc.stderr?.on('data', d => stderrChunks.push(d.toString()));

    const exitCode: number | null = await new Promise(resolve => {
      proc.on('exit', code => resolve(code));
    });

    assert.notStrictEqual(exitCode, 0, 'Production startup without secrets must exit non-zero');
    const errText = stderrChunks.join('');
    assert.ok(errText.includes('SESSION_SECRET'), 'Stderr must explain missing SESSION_SECRET');
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('Integration: Production server boots with bootstrap token, enforces clinic slot durability, and deletes full session scope', async () => {
  const workdir = makeTempWorkdir();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const sessionSecret = '0123456789abcdef0123456789abcdef0123456789abcdef';
  const bootstrapToken = 'boot-token-integration-987654';

  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: workdir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      SESSION_SECRET: sessionSecret,
      ADMIN_BOOTSTRAP_TOKEN: bootstrapToken,
      ADMIN_PASSCODE: '',
      GEMINI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrChunks: string[] = [];
  proc.stderr?.on('data', d => stderrChunks.push(d.toString()));

  try {
    await waitForHealth(baseUrl, proc, stderrChunks);

    // 1. Verify /api/session advertises bootstrapRequiresToken and X-Trace-Id header
    const sessionRes = await fetch(`${baseUrl}/api/session`);
    assert.strictEqual(sessionRes.status, 200);
    assert.ok(sessionRes.headers.get('x-trace-id'), 'Every response must include X-Trace-Id');
    const sessionJson = (await sessionRes.json()) as any;
    assert.strictEqual(sessionJson.adminBootstrapNeeded, true);
    assert.strictEqual(sessionJson.bootstrapRequiresToken, true);
    assert.strictEqual(sessionJson.retentionPolicy.safetyTicketDays, 30);
    assert.strictEqual(sessionJson.retentionPolicy.supportTicketDays, 90);

    // 2. Verify bootstrap rejects wrong/missing token and accepts valid token
    const badBoot = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lead Admin',
        email: 'lead@clinic.org',
        password: 'StrongPassword123!',
        bootstrapToken: 'wrong-token',
      }),
    });
    assert.strictEqual(badBoot.status, 403);

    const goodBoot = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lead Admin',
        email: 'lead@clinic.org',
        password: 'StrongPassword123!',
        bootstrapToken,
      }),
    });
    assert.strictEqual(goodBoot.status, 201);
    const adminAuth = (await goodBoot.json()) as any;
    assert.ok(adminAuth.token);

    // 3. Create Caller Session
    const callerRes = await fetch(`${baseUrl}/api/auth/caller-session`, { method: 'POST' });
    assert.strictEqual(callerRes.status, 201);
    const callerAuth = (await callerRes.json()) as any;
    const callerHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${callerAuth.token}`,
    };

    // 4. Booking step 1: request booking at 10:00 AM -> creates pending_actions with immutable actionId
    const turn1 = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Book appointment with Dr. Jena at 10:00 AM. My name is Priya',
        language: 'en',
        demoMode: true,
      }),
    });
    assert.strictEqual(turn1.status, 200);
    const turn1Data = (await turn1.json()) as any;
    assert.strictEqual(turn1Data.toolCalls?.[0]?.result?.requiresConfirmation, true);
    const actionId1 = turn1Data.toolCalls[0].result.data.actionId;
    assert.ok(actionId1.startsWith('act_'));
    assert.strictEqual(turn1Data.memoryUpdates.pendingActionId, actionId1);

    // 5. Tamper check: attempt to confirm while changing slot to 11:30 AM -> must NOT confirm 11:30 AM directly
    const tamperTurn = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Yes confirm for 11:30 AM instead',
        language: 'en',
        memory: turn1Data.memoryUpdates,
        demoMode: true,
      }),
    });
    assert.strictEqual(tamperTurn.status, 200);
    const tamperData = (await tamperTurn.json()) as any;
    assert.strictEqual(tamperData.toolCalls?.[0]?.result?.requiresConfirmation, true);
    assert.strictEqual(tamperData.toolCalls?.[0]?.result?.data?.bookingRef, undefined);
    assert.notStrictEqual(tamperData.toolCalls?.[0]?.result?.data?.actionId, actionId1);

    // 6. Valid confirmation for original 10:00 AM parameters -> confirms and persists appointment
    const confirmTurn = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Yes confirm please',
        language: 'en',
        memory: turn1Data.memoryUpdates,
        idempotencyKey: 'idem-confirm-1',
        demoMode: true,
      }),
    });
    assert.strictEqual(confirmTurn.status, 200);
    const confirmData = (await confirmTurn.json()) as any;
    assert.strictEqual(confirmData.toolCalls?.[0]?.result?.success, true);
    const bookingRef = confirmData.toolCalls?.[0]?.result?.data?.bookingRef;
    assert.ok(bookingRef.startsWith('KAL-APT-'));

    // 7. Idempotent retry returns same bookingRef cleanly
    const retryTurn = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Yes confirm please',
        language: 'en',
        memory: turn1Data.memoryUpdates,
        idempotencyKey: 'idem-confirm-1',
        demoMode: true,
      }),
    });
    const retryData = (await retryTurn.json()) as any;
    assert.strictEqual(retryData.toolCalls?.[0]?.result?.data?.bookingRef, bookingRef);

    // 8. Check slot availability for Dr. Jena -> 10:00 AM is no longer available
    const slotCheck = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'What is Dr. Jena OPD timing today?',
        language: 'en',
        demoMode: true,
      }),
    });
    const slotData = (await slotCheck.json()) as any;
    const availableSlots: string[] = slotData.toolCalls?.[0]?.result?.data?.availableSlots || [];
    assert.ok(!availableSlots.includes('10:00 AM'), 'Booked slot 10:00 AM must be removed from open slots');
    assert.ok(availableSlots.includes('11:30 AM'));

    // 9. Second caller attempts double booking on 10:00 AM -> rejected gracefully with conflict
    const caller2Res = await fetch(`${baseUrl}/api/auth/caller-session`, { method: 'POST' });
    const caller2Auth = (await caller2Res.json()) as any;
    const caller2Headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${caller2Auth.token}`,
    };
    const c2Step1 = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: caller2Headers,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Book appointment with Dr. Jena at 10:00 AM. My name is Rohan',
        language: 'en',
        demoMode: true,
      }),
    });
    const c2Step1Data = (await c2Step1.json()) as any;
    const c2Confirm = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: caller2Headers,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Yes confirm',
        language: 'en',
        memory: c2Step1Data.memoryUpdates,
        demoMode: true,
      }),
    });
    const c2ConfirmData = (await c2Confirm.json()) as any;
    assert.strictEqual(c2ConfirmData.toolCalls?.[0]?.result?.success, false);
    assert.strictEqual(c2ConfirmData.toolCalls?.[0]?.result?.data?.conflict, true);

    // 10. Admin lists appointments & audit logs, cancels appointment -> slot 10:00 AM reopens
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    };
    const apptsRes = await fetch(`${baseUrl}/api/appointments`, { headers: adminHeaders });
    assert.strictEqual(apptsRes.status, 200);
    const appts = (await apptsRes.json()) as any[];
    assert.strictEqual(appts.length, 1);
    assert.strictEqual(appts[0].id, bookingRef);

    const cancelRes = await fetch(`${baseUrl}/api/appointments/${bookingRef}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'cancelled' }),
    });
    assert.strictEqual(cancelRes.status, 200);

    const slotCheckAfterCancel = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'What is Dr. Jena OPD timing today?',
        language: 'en',
        demoMode: true,
      }),
    });
    const slotAfterCancelData = (await slotCheckAfterCancel.json()) as any;
    assert.ok(slotAfterCancelData.toolCalls?.[0]?.result?.data?.availableSlots.includes('10:00 AM'));

    const auditRes = await fetch(`${baseUrl}/api/audit-logs`, { headers: adminHeaders });
    assert.strictEqual(auditRes.status, 200);
    const auditLogs = (await auditRes.json()) as any[];
    assert.ok(auditLogs.some(e => e.action === 'appointment.booked'));
    assert.ok(auditLogs.some(e => e.action === 'appointment.updated'));

    // 11. Complete Privacy Story: create caller handoff ticket & support ticket, then DELETE /api/session/data
    await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'My father has severe chest pain!',
        language: 'en',
        demoMode: true,
      }),
    });

    await fetch(`${baseUrl}/api/support/ticket`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        name: 'Priya',
        email: 'priya@example.com',
        subject: 'Follow-up',
        message: 'Testing session privacy deletion',
        tenantId: 'kalinga_clinic',
      }),
    });

    const handoffsBefore = (await (await fetch(`${baseUrl}/api/handoffs`, { headers: adminHeaders })).json()) as any[];
    assert.ok(handoffsBefore.some(h => h.sessionId === callerAuth.user.sessionId));

    const delRes = await fetch(`${baseUrl}/api/session/data`, {
      method: 'DELETE',
      headers: callerHeaders,
    });
    assert.strictEqual(delRes.status, 200);
    const delJson = (await delRes.json()) as any;
    assert.ok(delJson.deleted.handoffTickets >= 1);
    assert.ok(delJson.deleted.supportTickets >= 1);
    assert.ok(delJson.deleted.appointments >= 1);

    const handoffsAfter = (await (await fetch(`${baseUrl}/api/handoffs`, { headers: adminHeaders })).json()) as any[];
    assert.strictEqual(
      handoffsAfter.some(h => h.sessionId === callerAuth.user.sessionId),
      false,
      'Caller handoff tickets must be deleted by DELETE /api/session/data'
    );
  } finally {
    proc.kill('SIGTERM');
    await new Promise(resolve => proc.once('exit', resolve));
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});
