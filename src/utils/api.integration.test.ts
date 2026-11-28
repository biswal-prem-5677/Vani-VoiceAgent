import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { verifyWebhookSignature } from './externalIntegration.ts';

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

async function pollWebhookDelivery(
  baseUrl: string,
  adminHeaders: Record<string, string>,
  predicate: (delivery: any) => boolean,
  timeoutMs = 5000
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/integrations`, { headers: adminHeaders });
    if (res.ok) {
      const deliveries = (await res.json()) as any[];
      const match = deliveries.find(predicate);
      if (match) return match;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for matching webhook delivery record');
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
    assert.strictEqual(sessionJson.modelUsed, undefined, 'Unauthenticated /api/session must omit modelUsed');

    // Verify weak password (< 12 chars) rejected on bootstrap
    const weakBoot = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lead Admin',
        email: 'lead@clinic.org',
        password: 'short',
        bootstrapToken,
      }),
    });
    assert.strictEqual(weakBoot.status, 400);

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

    // Bootstrap stays permanently locked once completed
    const repeatBoot = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Rogue Admin',
        email: 'rogue@clinic.org',
        password: 'StrongPassword123!',
        bootstrapToken,
      }),
    });
    assert.strictEqual(repeatBoot.status, 409);

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

    // 12. Concurrent double-booking race on 04:00 PM -> exactly 1 succeeds and 1 gets conflict
    const raceCallerA = (await (await fetch(`${baseUrl}/api/auth/caller-session`, { method: 'POST' })).json()) as any;
    const raceCallerB = (await (await fetch(`${baseUrl}/api/auth/caller-session`, { method: 'POST' })).json()) as any;
    const raceHeadersA = { 'Content-Type': 'application/json', Authorization: `Bearer ${raceCallerA.token}` };
    const raceHeadersB = { 'Content-Type': 'application/json', Authorization: `Bearer ${raceCallerB.token}` };

    const [raceStep1A, raceStep1B] = await Promise.all([
      fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: raceHeadersA,
        body: JSON.stringify({
          tenantId: 'kalinga_clinic',
          userText: 'Book appointment with Dr. Jena at 04:00 PM. My name is Suman',
          language: 'en',
          demoMode: true,
        }),
      }).then(r => r.json() as Promise<any>),
      fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: raceHeadersB,
        body: JSON.stringify({
          tenantId: 'kalinga_clinic',
          userText: 'Book appointment with Dr. Jena at 04:00 PM. My name is Vikram',
          language: 'en',
          demoMode: true,
        }),
      }).then(r => r.json() as Promise<any>),
    ]);

    const [raceConfirmA, raceConfirmB] = await Promise.all([
      fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: raceHeadersA,
        body: JSON.stringify({
          tenantId: 'kalinga_clinic',
          userText: 'Yes confirm please',
          language: 'en',
          memory: raceStep1A.memoryUpdates,
          demoMode: true,
        }),
      }).then(r => r.json() as Promise<any>),
      fetch(`${baseUrl}/api/turn`, {
        method: 'POST',
        headers: raceHeadersB,
        body: JSON.stringify({
          tenantId: 'kalinga_clinic',
          userText: 'Yes confirm please',
          language: 'en',
          memory: raceStep1B.memoryUpdates,
          demoMode: true,
        }),
      }).then(r => r.json() as Promise<any>),
    ]);

    const raceResults = [raceConfirmA.toolCalls?.[0]?.result, raceConfirmB.toolCalls?.[0]?.result];
    const winners = raceResults.filter(r => r?.success === true);
    const losers = raceResults.filter(r => r?.success === false && r?.data?.conflict === true);
    assert.strictEqual(winners.length, 1, 'Exactly one concurrent caller must win the 04:00 PM slot');
    assert.strictEqual(losers.length, 1, 'Exactly one concurrent caller must receive slot conflict');

    // 13. Unknown API route must return 404 JSON rather than SPA index.html
    const missingApiRes = await fetch(`${baseUrl}/api/nonexistent-endpoint-check`);
    assert.strictEqual(missingApiRes.status, 404);
    const missingApiJson = (await missingApiRes.json()) as any;
    assert.ok(missingApiJson.error);

    // 14. Tenant SSRF validation rejects embedded credentials & metadata IPs in production
    const tenantCfg = (await (await fetch(`${baseUrl}/api/tenants/kalinga_clinic`, { headers: adminHeaders })).json()) as any;
    const ssrfMetaRes = await fetch(`${baseUrl}/api/tenants/kalinga_clinic`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        ...tenantCfg,
        webhookConfig: {
          enabled: true,
          url: 'https://169.254.169.254/latest/meta-data',
          providerType: 'clinic_ehr_webhook',
        },
      }),
    });
    assert.strictEqual(ssrfMetaRes.status, 400);

    const ssrfCredsRes = await fetch(`${baseUrl}/api/tenants/kalinga_clinic`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        ...tenantCfg,
        webhookConfig: {
          enabled: true,
          url: 'https://user:pass@ehr.example.com/webhook',
          providerType: 'clinic_ehr_webhook',
        },
      }),
    });
    assert.strictEqual(ssrfCredsRes.status, 400);
  } finally {
    proc.kill('SIGTERM');
    await new Promise(resolve => proc.once('exit', resolve));
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('Integration: Outbound webhook dispatch retries failed attempts with HMAC signature, serves .ics invites, computes metrics, and enforces immediate user revocation', async () => {
  const workdir = makeTempWorkdir();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const sessionSecret = '0123456789abcdef0123456789abcdef0123456789abcdef';
  const bootstrapToken = 'boot-token-webhook-test-123';
  const webhookSecret = 'clinic-ehr-hmac-secret-999';

  // Local ephemeral EHR webhook receiver: fails 1st call (HTTP 500), succeeds 2nd call (HTTP 200) unless ?mode=fail
  let attemptsReceived = 0;
  let forceFail = false;
  const receivedEvents: { headers: http.IncomingHttpHeaders; body: string }[] = [];

  const webhookServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      attemptsReceived += 1;
      const body = Buffer.concat(chunks).toString('utf8');
      if (forceFail || attemptsReceived === 1) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'temporary upstream error' }));
        return;
      }
      receivedEvents.push({ headers: req.headers, body });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>(resolve => webhookServer.listen(0, '127.0.0.1', () => resolve()));
  const webhookAddr = webhookServer.address();
  const webhookPort = typeof webhookAddr === 'object' && webhookAddr ? webhookAddr.port : 0;
  const webhookUrl = `http://127.0.0.1:${webhookPort}/ehr-events`;

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
      ALLOW_LOCAL_WEBHOOKS: 'true',
      ALLOW_DEMO_WEBHOOKS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrChunks: string[] = [];
  proc.stderr?.on('data', d => stderrChunks.push(d.toString()));

  try {
    await waitForHealth(baseUrl, proc, stderrChunks);

    const bootRes = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Clinic Admin',
        email: 'admin@kalinga.org',
        password: 'StrongPassword123!',
        bootstrapToken,
      }),
    });
    const adminAuth = (await bootRes.json()) as any;
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    };

    // 1. Configure tenant webhook on kalinga_clinic
    const tenantRes = await fetch(`${baseUrl}/api/tenants/kalinga_clinic`, { headers: adminHeaders });
    const tenant = (await tenantRes.json()) as any;
    tenant.webhookConfig = {
      enabled: true,
      url: webhookUrl,
      providerType: 'clinic_ehr_webhook',
      secretHeaderName: 'X-VaniVoice-Signature',
      signingSecret: webhookSecret,
    };
    const saveRes = await fetch(`${baseUrl}/api/tenants/kalinga_clinic`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify(tenant),
    });
    assert.strictEqual(saveRes.status, 200);

    // 2. Book appointment as caller -> webhook auto-retries 500 -> 200 with valid HMAC signature
    const callerRes = await fetch(`${baseUrl}/api/auth/caller-session`, { method: 'POST' });
    const callerAuth = (await callerRes.json()) as any;
    const callerHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${callerAuth.token}`,
    };

    const step1 = (await (await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Book appointment with Dr. Jena at 11:30 AM. My name is Ananya',
        language: 'en',
        demoMode: true,
      }),
    })).json()) as any;

    const confirmRes = (await (await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Yes confirm please',
        language: 'en',
        memory: step1.memoryUpdates,
        demoMode: true,
      }),
    })).json()) as any;

    const bookingRef = confirmRes.toolCalls?.[0]?.result?.data?.bookingRef;
    assert.ok(bookingRef);

    // Webhook delivery on /api/turn is queued asynchronously; poll until terminal delivered status
    const deliveredBooking = await pollWebhookDelivery(
      baseUrl,
      adminHeaders,
      d => d.eventType === 'appointment.booked' && d.status === 'delivered'
    );
    assert.strictEqual(deliveredBooking.status, 'delivered');
    assert.ok(attemptsReceived >= 2, 'Expected automatic retry after HTTP 500');
    assert.strictEqual(receivedEvents.length, 1);
    const sigHeader = String(receivedEvents[0].headers['x-vanivoice-signature'] || '');
    assert.strictEqual(verifyWebhookSignature(webhookSecret, sigHeader, receivedEvents[0].body), true);

    // 3. Check .ics endpoint for owner vs unauthorized second caller
    const icsRes = await fetch(`${baseUrl}/api/appointments/${bookingRef}/calendar.ics`, { headers: callerHeaders });
    assert.strictEqual(icsRes.status, 200);
    const icsBody = await icsRes.text();
    assert.ok(icsBody.includes('BEGIN:VCALENDAR'));
    assert.ok(icsBody.includes(bookingRef));

    const otherCaller = (await (await fetch(`${baseUrl}/api/auth/caller-session`, { method: 'POST' })).json()) as any;
    const forbiddenIcs = await fetch(`${baseUrl}/api/appointments/${bookingRef}/calendar.ics`, {
      headers: { Authorization: `Bearer ${otherCaller.token}` },
    });
    assert.strictEqual(forbiddenIcs.status, 403);

    // 4. Test permanent webhook failure + manual Retry button endpoint
    forceFail = true;
    const emergencyTurn = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: callerHeaders,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Emergency chest pain help!',
        language: 'en',
        demoMode: true,
      }),
    });
    assert.strictEqual(emergencyTurn.status, 200);

    const failedDel = await pollWebhookDelivery(
      baseUrl,
      adminHeaders,
      d => d.status === 'failed' && d.eventType === 'handoff.created'
    );
    assert.ok(failedDel, 'Expected failed handoff.created webhook record');

    forceFail = false;
    const retryRes = await fetch(`${baseUrl}/api/integrations/${failedDel.id}/retry`, {
      method: 'POST',
      headers: adminHeaders,
    });
    assert.strictEqual(retryRes.status, 200);
    const retryData = (await retryRes.json()) as any;
    assert.strictEqual(retryData.delivery.status, 'delivered');

    // 5. Verify /api/metrics/operational computes real values
    const metricsRes = await fetch(`${baseUrl}/api/metrics/operational`, { headers: adminHeaders });
    assert.strictEqual(metricsRes.status, 200);
    const metrics = (await metricsRes.json()) as any;
    assert.ok(metrics.confirmedAppointments >= 1);
    assert.ok(metrics.deliveredCount >= 2);
    assert.strictEqual(metrics.webhookSuccessRatePct, 100);

    // 6. Create tenant admin user, sign in, then revoke -> existing token rejected immediately
    const createUserRes = await fetch(`${baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Kalinga Operator',
        email: 'operator@kalinga.org',
        password: 'OperatorPass123!',
        role: 'tenant_admin',
        allowedTenants: ['kalinga_clinic'],
      }),
    });
    assert.strictEqual(createUserRes.status, 201);
    const createdUser = (await createUserRes.json()) as any;

    const opLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'operator@kalinga.org', password: 'OperatorPass123!' }),
    });
    assert.strictEqual(opLoginRes.status, 200);
    const opAuth = (await opLoginRes.json()) as any;

    const okBeforeRevoke = await fetch(`${baseUrl}/api/appointments`, {
      headers: { Authorization: `Bearer ${opAuth.token}` },
    });
    assert.strictEqual(okBeforeRevoke.status, 200);

    const revokeRes = await fetch(`${baseUrl}/api/auth/users/${createdUser.user.id}/revoke`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ revoked: true }),
    });
    assert.strictEqual(revokeRes.status, 200);

    const rejectedAfterRevoke = await fetch(`${baseUrl}/api/appointments`, {
      headers: { Authorization: `Bearer ${opAuth.token}` },
    });
    assert.strictEqual(rejectedAfterRevoke.status, 401, 'Revoked user token must fail immediately on next request');

    // 7. Public /api/health must be minimal (no DB counts/nodeVersion), while /api/diagnostics requires admin
    const pubHealthRes = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(pubHealthRes.status, 200);
    const pubHealth = (await pubHealthRes.json()) as any;
    assert.strictEqual(pubHealth.status, 'operational');
    assert.strictEqual(pubHealth.database, undefined);
    assert.strictEqual(pubHealth.systemMetrics, undefined);

    const cspHeader = pubHealthRes.headers.get('content-security-policy') || '';
    assert.ok(cspHeader.includes("object-src 'none'"), 'Responses must carry Content-Security-Policy');
    assert.ok(cspHeader.includes('frame-ancestors'), 'CSP must define frame-ancestors');

    const callerDiagRes = await fetch(`${baseUrl}/api/diagnostics`, { headers: callerHeaders });
    assert.strictEqual(callerDiagRes.status, 403);

    const adminDiagRes = await fetch(`${baseUrl}/api/diagnostics`, { headers: adminHeaders });
    assert.strictEqual(adminDiagRes.status, 200);
    const adminDiag = (await adminDiagRes.json()) as any;
    assert.strictEqual(adminDiag.database.type, 'sqlite');

    // 8. Non-truncated server-authoritative deletion across > 150 persisted logs
    const bulkCallerRes = await fetch(`${baseUrl}/api/auth/caller-session`, { method: 'POST' });
    const bulkCallerAuth = (await bulkCallerRes.json()) as any;
    const bulkHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bulkCallerAuth.token}`,
    };
    const bulkConsentRes = await fetch(`${baseUrl}/api/consent`, {
      method: 'POST',
      headers: bulkHeaders,
      body: JSON.stringify({ consented: true, retentionDays: 30, tenantId: 'kalinga_clinic' }),
    });
    assert.strictEqual(bulkConsentRes.status, 200);

    for (let i = 0; i < 125; i++) {
      const logRes = await fetch(`${baseUrl}/api/logs`, {
        method: 'POST',
        headers: bulkHeaders,
        body: JSON.stringify({
          id: `call_bulk_${i}`,
          tenantId: 'kalinga_clinic',
          tenantName: 'Kalinga Care Multispeciality Clinic',
          callerNumber: '+91-90000-00000',
          callerName: `Caller ${i}`,
          startedAt: new Date(Date.now() - i * 1000).toISOString(),
          durationSeconds: 12,
          languagesUsed: ['en'],
          detectedIntent: 'general_inquiry',
          turns: [
            { id: `m_${i}_1`, speaker: 'user', text: 'OPD check', timestamp: Date.now() },
            { id: `m_${i}_2`, speaker: 'agent', text: 'Confirmed.', timestamp: Date.now() },
          ],
          metrics: {
            averageLatencyMs: 120,
            p95LatencyMs: 180,
            bargeInCount: 0,
            toolsExecutedCount: 0,
            taskCompleted: true,
            handedOffToHuman: false,
            satisfactionScore: 5,
          },
        }),
      });
      assert.strictEqual(logRes.status, 201);
    }

    const bulkSessionLogsBefore = (await (await fetch(`${baseUrl}/api/session/logs`, { headers: bulkHeaders })).json()) as any[];
    assert.strictEqual(bulkSessionLogsBefore.length, 125);

    const bulkDeleteRes = await fetch(`${baseUrl}/api/session/data`, {
      method: 'DELETE',
      headers: bulkHeaders,
    });
    assert.strictEqual(bulkDeleteRes.status, 200);
    const bulkDeleteJson = (await bulkDeleteRes.json()) as any;
    assert.strictEqual(bulkDeleteJson.deleted.callLogs, 125, 'All 125 (>100) logs must be deleted atomically without truncation');

    const bulkSessionLogsAfter = (await (await fetch(`${baseUrl}/api/session/logs`, { headers: bulkHeaders })).json()) as any[];
    assert.strictEqual(bulkSessionLogsAfter.length, 0);

    // 9. Role-change token_version invalidation: restore operator, login, update role -> prior token fails immediately
    await fetch(`${baseUrl}/api/auth/users/${createdUser.user.id}/revoke`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ revoked: false }),
    });
    const opLogin2Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'operator@kalinga.org', password: 'OperatorPass123!' }),
    });
    assert.strictEqual(opLogin2Res.status, 200);
    const opAuth2 = (await opLogin2Res.json()) as any;

    const roleUpdateRes = await fetch(`${baseUrl}/api/auth/users/${createdUser.user.id}/role`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ role: 'caller' }),
    });
    assert.strictEqual(roleUpdateRes.status, 200);

    const staleRoleTokenRes = await fetch(`${baseUrl}/api/appointments`, {
      headers: { Authorization: `Bearer ${opAuth2.token}` },
    });
    assert.strictEqual(staleRoleTokenRes.status, 401, 'Role update must increment token_version and invalidate prior tokens');
  } finally {
    webhookServer.close();
    proc.kill('SIGTERM');
    await new Promise(resolve => proc.once('exit', resolve));
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('Integration: Audit P0/P1 checks (last-admin lock, cross-session log 409, idempotency conflict 409, invalid slot & negative confirm, demo webhook gating, XFF spoof guard, and support ticket RBAC)', async () => {
  const workdir = makeTempWorkdir();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const sessionSecret = '0123456789abcdef0123456789abcdef0123456789abcdef';
  const bootstrapToken = 'boot-audit-checks-987654';

  const webhookRequests: string[] = [];
  const webhookServer = http.createServer((req, res) => {
    webhookRequests.push(req.url || '/');
    res.statusCode = 200;
    res.end('ok');
  });
  await new Promise<void>(resolve => webhookServer.listen(0, '127.0.0.1', () => resolve()));
  const webhookAddr = webhookServer.address();
  const webhookPort = typeof webhookAddr === 'object' && webhookAddr ? webhookAddr.port : 0;
  const webhookUrl = `http://127.0.0.1:${webhookPort}/hook`;

  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: workdir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      SESSION_SECRET: sessionSecret,
      ADMIN_BOOTSTRAP_TOKEN: bootstrapToken,
      ADMIN_PASSCODE: 'env-passcode-1234',
      GEMINI_API_KEY: '',
      ALLOW_LOCAL_WEBHOOKS: 'true',
      RATE_LIMIT_SUPPORT: '2',
      // Intentionally omit ALLOW_DEMO_WEBHOOKS and TRUST_PROXY
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrChunks: string[] = [];
  proc.stderr?.on('data', d => stderrChunks.push(d.toString()));

  try {
    await waitForHealth(baseUrl, proc, stderrChunks);

    // 1. Login via ADMIN_PASSCODE (usr_env_admin) and create 1 registered super_admin + 1 tenant_admin
    const envAdminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'env@workspace.local', password: 'env-passcode-1234' }),
    });
    assert.strictEqual(envAdminLogin.status, 200);
    const envAdminAuth = (await envAdminLogin.json()) as any;
    const superHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${envAdminAuth.token}`,
    };

    // Authenticated admin session includes modelUsed
    const adminSessionJson = (await (await fetch(`${baseUrl}/api/session`, { headers: superHeaders })).json()) as any;
    assert.ok(adminSessionJson.modelUsed, 'Authenticated admin /api/session should include modelUsed');

    // Short password rejected on user create
    const weakUserRes = await fetch(`${baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: superHeaders,
      body: JSON.stringify({
        name: 'Short Pass',
        email: 'short@kalinga.org',
        password: 'short',
        role: 'tenant_admin',
        allowedTenants: ['kalinga_clinic'],
      }),
    });
    assert.strictEqual(weakUserRes.status, 400);

    // Create sole super_admin user in DB and verify last super_admin cannot be demoted or revoked
    const saRes = await fetch(`${baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: superHeaders,
      body: JSON.stringify({
        name: 'Sole Super',
        email: 'sole@workspace.org',
        password: 'SuperStrongPass123!',
        role: 'super_admin',
        allowedTenants: ['*'],
      }),
    });
    assert.strictEqual(saRes.status, 201);
    const saUser = (await saRes.json()) as any;

    const demoteLastRes = await fetch(`${baseUrl}/api/auth/users/${saUser.user.id}/role`, {
      method: 'PATCH',
      headers: superHeaders,
      body: JSON.stringify({ role: 'tenant_admin', allowedTenants: ['kalinga_clinic'] }),
    });
    assert.strictEqual(demoteLastRes.status, 409);

    const revokeLastRes = await fetch(`${baseUrl}/api/auth/users/${saUser.user.id}/revoke`, {
      method: 'POST',
      headers: superHeaders,
      body: JSON.stringify({ revoked: true }),
    });
    assert.strictEqual(revokeLastRes.status, 409);

    // 2. Configure webhook without ALLOW_DEMO_WEBHOOKS -> demoMode turn must NOT fire webhook
    const clinicCfg = (await (await fetch(`${baseUrl}/api/tenants/kalinga_clinic`, { headers: superHeaders })).json()) as any;
    clinicCfg.webhookConfig = {
      enabled: true,
      url: webhookUrl,
      providerType: 'clinic_ehr_webhook',
      signingSecret: 'whsec_test_123456',
    };
    await fetch(`${baseUrl}/api/tenants/kalinga_clinic`, {
      method: 'POST',
      headers: superHeaders,
      body: JSON.stringify(clinicCfg),
    });

    const caller1 = (await (await fetch(`${baseUrl}/api/auth/caller-session`, { method: 'POST' })).json()) as any;
    const caller1Headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${caller1.token}` };

    const demoEmergency = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: caller1Headers,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Severe chest pain emergency!',
        language: 'en',
        demoMode: true,
      }),
    });
    assert.strictEqual(demoEmergency.status, 200);
    await new Promise(r => setTimeout(r, 150));
    assert.strictEqual(webhookRequests.length, 0, 'demoMode turns must not dispatch webhooks unless ALLOW_DEMO_WEBHOOKS=true');

    // 3. Invalid OPD slot & negative confirmation check
    const step1 = (await (await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: caller1Headers,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Book appointment with Dr. Jena at 10:00 AM. My name is Meera',
        language: 'en',
        idempotencyKey: 'idem-payload-check',
        demoMode: true,
      }),
    })).json()) as any;
    assert.strictEqual(step1.toolCalls?.[0]?.result?.requiresConfirmation, true);

    // Idempotency-Key reused with different body -> 409 IDEMPOTENCY_CONFLICT
    const idemConflictRes = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: caller1Headers,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Different request text altogether',
        language: 'en',
        idempotencyKey: 'idem-payload-check',
        demoMode: true,
      }),
    });
    assert.strictEqual(idemConflictRes.status, 409);

    // "Yes, do not confirm my booking" must NOT confirm appointment
    const negConfirmRes = (await (await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: caller1Headers,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Yes, do not confirm my booking',
        language: 'en',
        memory: step1.memoryUpdates,
        demoMode: true,
      }),
    })).json()) as any;
    assert.strictEqual(negConfirmRes.toolCalls?.[0]?.result?.requiresConfirmation, true);
    assert.strictEqual(negConfirmRes.toolCalls?.[0]?.result?.data?.bookingRef, undefined);

    // Invalid Sunday OPD slot must be rejected by tool validation without creating an appointment
    const sundayRes = (await (await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: caller1Headers,
      body: JSON.stringify({
        tenantId: 'kalinga_clinic',
        userText: 'Book appointment with Dr. Jena on Sunday 10:00 AM. My name is Meera',
        language: 'en',
        demoMode: true,
      }),
    })).json()) as any;
    assert.strictEqual(sundayRes.toolCalls?.[0]?.result?.success, false);
    assert.strictEqual(sundayRes.toolCalls?.[0]?.result?.data?.bookingRef, undefined);
    const apptsAfterInvalid = (await (await fetch(`${baseUrl}/api/appointments`, { headers: superHeaders })).json()) as any[];
    assert.strictEqual(apptsAfterInvalid.length, 0);

    // 4. Cross-session POST /api/logs ID collision -> 409 LOG_ID_CONFLICT
    await fetch(`${baseUrl}/api/consent`, {
      method: 'POST',
      headers: caller1Headers,
      body: JSON.stringify({ consented: true, retentionDays: 30, tenantId: 'kalinga_clinic' }),
    });
    const logPayload = {
      id: 'call_shared_collision_test',
      tenantId: 'kalinga_clinic',
      tenantName: 'Kalinga Care Multispeciality Clinic',
      callerNumber: 'Web',
      callerName: 'Caller A',
      startedAt: new Date().toISOString(),
      durationSeconds: 10,
      languagesUsed: ['en'],
      detectedIntent: 'general_inquiry',
      turns: [{ id: 't1', speaker: 'user', text: 'Hello', timestamp: Date.now() }],
      metrics: {
        averageLatencyMs: 100,
        p95LatencyMs: 100,
        bargeInCount: 0,
        toolsExecutedCount: 0,
        taskCompleted: true,
        handedOffToHuman: false,
      },
    };
    const logA = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: caller1Headers,
      body: JSON.stringify(logPayload),
    });
    assert.strictEqual(logA.status, 201);

    const caller2 = (await (await fetch(`${baseUrl}/api/auth/caller-session`, { method: 'POST' })).json()) as any;
    const caller2Headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${caller2.token}` };
    await fetch(`${baseUrl}/api/consent`, {
      method: 'POST',
      headers: caller2Headers,
      body: JSON.stringify({ consented: true, retentionDays: 30, tenantId: 'kalinga_clinic' }),
    });
    const logB = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: caller2Headers,
      body: JSON.stringify(logPayload),
    });
    assert.strictEqual(logB.status, 409);

    // 5. Support tickets RBAC & X-Forwarded-For rate-limit spoof protection
    const konarkTicketRes = await fetch(`${baseUrl}/api/support/ticket`, {
      method: 'POST',
      headers: { ...caller1Headers, 'X-Forwarded-For': '1.1.1.1' },
      body: JSON.stringify({
        name: 'Ravi',
        email: 'ravi@example.com',
        subject: 'Konark question',
        message: 'Checking delivery ticket RBAC',
        tenantId: 'konark_logistics',
      }),
    });
    assert.strictEqual(konarkTicketRes.status, 201);
    const konarkTicket = (await konarkTicketRes.json()) as any;

    const globalTicketRes = await fetch(`${baseUrl}/api/support/ticket`, {
      method: 'POST',
      headers: { ...caller1Headers, 'X-Forwarded-For': '2.2.2.2' },
      body: JSON.stringify({
        name: 'Ravi',
        email: 'ravi@example.com',
        subject: 'Global question',
        message: 'Checking global ticket RBAC',
      }),
    });
    assert.strictEqual(globalTicketRes.status, 201);
    const globalTicket = (await globalTicketRes.json()) as any;

    // 3rd support ticket with spoofed X-Forwarded-For hits RATE_LIMIT_SUPPORT=2
    const rateLimitedSupport = await fetch(`${baseUrl}/api/support/ticket`, {
      method: 'POST',
      headers: { ...caller1Headers, 'X-Forwarded-For': '3.3.3.3' },
      body: JSON.stringify({
        name: 'Ravi',
        email: 'ravi@example.com',
        subject: 'Third request',
        message: 'Should be rate limited despite X-Forwarded-For spoof',
      }),
    });
    assert.strictEqual(rateLimitedSupport.status, 429);

    // Create tenant_admin scoped ONLY to kalinga_clinic
    await fetch(`${baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: superHeaders,
      body: JSON.stringify({
        name: 'Kalinga Admin',
        email: 'kadmin@kalinga.org',
        password: 'KalingaAdminPass123!',
        role: 'tenant_admin',
        allowedTenants: ['kalinga_clinic'],
      }),
    });
    const kLogin = (await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'kadmin@kalinga.org', password: 'KalingaAdminPass123!' }),
    })).json()) as any;
    const kHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${kLogin.token}` };

    const scopedTickets = (await (await fetch(`${baseUrl}/api/support/tickets`, { headers: kHeaders })).json()) as any[];
    assert.strictEqual(scopedTickets.some(t => t.id === konarkTicket.ticketId), false);
    assert.strictEqual(scopedTickets.some(t => t.id === globalTicket.ticketId), false);

    const crossPatch = await fetch(`${baseUrl}/api/support/tickets/${konarkTicket.ticketId}`, {
      method: 'PATCH',
      headers: kHeaders,
      body: JSON.stringify({ status: 'resolved' }),
    });
    assert.strictEqual(crossPatch.status, 403);

    const globalPatchDenied = await fetch(`${baseUrl}/api/support/tickets/${globalTicket.ticketId}`, {
      method: 'PATCH',
      headers: kHeaders,
      body: JSON.stringify({ status: 'resolved' }),
    });
    assert.strictEqual(globalPatchDenied.status, 403);

    const superPatchGlobal = await fetch(`${baseUrl}/api/support/tickets/${globalTicket.ticketId}`, {
      method: 'PATCH',
      headers: superHeaders,
      body: JSON.stringify({ status: 'resolved' }),
    });
    assert.strictEqual(superPatchGlobal.status, 200);
  } finally {
    webhookServer.close();
    proc.kill('SIGTERM');
    await new Promise(resolve => proc.once('exit', resolve));
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});


