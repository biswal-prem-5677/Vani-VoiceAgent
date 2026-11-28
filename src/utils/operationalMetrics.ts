import { calculatePercentiles } from './latencyTracker.ts';
import type {
  AppointmentRecord,
  CallLog,
  HandoffTicket,
  IntegrationDelivery,
  OperationalMetricsSummary,
} from '../types/index.ts';

export function computeOperationalMetrics(input: {
  logs: CallLog[];
  handoffs: HandoffTicket[];
  appointments: AppointmentRecord[];
  integrations: IntegrationDelivery[];
}): OperationalMetricsSummary {
  const { logs, handoffs, appointments, integrations } = input;
  const realLogs = logs.filter(l => !l.isSampleData);

  const totalSessions = realLogs.length;
  const handedOffSessions = realLogs.filter(l => l.metrics?.handedOffToHuman).length;
  const containedSessions = realLogs.filter(
    l => l.metrics?.taskCompleted && !l.metrics?.handedOffToHuman
  ).length;

  const containmentRatePct =
    totalSessions > 0 ? Math.round((containedSessions / totalSessions) * 100) : 0;
  const handoffRatePct =
    totalSessions > 0 ? Math.round((handedOffSessions / totalSessions) * 100) : 0;

  const confirmedAppointments = appointments.filter(a => a.status === 'confirmed').length;
  const totalAppointments = appointments.length;
  const bookingCompletionRatePct =
    totalAppointments > 0 ? Math.round((confirmedAppointments / totalAppointments) * 100) : 0;

  const perTurnLatencies = realLogs.flatMap(log =>
    (log.turns || [])
      .map(t => t.latencyMs)
      .filter((ms): ms is number => typeof ms === 'number' && ms > 0)
  );
  const latencies =
    perTurnLatencies.length > 0
      ? perTurnLatencies
      : realLogs
          .map(l => l.metrics?.averageLatencyMs)
          .filter((ms): ms is number => typeof ms === 'number' && ms > 0);
  const latencyStats = calculatePercentiles(latencies);

  let failedToolCallsCount = 0;
  for (const log of realLogs) {
    for (const turn of log.turns || []) {
      if (turn.toolInvoked && turn.toolInvoked.result?.success === false && !turn.toolInvoked.result?.requiresConfirmation) {
        failedToolCallsCount += 1;
      }
    }
  }

  const safetyEscalationsCount = handoffs.filter(h => h.priority === 'critical').length;

  const activeDeliveries = integrations.filter(d => d.status !== 'not_configured');
  const deliveredCount = activeDeliveries.filter(d => d.status === 'delivered').length;
  const failedDeliveriesCount = activeDeliveries.filter(d => d.status === 'failed').length;
  const webhookSuccessRatePct =
    activeDeliveries.length > 0
      ? Math.round((deliveredCount / activeDeliveries.length) * 100)
      : 0;

  return {
    totalSessions,
    containmentRatePct,
    handoffRatePct,
    bookingCompletionRatePct,
    confirmedAppointments,
    p50LatencyMs: latencyStats.p50,
    p95LatencyMs: latencyStats.p95,
    failedToolCallsCount,
    safetyEscalationsCount,
    webhookSuccessRatePct,
    deliveredCount,
    failedDeliveriesCount,
  };
}
