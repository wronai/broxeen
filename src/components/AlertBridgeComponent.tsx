/**
 * AlertBridgeComponent — invisible component that mounts inside CqrsProvider
 * and wires AlertBridge to the EventStore + AutoScanScheduler.
 *
 * Place this alongside ChatPersistenceBridge inside CqrsProvider.
 */

import { useAlertBridge } from "../hooks/useAlertBridge";
import type { AutoScanScheduler } from "../plugins/discovery/autoScanScheduler";

interface AlertBridgeComponentProps {
  autoScanScheduler: AutoScanScheduler | null;
}

export function AlertBridgeComponent({ autoScanScheduler }: AlertBridgeComponentProps) {
  useAlertBridge(autoScanScheduler);
  return null;
}
