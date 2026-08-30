export enum ShiftBridgeView {
  FIRST_TIME_SETUP,
  START_SHIFT,
  DASHBOARD,
  NEW_ACTIVITY_FORM,
  AUDIT_PLACEHOLDER,
}

export interface BusinessConfig {
  businessName: string
  departments: string[]
  setupCompleted: boolean
  createdAt: string
}

export interface ShiftSession {
  id: string
  employeeName: string
  startedAt: string
  endedAt: string | null
  shiftSequence: number
  status: "Active" | "Ended"
}

export interface AuditEvent {
  id: string
  eventType: "ShiftStarted" | "ShiftEnded" | "ActivityCreated" | "PendingCompleted"
  timestamp: string
  employeeName: string
  shiftId: string
  shiftSequence: number
  activityId: string | null
  activityTitle: string | null
  activityType: "Pending" | "Update" | null
  department: string | null
  priority: "High" | "Low" | null
  summary: string
}

export interface Activity {
  id: string
  type: "Pending" | "Update"
  department: string
  title: string
  description: string
  priority: "High" | "Low" | null
  status: "Open" | "Completed"
  createdBy: string
  createdAt: string
  createdInShift: number
  completedBy: string | null
  completedAt: string | null
  completedInShift: number | null
  hasPhoto: boolean
  photoAttachmentId: string | null
  photoPersistence: "Durable" | "SessionOnly" | "None"
}

export interface PersistentAppData {
  businessConfig: BusinessConfig | null
  currentShiftSequence: number
  activeShift: ShiftSession | null
  shiftHistory: ShiftSession[]
  activities: Activity[]
  auditEvents: AuditEvent[]
}

/** View-facing cache only; durable state lives in ShiftBridgeStorageService. */
export class ShiftBridgeRunState {
  businessName = ""
  departments: string[] = []
  employeeName = ""
  activeShift: ShiftSession | null = null
}
