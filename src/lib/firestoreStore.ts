import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { getFirebaseDb, handleFirestoreError, OperationType } from './firebase';
import type {
  AuthUser,
  TenantConfig,
  CallLog,
  HandoffTicket,
  AppointmentRecord,
  IntegrationDelivery,
} from '../types';

function sanitizeId(raw: string, fallbackPrefix: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
  return clean.length >= 3 ? clean : `${fallbackPrefix}_${Date.now()}`;
}

export async function upsertUserProfileInFirestore(user: AuthUser, uid: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    const db = getFirebaseDb();
    await setDoc(
      doc(db, 'users', uid),
      {
        uid,
        email: user.email.slice(0, 160),
        displayName: (user.name || 'Workspace User').slice(0, 120),
        role: user.role,
        revoked: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    // Non-fatal if user already exists with admin-managed role; surface structured error only on unexpected denial
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // swallow after logging diagnostic so login flow proceeds cleanly
    }
  }
}

export async function syncTenantWorkspaceToFirestore(
  tenant: TenantConfig,
  ownerUid: string
): Promise<void> {
  const tenantId = sanitizeId(tenant.id, 'tenant');
  const path = `tenants/${tenantId}`;
  try {
    const db = getFirebaseDb();
    await setDoc(doc(db, 'tenants', tenantId), {
      id: tenantId,
      name: tenant.name.slice(0, 120),
      category: tenant.category,
      agentName: tenant.agentName.slice(0, 60),
      webhookEnabled: Boolean(tenant.webhookConfig?.enabled),
      ownerUid: sanitizeId(ownerUid, 'usr'),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function persistCallSessionToFirestore(
  log: CallLog,
  ownerUid: string,
  retentionDays: number
): Promise<void> {
  const normalizedDays = retentionDays === 7 || retentionDays === 30 || retentionDays === 90 ? retentionDays : 30;
  const sessionId = sanitizeId(log.id, 'call');
  const path = `callSessions/${sessionId}`;
  try {
    const db = getFirebaseDb();
    await setDoc(doc(db, 'callSessions', sessionId), {
      id: sessionId,
      ownerUid: sanitizeId(ownerUid, 'usr'),
      tenantId: sanitizeId(log.tenantId, 'tenant'),
      tenantName: (log.tenantName || 'Workspace').slice(0, 120),
      detectedIntent: (log.detectedIntent || 'general_inquiry').slice(0, 80),
      durationSeconds: Math.min(86400, Math.max(0, Number(log.durationSeconds) || 0)),
      averageLatencyMs: Math.min(120000, Math.max(0, Number(log.metrics?.averageLatencyMs) || 0)),
      p95LatencyMs: Math.min(120000, Math.max(0, Number(log.metrics?.p95LatencyMs) || 0)),
      taskCompleted: Boolean(log.metrics?.taskCompleted),
      handedOffToHuman: Boolean(log.metrics?.handedOffToHuman),
      retentionDays: normalizedDays,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function persistHandoffToFirestore(
  ticket: HandoffTicket,
  ownerUid: string
): Promise<void> {
  const ticketId = sanitizeId(ticket.id, 'hnd');
  const path = `handoffs/${ticketId}`;
  try {
    const db = getFirebaseDb();
    await setDoc(doc(db, 'handoffs', ticketId), {
      id: ticketId,
      ownerUid: sanitizeId(ownerUid, 'usr'),
      tenantId: sanitizeId(ticket.tenantId, 'tenant'),
      reason: ticket.reason.slice(0, 300),
      priority: ticket.priority,
      summary: ticket.summary.slice(0, 1000),
      status: 'queued',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateHandoffInFirestore(
  ticketId: string,
  status: HandoffTicket['status']
): Promise<void> {
  const id = sanitizeId(ticketId, 'hnd');
  const path = `handoffs/${id}`;
  try {
    const db = getFirebaseDb();
    await updateDoc(doc(db, 'handoffs', id), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function persistAppointmentToFirestore(
  apt: AppointmentRecord,
  ownerUid: string
): Promise<void> {
  const id = sanitizeId(apt.id, 'apt');
  const path = `appointments/${id}`;
  try {
    const db = getFirebaseDb();
    await setDoc(doc(db, 'appointments', id), {
      id,
      ownerUid: sanitizeId(ownerUid, 'usr'),
      tenantId: sanitizeId(apt.tenantId, 'tenant'),
      doctor: apt.doctor.slice(0, 120),
      slot: apt.slot.slice(0, 80),
      patientName: apt.patientName.slice(0, 120),
      status: 'confirmed',
      actionId: sanitizeId(apt.actionId, 'act'),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAppointmentInFirestore(
  appointmentId: string,
  status: AppointmentRecord['status']
): Promise<void> {
  const id = sanitizeId(appointmentId, 'apt');
  const path = `appointments/${id}`;
  try {
    const db = getFirebaseDb();
    await updateDoc(doc(db, 'appointments', id), { status });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function persistIntegrationToFirestore(
  delivery: IntegrationDelivery,
  ownerUid: string
): Promise<void> {
  const id = sanitizeId(delivery.id, 'del');
  const path = `integrations/${id}`;
  try {
    const db = getFirebaseDb();
    await setDoc(doc(db, 'integrations', id), {
      id,
      ownerUid: sanitizeId(ownerUid, 'usr'),
      tenantId: sanitizeId(delivery.tenantId, 'tenant'),
      eventType: delivery.eventType.slice(0, 80),
      status: delivery.status,
      attemptCount: Math.min(10, Math.max(0, delivery.attemptCount)),
      idempotencyKey: delivery.idempotencyKey.slice(0, 120),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function persistSupportTicketToFirestore(
  ticketId: string,
  ownerUid: string,
  name: string,
  subject: string,
  message: string
): Promise<void> {
  const id = sanitizeId(ticketId, 'tkt');
  const path = `supportTickets/${id}`;
  try {
    const db = getFirebaseDb();
    await setDoc(doc(db, 'supportTickets', id), {
      id,
      ownerUid: sanitizeId(ownerUid, 'usr'),
      name: name.slice(0, 120),
      subject: subject.slice(0, 180),
      message: message.slice(0, 3000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function loadFirestoreSessionSummaries(
  uid: string,
  isAdmin: boolean
): Promise<{
  sessions: any[];
  handoffs: any[];
  appointments: any[];
  integrations: any[];
}> {
  const db = getFirebaseDb();
  const buildQuery = (colName: string) =>
    isAdmin
      ? query(collection(db, colName), orderBy('createdAt', 'desc'), limit(50))
      : query(collection(db, colName), where('ownerUid', '==', uid), limit(50));

  try {
    const [sessionsSnap, handoffsSnap, apptsSnap, integrationsSnap] = await Promise.all([
      getDocs(buildQuery('callSessions')),
      getDocs(buildQuery('handoffs')),
      getDocs(buildQuery('appointments')),
      getDocs(buildQuery('integrations')),
    ]);
    return {
      sessions: sessionsSnap.docs.map(d => d.data()),
      handoffs: handoffsSnap.docs.map(d => d.data()),
      appointments: apptsSnap.docs.map(d => d.data()),
      integrations: integrationsSnap.docs.map(d => d.data()),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'callSessions');
  }
}

export async function deleteUserSessionDocsFromFirestore(uid: string): Promise<number> {
  const db = getFirebaseDb();
  let deletedCount = 0;
  const collections = ['callSessions', 'handoffs', 'appointments', 'supportTickets', 'integrations'];

  for (const colName of collections) {
    try {
      const snap = await getDocs(query(collection(db, colName), where('ownerUid', '==', uid), limit(100)));
      if (snap.empty) continue;
      const batch = writeBatch(db);
      for (const d of snap.docs) {
        batch.delete(d.ref);
        deletedCount += 1;
      }
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, colName);
    }
  }
  return deletedCount;
}

export async function deleteSingleFirestoreDoc(colName: string, docId: string): Promise<void> {
  try {
    const db = getFirebaseDb();
    await deleteDoc(doc(db, colName, docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${colName}/${docId}`);
  }
}
