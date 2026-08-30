import {Activity, AuditEvent, PersistentAppData, ShiftSession} from "./ShiftBridgeAppState"

/** Owns all ShiftBridge local persistence through the Lens GeneralDataStore. */
export class ShiftBridgeStorageService {
  static readonly dataKey = "shiftbridge.persistentAppData.v1"
  private store: GeneralDataStore | null = null

  constructor() {
    try { this.store = global.persistentStorageSystem && global.persistentStorageSystem.store ? global.persistentStorageSystem.store : null }
    catch (_) { this.store = null }
  }
  load(): PersistentAppData {
    if (!this.store) return this.defaults()
    try { const raw = this.store.getString(ShiftBridgeStorageService.dataKey); return raw ? this.sanitize(JSON.parse(raw) as PersistentAppData) : this.defaults() }
    catch (_) { return this.defaults() }
  }
  save(data: PersistentAppData): void {
    if (!this.store) return
    try { this.store.putString(ShiftBridgeStorageService.dataKey, JSON.stringify(this.sanitize(data))) }
    catch (_) { console.warn("[ShiftBridgeStorage] Could not save local data.") }
  }
  reset(): PersistentAppData {
    try { if (this.store) this.store.remove(ShiftBridgeStorageService.dataKey) }
    catch (_) { console.warn("[ShiftBridgeStorage] Could not reset local data.") }
    return this.defaults()
  }
  saveBusinessConfig(data: PersistentAppData, businessName: string, departments: string[]): void {
    data.businessConfig = {businessName, departments: departments.slice(), setupCompleted: true, createdAt: new Date().toISOString()}; this.save(data)
  }
  startShift(data: PersistentAppData, employeeName: string): ShiftSession {
    if (data.activeShift && data.activeShift.status === "Active") return data.activeShift
    const sequence = Math.max(0, Math.floor(data.currentShiftSequence || 0)) + 1; const now = new Date().toISOString()
    const session: ShiftSession = {id: this.id("shift"), employeeName, startedAt: now, endedAt: null, shiftSequence: sequence, status: "Active"}
    data.currentShiftSequence = sequence; data.activeShift = session
    if (!data.shiftHistory.some(x => x.id === session.id)) data.shiftHistory.push(session)
    this.appendAuditEvent(data, this.audit("ShiftStarted", session, now)); this.save(data); return session
  }
  endActiveShift(data: PersistentAppData): ShiftSession | null {
    const active = data.activeShift; if (!active || active.status !== "Active") return null
    const now = new Date().toISOString(); active.status = "Ended"; active.endedAt = now
    const index = data.shiftHistory.findIndex(x => x.id === active.id); if (index >= 0) data.shiftHistory[index] = active; else data.shiftHistory.push(active)
    this.appendAuditEvent(data, this.audit("ShiftEnded", active, now)); data.activeShift = null; this.save(data); return active
  }
  createActivity(data: PersistentAppData, activeShift: ShiftSession, type: "Pending" | "Update", department: string, priority: "High" | "Low" | null, title: string, description: string, photoPersistence: "SessionOnly" | "None" = "None"): Activity | null {
    if (!data.activeShift || data.activeShift.id !== activeShift.id || activeShift.status !== "Active") return null
    const now = new Date().toISOString()
    const activity: Activity = {id: this.id("activity"), type, department, title, description, priority: type === "Pending" ? priority : null, status: "Open", createdBy: activeShift.employeeName, createdAt: now, createdInShift: activeShift.shiftSequence, completedBy: null, completedAt: null, completedInShift: null, hasPhoto: photoPersistence === "SessionOnly", photoAttachmentId: null, photoPersistence}
    if (data.activities.some(x => x.id === activity.id)) return null
    data.activities.push(activity)
    this.appendAuditEvent(data, {id: this.id("audit"), eventType: "ActivityCreated", timestamp: now, employeeName: activeShift.employeeName, shiftId: activeShift.id, shiftSequence: activeShift.shiftSequence, activityId: activity.id, activityTitle: activity.title, activityType: activity.type, department: activity.department, priority: activity.priority, summary: activeShift.employeeName + " created " + (activity.priority ? activity.priority + " " : "") + activity.type + ": " + activity.title + (activity.hasPhoto ? " (Photo attached)." : ".")})
    this.save(data); return activity
  }
  completePending(data: PersistentAppData, activityId: string, activeShift: ShiftSession): Activity | null {
    if (!data.activeShift || data.activeShift.id !== activeShift.id || activeShift.status !== "Active") return null
    const activity = data.activities.find(x => x.id === activityId)
    if (!activity || activity.type !== "Pending" || activity.status !== "Open") return null
    const now = new Date().toISOString(); activity.status = "Completed"; activity.completedBy = activeShift.employeeName; activity.completedAt = now; activity.completedInShift = activeShift.shiftSequence
    this.appendAuditEvent(data, {id: this.id("audit"), eventType: "PendingCompleted", timestamp: now, employeeName: activeShift.employeeName, shiftId: activeShift.id, shiftSequence: activeShift.shiftSequence, activityId: activity.id, activityTitle: activity.title, activityType: "Pending", department: activity.department, priority: activity.priority, summary: activeShift.employeeName + " completed: " + activity.title + "."})
    this.save(data); return activity
  }
  private defaults(): PersistentAppData { return {businessConfig: null, currentShiftSequence: 0, activeShift: null, shiftHistory: [], activities: [], auditEvents: []} }
  private id(prefix: string): string { return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1000000) }
  private audit(eventType: "ShiftStarted" | "ShiftEnded", shift: ShiftSession, timestamp: string): AuditEvent {
    return {id: this.id("audit"), eventType, timestamp, employeeName: shift.employeeName, shiftId: shift.id, shiftSequence: shift.shiftSequence, activityId: null, activityTitle: null, activityType: null, department: null, priority: null, summary: shift.employeeName + " " + (eventType === "ShiftStarted" ? "started" : "ended") + " Shift " + shift.shiftSequence + "."}
  }
  /** Keeps event identity stable across reloads while allowing repeated real actions. */
  private appendAuditEvent(data: PersistentAppData, event: AuditEvent): void {
    if (!data.auditEvents.some(existing => existing.id === event.id)) data.auditEvents.push(event)
  }
  private sanitize(input: PersistentAppData | null | undefined): PersistentAppData {
    const data = this.defaults(); if (!input || typeof input !== "object") return data
    const config = input.businessConfig
    if (config && typeof config.businessName === "string" && Array.isArray(config.departments) && config.setupCompleted === true) {
      const departments = config.departments.filter(x => typeof x === "string").map(x => x.trim()).filter(x => x.length > 0)
      if (config.businessName.trim().length > 0 && departments.length > 0) data.businessConfig = {businessName: config.businessName.trim(), departments, setupCompleted: true, createdAt: typeof config.createdAt === "string" ? config.createdAt : new Date().toISOString()}
    }
    data.currentShiftSequence = typeof input.currentShiftSequence === "number" && input.currentShiftSequence > 0 ? Math.floor(input.currentShiftSequence) : 0
    const seen: Record<string, boolean> = {}
    if (Array.isArray(input.shiftHistory)) input.shiftHistory.forEach(x => { const session = this.session(x); if (session && !seen[session.id]) { seen[session.id] = true; data.shiftHistory.push(session); data.currentShiftSequence = Math.max(data.currentShiftSequence, session.shiftSequence) } })
    const active = this.session(input.activeShift); if (active && active.status === "Active") { data.activeShift = active; data.currentShiftSequence = Math.max(data.currentShiftSequence, active.shiftSequence); if (!seen[active.id]) data.shiftHistory.push(active) }
    const activityIds: Record<string, boolean> = {}
    if (Array.isArray(input.activities)) input.activities.forEach(x => { const activity = this.activity(x); if (activity && !activityIds[activity.id]) { activityIds[activity.id] = true; data.activities.push(activity) } })
    const eventIds: Record<string, boolean> = {}
    if (Array.isArray(input.auditEvents)) input.auditEvents.forEach(x => {
      const event = this.auditEvent(x, data.shiftHistory)
      if (event && !eventIds[event.id]) { eventIds[event.id] = true; data.auditEvents.push(event) }
    })
    return data
  }
  private session(value: ShiftSession | null | undefined): ShiftSession | null {
    if (!value || typeof value.id !== "string" || typeof value.employeeName !== "string" || typeof value.shiftSequence !== "number") return null
    if (value.status !== "Active" && value.status !== "Ended") return null
    return {id: value.id, employeeName: value.employeeName.trim(), startedAt: typeof value.startedAt === "string" ? value.startedAt : "", endedAt: typeof value.endedAt === "string" ? value.endedAt : null, shiftSequence: Math.max(1, Math.floor(value.shiftSequence)), status: value.status}
  }
  private activity(value: Activity | null | undefined): Activity | null {
    if (!value || typeof value.id !== "string" || typeof value.department !== "string" || typeof value.title !== "string" || typeof value.description !== "string" || typeof value.createdBy !== "string" || typeof value.createdAt !== "string" || typeof value.createdInShift !== "number") return null
    if ((value.type !== "Pending" && value.type !== "Update") || (value.status !== "Open" && value.status !== "Completed")) return null
    const priority = value.type === "Pending" && (value.priority === "High" || value.priority === "Low") ? value.priority : null
    if (value.type === "Pending" && !priority) return null
    const photoPersistence = value.photoPersistence === "Durable" || value.photoPersistence === "SessionOnly" || value.photoPersistence === "None" ? value.photoPersistence : "None"
    const hasPhoto = photoPersistence !== "None" && value.hasPhoto === true
    return {id: value.id, type: value.type, department: value.department.trim(), title: value.title.trim(), description: value.description.trim(), priority, status: value.status, createdBy: value.createdBy.trim(), createdAt: value.createdAt, createdInShift: Math.max(1, Math.floor(value.createdInShift)), completedBy: typeof value.completedBy === "string" ? value.completedBy.trim() : null, completedAt: typeof value.completedAt === "string" ? value.completedAt : null, completedInShift: typeof value.completedInShift === "number" ? Math.max(1, Math.floor(value.completedInShift)) : null, hasPhoto, photoAttachmentId: photoPersistence === "Durable" && typeof value.photoAttachmentId === "string" ? value.photoAttachmentId : null, photoPersistence: hasPhoto ? photoPersistence : "None"}
  }
  /** Migrates older lightweight events by filling optional detail fields safely. */
  private auditEvent(value: AuditEvent | null | undefined, shifts: ShiftSession[]): AuditEvent | null {
    if (!value || typeof value.id !== "string" || !value.id || typeof value.summary !== "string" || typeof value.timestamp !== "string") return null
    if (value.eventType !== "ShiftStarted" && value.eventType !== "ShiftEnded" && value.eventType !== "ActivityCreated" && value.eventType !== "PendingCompleted") return null
    const shiftSequence = typeof value.shiftSequence === "number" && value.shiftSequence > 0
      ? Math.floor(value.shiftSequence)
      : (() => { const shift = shifts.find(x => x.id === value.shiftId); return shift ? shift.shiftSequence : 0 })()
    return {
      id: value.id, eventType: value.eventType, timestamp: value.timestamp,
      employeeName: typeof value.employeeName === "string" ? value.employeeName.trim() : "",
      shiftId: typeof value.shiftId === "string" ? value.shiftId : "",
      shiftSequence,
      activityId: typeof value.activityId === "string" ? value.activityId : null,
      activityTitle: typeof value.activityTitle === "string" ? value.activityTitle.trim() : null,
      activityType: value.activityType === "Pending" || value.activityType === "Update" ? value.activityType : null,
      department: typeof value.department === "string" ? value.department.trim() : null,
      priority: value.priority === "High" || value.priority === "Low" ? value.priority : null,
      summary: value.summary.trim()
    }
  }
}
