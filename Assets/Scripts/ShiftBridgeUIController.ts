import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexAlign, FlexAlignSelf, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {TextInputField} from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {ScrollWindow} from "SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {Activity, AuditEvent, PersistentAppData, ShiftBridgeRunState, ShiftBridgeView} from "./ShiftBridgeAppState"
import {ShiftBridgeStorageService} from "./ShiftBridgeStorageService"
import {ShiftBridgeTransitionController} from "./ShiftBridgeTransitionController"

const BUILDING_ICON: Texture = requireAsset("../Icons/domain.png") as Texture
const IMAGE_MATERIAL: Material = requireAsset("../Materials/ImageMaterial.mat") as Material

type TextRole = "Title" | "Header" | "Body" | "Caption" | "Button"
type PendingFilter = "Summary" | "Overdue" | "High" | "Low"
type AuditFilter = "Today" | "Last7Days" | "All"
type AuditMode = "List" | "AdminPin" | "DeleteConfirm"
// Focus-screen hierarchy calibrated for 82 cm: roughly 50% larger than the first pass.
const FONT: Record<TextRole, number> = {Title: 93, Header: 72, Body: 56, Caption: 50, Button: 56}
const PRIMARY_TEXT = new vec4(0.98, 0.99, 1.0, 1.0)
const SECONDARY_TEXT = new vec4(0.78, 0.88, 0.96, 0.96)
const COMPLETED_TEXT = new vec4(0.46, 0.96, 0.62, 0.95)
const DASHBOARD_ROOT_VERTICAL_POSITION = 24
const INPUT_ICON_LAYOUT = {leftInset: 1.25, textOffset: 2.35, size: 1.25, diamondTextSize: 54, depth: 0.35}
// Dashboard is deliberately more compact than the focused setup screens.
// These values are local to the Dashboard and do not affect HUD distance/scale.
const DASHBOARD_LAYOUT = {
  topPosition: new vec3(0, DASHBOARD_ROOT_VERTICAL_POSITION, 0), topSize: new vec2(24, 9.5),
  sidePositionY: -17, sidePositionX: 15, sideSize: new vec2(22, 28),
  auditSize: new vec2(46, 31)
}
// Shared cool panel language for focused and dashboard views.
const PANEL_STYLE = {
  frameMargin: 0.04, inset: 0.16, radius: 2.05,
  fill: new vec4(0.035, 0.085, 0.16, 1), fillOpacity: 0.62,
  borderColor: new vec4(0.30, 0.66, 0.96, 0.72), borderSize: 0.055,
  glowColor: new vec4(0.06, 0.31, 0.78, 1), glowOpacity: 0.13, glowSize: 0.18, glowSoftness: 0.46
}
// Lightweight local obfuscation for the MVP, not secure authentication.
const ADMIN_PIN_HASH = 17209299
function hashAdminPin(value: string): number {
  let hash = 17
  for (let i = 0; i < value.length; i++) hash = hash * 31 + value.charCodeAt(i)
  return hash
}

/** One HUD rig with three persistent dashboard Frame panels. */
@component
export class ShiftBridgeUIController extends BaseScriptComponent {
  // @input
  // @hint("Comfortable HUD tag-along distance in centimeters.")
  followDistance: number = 82
  // @input
  // @hint("Vertical HUD offset in centimeters; negative values sit below center.")
  verticalOffset: number = -7
  // @input
  // @hint("Master spatial scale for tuning the entire ShiftBridge UI rig.")
  globalUIScale: number = 0.72
  // @input
  // @hint("Dashboard-only tag-along elevation in centimeters. Focused screens keep their approved position.")
  dashboardVerticalOffset: number = 3
  // @input
  // @hint("Development only: show RESET LOCAL DATA on the Dashboard.")
  enableDevelopmentDataReset: boolean = false
  @input("Asset.CameraRollModule")
  @hint("Native Camera Roll selector used for one session-local activity photo.")
  cameraRollModule: CameraRollModule | null = null
  @input("Asset.RemoteMediaModule")
  @hint("Loads the selected Camera Roll resource into a runtime Texture.")
  remoteMediaModule: RemoteMediaModule | null = null
  private state = new ShiftBridgeRunState()
  private storage!: ShiftBridgeStorageService
  private data!: PersistentAppData
  private view = ShiftBridgeView.FIRST_TIME_SETUP
  private transitions = new ShiftBridgeTransitionController()
  private top!: SceneObject; private left!: SceneObject; private right!: SceneObject; private modal!: SceneObject
  private topHost!: SceneObject; private leftHost!: SceneObject; private rightHost!: SceneObject; private modalHost!: SceneObject
  private topFrame!: Frame; private leftFrame!: Frame; private rightFrame!: Frame; private modalFrame!: Frame
  private ready = 0
  private formType = "Pending"
  private setupBusiness = ""
  private setupDepartments: string[] = [""]
  private setupStack: SceneObject | null = null
  private setupFocusTarget = 0
  private setupFocusOffset = 0
  // UIKit remains the keyboard owner; these refs make view cleanup and focus
  // intent explicit without racing TextInputComponentManager's built-in handoff.
  private activeInput: TextInputField | null = null
  private endShiftConfirmationArmed = false
  private formDepartment = ""
  private formPriority: "High" | "Low" = "High"
  private pendingFilter: PendingFilter = "Summary"
  private pendingDetail: Activity | null = null
  private updateDetail: Activity | null = null
  // Audit filtering is intentionally view-only; durable records remain in storage.
  private auditFilter: AuditFilter = "Today"
  private auditMode: AuditMode = "List"
  private auditListHost: SceneObject | null = null
  private auditCountText: Text | null = null
  private auditFilterMarkers: {filter: AuditFilter, marker: SceneObject}[] = []
  // Camera Roll returns runtime resources only. Never serialize these textures.
  private runtimePhotoAttachments = new Map<string, Texture>()
  private pendingPhotoTexture: Texture | null = null
  private formPhotoHost: SceneObject | null = null
  private formPhotoStatus = ""
  // The Camera Roll event is registered once for the component lifetime. These
  // flags make late picker/resource callbacks harmless after the form closes.
  private photoPickerActive = false
  private photoPickerRequest = 0
  private photoViewerActivity: Activity | null = null

  onAwake(): void {
    this.storage = new ShiftBridgeStorageService(); this.data = this.storage.load(); this.hydrateRunState()
    this.sceneObject.getTransform().setLocalPosition(new vec3(0, this.verticalOffset, -this.followDistance))
    this.sceneObject.getTransform().setLocalScale(new vec3(this.globalUIScale, this.globalUIScale, this.globalUIScale))
    this.sceneObject.createComponent("Component.Canvas")
    this.top = this.makeFrame("ShiftBridge_TopPanel", DASHBOARD_LAYOUT.topPosition, true, (f, h) => { this.topFrame = f; this.topHost = h })
    this.left = this.makeFrame("ShiftBridge_PendingPanel", new vec3(-DASHBOARD_LAYOUT.sidePositionX, DASHBOARD_LAYOUT.sidePositionY, 0), false, (f, h) => { this.leftFrame = f; this.leftHost = h })
    this.right = this.makeFrame("ShiftBridge_UpdatesPanel", new vec3(DASHBOARD_LAYOUT.sidePositionX, DASHBOARD_LAYOUT.sidePositionY, 0), false, (f, h) => { this.rightFrame = f; this.rightHost = h })
    this.modal = this.makeFrame("ShiftBridge_CenterPanel", new vec3(0, 0, 0), true, (f, h) => { this.modalFrame = f; this.modalHost = h })
    // Dashboard side frames inherit the top panel's single tag-along anchor.
    this.left.setParent(this.top); this.right.setParent(this.top)
    // Keep the side panels in the dashboard anchor's local layout space.
    this.left.getTransform().setLocalPosition(new vec3(-DASHBOARD_LAYOUT.sidePositionX, DASHBOARD_LAYOUT.sidePositionY, 0))
    this.right.getTransform().setLocalPosition(new vec3(DASHBOARD_LAYOUT.sidePositionX, DASHBOARD_LAYOUT.sidePositionY, 0))
    if (this.cameraRollModule && this.remoteMediaModule) this.cameraRollModule.onSelectionsUpdated.add((media: CameraRollMedia[]) => this.onPhotoSelection(media))
    this.createEvent("UpdateEvent").bind((e: UpdateEvent) => { this.transitions.update(e.getDeltaTime()); this.updateSetupFocus(e.getDeltaTime()) })
  }

  private makeFrame(name: string, pos: vec3, useFollow: boolean, onReady: (frame: Frame, host: SceneObject) => void): SceneObject {
    const root = global.scene.createSceneObject(name); root.setParent(this.sceneObject); root.getTransform().setLocalPosition(pos)
    const frame = root.createComponent(Frame.getTypeName()) as Frame
    frame.autoShowHide = false; frame.autoScaleContent = false; frame.allowScaling = false
    frame.onInitialized.add(() => {
      frame.padding = new vec2(1.4, 1.4)
      // Dashboard has one tag-along anchor; focused modal screens retain their native tag-along.
      frame.setUseFollow(false); frame.useTagAlong = useFollow; frame.tagAlongDistance = this.followDistance; frame.setFollowing(useFollow); frame.showFollowButton = false
      if (name === "ShiftBridge_TopPanel") this.applyDashboardAnchorOffset(frame)
      const host = global.scene.createSceneObject(name + "_Content"); host.setParent(frame.contentTransform.getSceneObject()); host.getTransform().setLocalPosition(new vec3(0, 0, 0.6))
      onReady(frame, host); this.ready++; if (this.ready === 4) this.show(this.initialView())
    })
    return root
  }

  /** Frame exposes distance publicly but not its TagAlong elevation. Keep this
   * isolated so only the Dashboard anchor receives the visual placement lift. */
  private applyDashboardAnchorOffset(frame: Frame): void {
    const tagAlong = (frame as any)._tagAlong
    if (tagAlong) tagAlong.verticalOffset = this.dashboardVerticalOffset
  }

  private show(next: ShiftBridgeView): void {
    if (this.ready < 4) return
    if (this.view === ShiftBridgeView.NEW_ACTIVITY_FORM && next !== ShiftBridgeView.NEW_ACTIVITY_FORM) this.dismissPhotoPicker()
    // The viewer is an overlay on the existing Dashboard detail, not a view in
    // the navigation state machine. Any ordinary route change closes it first.
    if (this.photoViewerActivity) { this.photoViewerActivity = null; this.modal.enabled = false }
    if (next !== ShiftBridgeView.DASHBOARD) this.endShiftConfirmationArmed = false
    this.view = next
    this.auditListHost = null; this.auditCountText = null; this.auditFilterMarkers = []
    this.clear(this.topHost); this.clear(this.leftHost); this.clear(this.rightHost); this.clear(this.modalHost)
    if (next === ShiftBridgeView.FIRST_TIME_SETUP) this.setupView()
    else if (next === ShiftBridgeView.START_SHIFT) this.startView()
    else if (next === ShiftBridgeView.DASHBOARD) this.dashboardView()
    else if (next === ShiftBridgeView.NEW_ACTIVITY_FORM) this.activityView()
    else this.auditView()
  }

  private initialView(): ShiftBridgeView {
    if (!this.data.businessConfig || !this.data.businessConfig.setupCompleted) return ShiftBridgeView.FIRST_TIME_SETUP
    return this.data.activeShift && this.data.activeShift.status === "Active" ? ShiftBridgeView.DASHBOARD : ShiftBridgeView.START_SHIFT
  }
  private hydrateRunState(): void {
    const config = this.data.businessConfig
    this.state.businessName = config ? config.businessName : ""; this.state.departments = config ? config.departments.slice() : []
    this.state.activeShift = this.data.activeShift; this.state.employeeName = this.data.activeShift ? this.data.activeShift.employeeName : ""
    this.setupBusiness = this.state.businessName; this.setupDepartments = this.state.departments.length > 0 ? this.state.departments.slice() : [""]
  }

  private setupView(): void {
    this.hideDash(); this.top.enabled = false
    this.modalFrame.innerSize = new vec2(42, 42); this.modal.enabled = true
    this.applySharedPanelStyle(this.modalFrame, this.modalHost, new vec2(42, 42))
    const outer = this.column(this.modalHost, 42, 42, 1.25)
    this.text(outer, "Welcome to ShiftBridge", "Title", 4.8)
    // Only the form body moves for keyboard safety; the title remains stable.
    const stack = this.column(outer, 42, 34, 1.25); this.attach(outer, stack, 34); this.setupStack = stack
    const business = this.setupInput(stack, "Business Name", 42, -1, "building")
    business.text = this.setupBusiness
    for (let i = 0; i < this.setupDepartments.length; i++) {
      const row = this.row(stack, 42, 4.0); this.attach(stack, row, 4.0)
      const field = this.setupInput(row, "Department " + (i + 1), i === 0 ? 42 : 37, i, "diamond")
      field.text = this.setupDepartments[i]
      if (i > 0) this.button(row, "×", 4, () => { this.setupDepartments.splice(i, 1); this.show(ShiftBridgeView.FIRST_TIME_SETUP) })
    }
    if (this.setupDepartments.length < 6) this.button(stack, "+ ADD DEPARTMENT", 22, () => { this.setupDepartments.push(""); this.show(ShiftBridgeView.FIRST_TIME_SETUP) })
    const feedback = this.text(stack, "", "Caption", 2.2)
    this.button(stack, "SAVE SETUP", 17, () => {
      const businessValue = this.setupBusiness.trim()
      const valid = this.setupDepartments.map(x => x.trim()).filter(x => x.length > 0)
      const keys = valid.map(x => x.toLocaleLowerCase())
      if (!businessValue) { feedback.text = "Enter a business name."; return }
      if (valid.length === 0) { feedback.text = "Enter at least one department."; return }
      if (new Set(keys).size !== keys.length) { feedback.text = "Department names must be unique."; return }
      this.storage.saveBusinessConfig(this.data, businessValue, valid)
      this.state.businessName = businessValue; this.state.departments = valid.slice(); this.setupBusiness = businessValue; this.setupDepartments = valid.slice()
      this.transitions.exit(this.modal, () => this.show(ShiftBridgeView.START_SHIFT))
    })
    this.transitions.enter(this.modal)
  }

  private startView(): void {
    this.hideDash(); this.top.enabled = false
    this.modalFrame.innerSize = new vec2(38, 28); this.modal.enabled = true
    this.applySharedPanelStyle(this.modalFrame, this.modalHost, new vec2(38, 28))
    const stack = this.column(this.modalHost, 38, 28, 1.5)
    this.text(stack, "Start Shift", "Title", 5)
    const employee = this.input(stack, "Employee Name", 34)
    const feedback = this.text(stack, "", "Caption", 2.4)
    this.button(stack, "START SHIFT", 18, () => {
      const name = employee.text.trim(); if (!name) { feedback.text = "Enter your name to continue."; return }
      const shift = this.storage.startShift(this.data, name); this.state.employeeName = shift.employeeName; this.state.activeShift = shift; this.resetDashboardModes()
      this.transitions.exit(this.modal, () => this.show(ShiftBridgeView.DASHBOARD))
    })
    this.transitions.enter(this.modal)
  }

  private dashboardView(): void {
    this.modal.enabled = false
    const sideSize = new vec2(DASHBOARD_LAYOUT.sideSize.x, this.enableDevelopmentDataReset ? 32 : DASHBOARD_LAYOUT.sideSize.y)
    this.topFrame.innerSize = DASHBOARD_LAYOUT.topSize; this.leftFrame.innerSize = sideSize; this.rightFrame.innerSize = sideSize
    this.top.enabled = this.left.enabled = this.right.enabled = true
    this.applySharedPanelStyle(this.topFrame, this.topHost, DASHBOARD_LAYOUT.topSize); this.applySharedPanelStyle(this.leftFrame, this.leftHost, sideSize); this.applySharedPanelStyle(this.rightFrame, this.rightHost, sideSize)
    const active = this.data.activeShift; const identity = active ? active.employeeName + " · Shift " + active.shiftSequence : "No active shift"
    const top = this.column(this.topHost, DASHBOARD_LAYOUT.topSize.x, DASHBOARD_LAYOUT.topSize.y, 0); this.text(top, identity, "Caption", 1.5); this.button(top, "+ NEW ACTIVITY", 16, () => { this.transitions.exit(this.left); this.transitions.exit(this.right); this.transitions.exit(this.top, () => this.show(ShiftBridgeView.NEW_ACTIVITY_FORM)) })
    this.renderPendingPanel(sideSize)
    this.renderUpdatesPanel(sideSize)
    this.transitions.enter(this.top); this.transitions.enter(this.left); this.transitions.enter(this.right)
  }

  private renderPendingPanel(size: vec2): void {
    const pending = this.column(this.leftHost, size.x, size.y, 1.0)
    if (this.pendingDetail) { this.renderPendingDetail(pending, this.pendingDetail); return }
    if (this.pendingFilter === "Summary") {
      const overdue = this.openPending("Overdue").length, high = this.openPending("High").length, low = this.openPending("Low").length
      this.text(pending, "PENDING", "Header", 3.2); this.button(pending, "OVERDUE (" + overdue + ")", 17, () => this.openPendingFilter("Overdue"), HorizontalAlignment.Left); this.button(pending, "HIGH PRIORITY (" + high + ")", 17, () => this.openPendingFilter("High"), HorizontalAlignment.Left); this.button(pending, "LOW PRIORITY (" + low + ")", 17, () => this.openPendingFilter("Low"), HorizontalAlignment.Left)
      if (this.enableDevelopmentDataReset) this.button(pending, "RESET LOCAL DATA", 17, () => this.resetLocalData(), HorizontalAlignment.Left)
      return
    }
    this.text(pending, this.pendingFilter === "High" ? "HIGH PRIORITY" : this.pendingFilter === "Low" ? "LOW PRIORITY" : "OVERDUE", "Header", 3.2)
    const items = this.visiblePending(this.pendingFilter)
    if (items.length === 0) this.text(pending, "No matching Pending items.", "Caption", 2.6, HorizontalAlignment.Left)
    else this.scrollableActivityList(pending, 18, 11.8, 3.4, items.length, content => items.forEach(activity => this.pendingRow(content, activity)))
    this.button(pending, "BACK", 8, () => this.openPendingFilter("Summary"))
  }
  private renderPendingDetail(parent: SceneObject, activity: Activity): void {
    const overdue = this.isOverdue(activity) ? " · OVERDUE" : ""
    const layout = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; layout.justifyContent = FlexJustify.SpaceBetween; layout.rowGap = 0
    this.text(parent, "PENDING", "Header", 3.2)
    const content = this.detailTextColumn(parent, activity)
    this.detailPhotoSlot(parent, activity, new vec3(5.9, 5.9, 0.35))
    this.text(content, activity.title, "Body", 2.8, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis); this.text(content, activity.department + " · " + (activity.priority || "") + overdue, "Caption", 2.2, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis); this.text(content, activity.description, "Caption", 3.2, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis); this.text(content, "Created by " + activity.createdBy + " · " + this.compactTime(activity.createdAt), "Caption", 2.2, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis); this.detailPhotoUnavailable(content, activity)
    const footer = this.column(parent, 18, 7.6, 0); this.attach(parent, footer, 7.6)
    const footerLayout = footer.getComponent(FlexLayout.getTypeName()) as FlexLayout; footerLayout.paddingTop = 0; footerLayout.paddingBottom = 0; footerLayout.paddingLeft = 0; footerLayout.paddingRight = 0; footerLayout.justifyContent = FlexJustify.SpaceBetween
    if (activity.status === "Open") this.button(footer, "✓ COMPLETE", 13, () => this.completePending(activity.id)); else this.text(footer, "✓ COMPLETED", "Caption", 2.2, HorizontalAlignment.Left)
    this.button(footer, "BACK", 8, () => { this.pendingDetail = null; this.show(ShiftBridgeView.DASHBOARD) })
  }
  private pendingRow(parent: SceneObject, activity: Activity): void {
    const row = this.row(parent, 18, 3.4); this.attach(parent, row, 3.4)
    const completed = activity.status === "Completed"; const label = activity.title + " · " + activity.department
    // One underlying navigation target owns the whole row. Its passive label
    // and check remain on top, so the check cannot be mistaken for completion.
    this.pendingRowNavigation(row, () => { this.pendingDetail = activity; this.show(ShiftBridgeView.DASHBOARD) })
    this.pendingRowTitle(row, label, completed, this.hasAvailablePhoto(activity))
    if (completed) this.completedCheck(row); else this.openPendingCheck(row)
  }
  private renderUpdatesPanel(size: vec2): void {
    const updates = this.column(this.rightHost, size.x, size.y, 0.7)
    const updatesLayout = updates.getComponent(FlexLayout.getTypeName()) as FlexLayout
    // The panel stays fixed; its title, list, confirmation and actions occupy
    // stable vertical zones rather than competing for the same lower rows.
    updatesLayout.justifyContent = FlexJustify.SpaceBetween; updatesLayout.rowGap = 0
    if (this.updateDetail) { this.renderUpdateDetail(updates, this.updateDetail); return }
    this.text(updates, "UPDATES", "Header", 3.2)
    const items = this.activeUpdates()
    if (items.length === 0) this.text(updates, "No active updates.", "Caption", 2.6, HorizontalAlignment.Left)
    // Three compact rows fit above the fixed Audit / End Shift footer without
    // changing the panel's established outer dimensions.
    else this.scrollableActivityList(updates, 18, 7.8, 2.35, items.length, content => items.forEach(activity => this.button(content, activity.title + " · " + activity.department + " · " + this.compactTime(activity.createdAt) + (this.hasAvailablePhoto(activity) ? "  ▣" : ""), 17, () => { this.updateDetail = activity; this.show(ShiftBridgeView.DASHBOARD) }, HorizontalAlignment.Left, PRIMARY_TEXT, false, 2.35)))
    // Fixed footer zones: scroll rows, confirmation, then the action row.
    const endFeedback = this.text(updates, this.endShiftConfirmationArmed ? "Press END SHIFT again to confirm." : "", "Caption", 1.8)
    const footer = this.row(updates, 18, 3.8); this.attach(updates, footer, 3.8)
    this.button(footer, "AUDIT", 8, () => { this.transitions.exit(this.top); this.transitions.exit(this.left); this.transitions.exit(this.right, () => this.show(ShiftBridgeView.AUDIT_PLACEHOLDER)) })
    this.button(footer, this.endShiftConfirmationArmed ? "CONFIRM END SHIFT" : "END SHIFT", 9, () => this.requestEndShift(endFeedback))
  }
  private renderUpdateDetail(parent: SceneObject, activity: Activity): void {
    const layout = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; layout.justifyContent = FlexJustify.SpaceBetween; layout.rowGap = 0
    this.text(parent, "UPDATES", "Header", 3.2)
    const content = this.detailTextColumn(parent, activity)
    // Update has no Complete action, so its SpaceBetween content sits 1.95 units lower.
    this.detailPhotoSlot(parent, activity, new vec3(5.9, 3.95, 0.35))
    this.text(content, activity.title, "Body", 2.8, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis); this.text(content, activity.department + " · " + this.compactTime(activity.createdAt), "Caption", 2.2, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis); this.text(content, activity.description, "Caption", 3.4, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis); this.text(content, "Created by " + activity.createdBy, "Caption", 2.2, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis); this.detailPhotoUnavailable(content, activity)
    const footer = this.column(parent, 18, 3.8, 0); this.attach(parent, footer, 3.8)
    const footerLayout = footer.getComponent(FlexLayout.getTypeName()) as FlexLayout; footerLayout.paddingTop = 0; footerLayout.paddingBottom = 0; footerLayout.paddingLeft = 0; footerLayout.paddingRight = 0; footerLayout.justifyContent = FlexJustify.End
    this.button(footer, "BACK", 8, () => { this.updateDetail = null; this.show(ShiftBridgeView.DASHBOARD) })
  }
  private openPendingFilter(filter: PendingFilter): void { this.pendingFilter = filter; this.pendingDetail = null; this.show(ShiftBridgeView.DASHBOARD) }
  private completePending(activityId: string): void {
    const active = this.data.activeShift; if (!active) return
    const completed = this.storage.completePending(this.data, activityId, active); if (!completed) return
    this.pendingDetail = completed; this.show(ShiftBridgeView.DASHBOARD)
  }
  private isOverdue(activity: Activity): boolean { return activity.status === "Open" && activity.type === "Pending" && !!this.data.activeShift && this.data.activeShift.shiftSequence > activity.createdInShift }
  private openPending(filter: "Overdue" | "High" | "Low"): Activity[] { return this.data.activities.filter(x => x.type === "Pending" && x.status === "Open" && (filter === "Overdue" ? this.isOverdue(x) : filter === "High" ? x.priority === "High" && !this.isOverdue(x) : x.priority === "Low" && !this.isOverdue(x))) }
  private visiblePending(filter: "Overdue" | "High" | "Low"): Activity[] {
    const active = this.data.activeShift; const list = this.data.activities.filter(x => x.type === "Pending" && (x.status === "Open" || (!!active && x.completedInShift === active.shiftSequence)))
    return list.filter(x => filter === "Overdue" ? this.isOverdue(x) : filter === "High" ? x.priority === "High" && !this.isOverdue(x) : x.priority === "Low" && !this.isOverdue(x)).sort((a, b) => a.createdAt < b.createdAt ? -1 : 1)
  }
  private activeUpdates(): Activity[] { const now = Date.now(); return this.data.activities.filter(x => x.type === "Update" && now < new Date(x.createdAt).getTime() + 86400000).sort((a, b) => a.createdAt > b.createdAt ? -1 : 1) }
  private compactTime(timestamp: string): string { const age = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000)); return age < 60 ? age + "m" : Math.floor(age / 60) + "h" }
  private resetDashboardModes(): void { this.pendingFilter = "Summary"; this.pendingDetail = null; this.updateDetail = null }

  private requestEndShift(feedback: Text): void {
    if (!this.data.activeShift) return
    if (!this.endShiftConfirmationArmed) { this.endShiftConfirmationArmed = true; feedback.text = "Press END SHIFT again to confirm."; return }
    const ended = this.storage.endActiveShift(this.data); if (!ended) return
    this.state.activeShift = null; this.state.employeeName = ""; this.endShiftConfirmationArmed = false; this.resetDashboardModes()
    this.transitions.exit(this.top); this.transitions.exit(this.left); this.transitions.exit(this.right, () => this.show(ShiftBridgeView.START_SHIFT))
  }
  private resetLocalData(): void {
    this.clearRuntimePhotos(); this.data = this.storage.reset(); this.hydrateRunState(); this.endShiftConfirmationArmed = false; this.resetDashboardModes()
    this.transitions.exit(this.top); this.transitions.exit(this.left); this.transitions.exit(this.right, () => this.show(ShiftBridgeView.FIRST_TIME_SETUP))
  }

  private activityView(): void {
    this.modal.enabled = false; this.top.enabled = true; this.topFrame.innerSize = new vec2(62, 48)
    this.applySharedPanelStyle(this.topFrame, this.topHost, new vec2(62, 48))
    const stack = this.column(this.topHost, 62, 48, 0.7); this.text(stack, "NEW ACTIVITY", "Header", 3)
    this.text(stack, "Activity Type: " + this.formType, "Body", 2.4); this.button(stack, "TOGGLE PENDING / UPDATE", 22, () => { this.formType = this.formType === "Pending" ? "Update" : "Pending"; this.show(ShiftBridgeView.NEW_ACTIVITY_FORM) })
    const departments = this.data.businessConfig ? this.data.businessConfig.departments : []
    if (!this.formDepartment && departments.length > 0) this.formDepartment = departments[0]
    this.button(stack, "DEPARTMENT: " + (this.formDepartment || "SELECT"), 30, () => { if (departments.length > 0) { const current = departments.indexOf(this.formDepartment); this.formDepartment = departments[(current + 1 + departments.length) % departments.length]; this.show(ShiftBridgeView.NEW_ACTIVITY_FORM) } })
    if (this.formType === "Pending") this.button(stack, "PRIORITY: " + this.formPriority, 20, () => { this.formPriority = this.formPriority === "High" ? "Low" : "High"; this.show(ShiftBridgeView.NEW_ACTIVITY_FORM) })
    const title = this.input(stack, "Title", 56); const desc = this.input(stack, "Description", 56)
    // Keep this fixed: the square thumbnail and its action row cannot consume
    // the independent Save / Cancel row below it.
    this.formPhotoHost = this.column(stack, 56, 6.0, 0); this.attach(stack, this.formPhotoHost, 6.0)
    const photoLayout = this.formPhotoHost.getComponent(FlexLayout.getTypeName()) as FlexLayout; photoLayout.paddingTop = 0; photoLayout.paddingBottom = 0; photoLayout.paddingLeft = 0; photoLayout.paddingRight = 0
    this.renderFormPhotoSection()
    const feedback = this.text(stack, "", "Caption", 2)
    const actions = this.row(stack, 62, 3.5); this.attach(stack, actions, 3.5); this.button(actions, "SAVE", 8, () => {
      const active = this.data.activeShift; const cleanTitle = title.text.trim(); const cleanDescription = desc.text.trim()
      if (!active) { feedback.text = "Start a shift before creating an activity."; return }
      if (!this.formDepartment) { feedback.text = "Select a department."; return }
      if (!cleanTitle) { feedback.text = "Enter a title."; return }
      if (!cleanDescription) { feedback.text = "Enter a description."; return }
      const photo = this.pendingPhotoTexture
      const activity = this.storage.createActivity(this.data, active, this.formType as "Pending" | "Update", this.formDepartment, this.formType === "Pending" ? this.formPriority : null, cleanTitle, cleanDescription, photo ? "SessionOnly" : "None")
      if (!activity) { feedback.text = "Could not save this activity."; return }
      if (photo) this.runtimePhotoAttachments.set(activity.id, photo)
      this.dismissPhotoPicker(); this.clearPendingPhoto(false); title.text = ""; desc.text = ""; this.formType = "Pending"; this.formDepartment = departments.length > 0 ? departments[0] : ""; this.formPriority = "High"
      this.transitions.exit(this.top, () => this.show(ShiftBridgeView.DASHBOARD))
    }); this.button(actions, "CANCEL", 9, () => { this.dismissPhotoPicker(); this.clearPendingPhoto(false); this.transitions.exit(this.top, () => this.show(ShiftBridgeView.DASHBOARD)) })
    this.transitions.enter(this.top)
  }

  /** Opens the installed native Camera Roll picker for exactly one still image. */
  private openPhotoPicker(): void {
    if (!this.cameraRollModule || !this.remoteMediaModule) { this.formPhotoStatus = "Photo picker is unavailable."; this.renderFormPhotoSection(); return }
    this.photoPickerActive = true
    const options = new CameraRollModule.ShowOptions(); options.selectionLimit = 1; options.showImages = true; options.showVideos = false
    this.cameraRollModule.showMediaPicker(options)
  }
  private onPhotoSelection(media: CameraRollMedia[]): void {
    if (!this.photoPickerActive || this.view !== ShiftBridgeView.NEW_ACTIVITY_FORM || !this.remoteMediaModule) return
    const request = ++this.photoPickerRequest
    this.photoPickerActive = false
    // Explicitly dismiss on selection and on an empty cancellation callback.
    // Preview may keep the picker ribbon visible otherwise.
    this.hidePhotoPickerSurface()
    if (media.length === 0) { this.formPhotoStatus = ""; this.renderFormPhotoSection(); return }
    const selected = media[0]; if (selected.mediaType !== CameraRollMediaType.Image) { this.formPhotoStatus = "Select an image."; this.renderFormPhotoSection(); return }
    this.formPhotoStatus = "Loading photo…"; this.renderFormPhotoSection()
    this.remoteMediaModule.loadResourceAsImageTexture(selected.resource, (texture: Texture) => {
      if (request !== this.photoPickerRequest || this.view !== ShiftBridgeView.NEW_ACTIVITY_FORM) return
      this.pendingPhotoTexture = texture; this.formPhotoStatus = ""; this.renderFormPhotoSection()
    }, () => {
      if (request !== this.photoPickerRequest || this.view !== ShiftBridgeView.NEW_ACTIVITY_FORM) return
      this.formPhotoStatus = "Could not load that photo."; this.renderFormPhotoSection()
    })
  }
  /** Closes the native surface and invalidates any pending async picker result. */
  private dismissPhotoPicker(): void {
    this.photoPickerActive = false
    this.photoPickerRequest++
    this.hidePhotoPickerSurface()
  }
  private hidePhotoPickerSurface(): void {
    if (!this.cameraRollModule) return
    try { this.cameraRollModule.hideMediaPicker() } catch (_) { /* Picker may already be closed. */ }
  }
  /** Updates only the optional media subregion; active native text fields stay intact. */
  private renderFormPhotoSection(): void {
    const host = this.formPhotoHost; if (!host) return
    while (host.getChildrenCount() > 0) host.getChild(0).destroy()
    if (this.pendingPhotoTexture) {
      this.photoThumbnail(host, this.pendingPhotoTexture, 2.9)
      const actions = this.row(host, 34, 2.5); this.attach(host, actions, 2.5)
      this.button(actions, "CHANGE PHOTO", 16, () => this.openPhotoPicker(), HorizontalAlignment.Center, SECONDARY_TEXT, false, 2.5)
      this.button(actions, "REMOVE PHOTO", 14, () => this.clearPendingPhoto(), HorizontalAlignment.Center, SECONDARY_TEXT, false, 2.5)
      return
    }
    this.button(host, "ADD PHOTO", 16, () => this.openPhotoPicker(), HorizontalAlignment.Center, SECONDARY_TEXT, false, 2.8)
    if (this.formPhotoStatus) this.text(host, this.formPhotoStatus, "Caption", 1.8, HorizontalAlignment.Left)
  }
  private clearPendingPhoto(refresh = true): void {
    this.pendingPhotoTexture = null; this.formPhotoStatus = ""
    if (refresh) this.renderFormPhotoSection()
  }
  private hasAvailablePhoto(activity: Activity): boolean { return this.runtimePhotoAttachments.has(activity.id) }
  /** Small passive row marker: it deliberately owns no Button or interaction. */
  private photoIndicator(parent: SceneObject): void {
    const o = this.obj(parent, "PhotoIndicator"); const t = o.createComponent("Component.Text") as Text
    t.text = "▣"; t.size = FONT.Caption; t.textFill.color = SECONDARY_TEXT; t.depthTest = true; t.horizontalAlignment = HorizontalAlignment.Center; t.verticalAlignment = VerticalAlignment.Center; t.layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5)
    const item = o.createComponent(FlexItem.getTypeName()) as FlexItem; item.alignSelf = FlexAlignSelf.Center; item.overrideWidth = 1.3; item.overrideHeight = 3.4
    const flex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if (flex) flex.addItems([item])
  }
  /** Dedicated sibling slot: deliberately omitted from the detail FlexLayout. */
  private detailPhotoSlot(parent: SceneObject, activity: Activity, position: vec3): void {
    const texture = this.runtimePhotoAttachments.get(activity.id)
    if (!texture) return
    const slot = this.obj(parent, "ActivityDetailPhotoSlot", position)
    this.photoThumbnail(slot, texture, 6.2, () => this.openPhotoViewer(activity), FlexAlignSelf.Start, false)
  }
  private detailPhotoUnavailable(parent: SceneObject, activity: Activity): void {
    if (!this.hasAvailablePhoto(activity) && activity.hasPhoto) this.text(parent, "Photo attachment is unavailable in this session.", "Caption", 2.4, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis)
  }
  /** Shared detail split: 10.8 text + 1.0 gap + 6.2 photo within 18 units. */
  private detailTextColumn(parent: SceneObject, activity: Activity): SceneObject {
    const detailRow = this.row(parent, 18, 13.5); this.attach(parent, detailRow, 13.5)
    const hasRuntimePhoto = this.hasAvailablePhoto(activity)
    const textWidth = hasRuntimePhoto ? 10.8 : 18
    const textColumn = this.column(detailRow, textWidth, 13.5, 0)
    const textItem = textColumn.createComponent(FlexItem.getTypeName()) as FlexItem
    textItem.alignSelf = FlexAlignSelf.Start; textItem.overrideWidth = textWidth; textItem.overrideHeight = 13.5
    const rowLayout = detailRow.getComponent(FlexLayout.getTypeName()) as FlexLayout; rowLayout.addItems([textItem])
    const textLayout = textColumn.getComponent(FlexLayout.getTypeName()) as FlexLayout; textLayout.paddingTop = 0; textLayout.paddingBottom = 0; textLayout.paddingLeft = 0; textLayout.paddingRight = 0
    return textColumn
  }
  /**
   * A non-interactive ScrollWindow supplies the same supported mask used by
   * list viewports. The image is scaled by max(width/height), producing a
   * centered square cover crop without stretching the source texture.
   */
  private photoThumbnail(parent: SceneObject, texture: Texture, size: number, onOpen?: () => void, alignSelf: FlexAlignSelf = FlexAlignSelf.Center, addToFlex = true): void {
    const viewport = this.obj(parent, "ActivityPhotoThumbnail")
    if (addToFlex) {
      const item = viewport.createComponent(FlexItem.getTypeName()) as FlexItem; item.alignSelf = alignSelf; item.overrideWidth = size; item.overrideHeight = size
      const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if (parentFlex) parentFlex.addItems([item])
    }
    const clip = viewport.createComponent(ScrollWindow.getTypeName()) as ScrollWindow
    clip.vertical = false; clip.horizontal = false; clip.windowSize = new vec2(size, size); clip.scrollDimensions = new vec2(size, size); clip.interactableEnabled = false; clip.scrollingPaused = true
    const ratio = texture.getHeight() > 0 ? texture.getWidth() / texture.getHeight() : 1
    const cover = this.obj(viewport, "PhotoCover", new vec3(0, 0, 0.08))
    const image = cover.createComponent("Component.Image") as Image; const material = IMAGE_MATERIAL.clone(); material.mainPass.baseTex = texture
    image.clearMaterials(); image.addMaterial(material)
    cover.getTransform().setLocalScale(ratio >= 1 ? new vec3(size * ratio, size, 1) : new vec3(size, size / ratio, 1))
    clip.addObject(cover)
    if (onOpen) {
      // This target deliberately has no Button visual or PrismGhost theme. The
      // runtime photo stays visible and color-accurate in every interaction state.
      const hit = this.obj(viewport, "PhotoThumbnailOpen", new vec3(0, 0, 0.16))
      const collider = hit.createComponent("ColliderComponent") as ColliderComponent
      const shape = Shape.createBoxShape(); shape.size = new vec3(size, size, 0.2); collider.shape = shape
      const interactable = hit.createComponent(Interactable.getTypeName()) as Interactable
      interactable.colliders = [collider]
      interactable.onTriggerEnd.add(onOpen)
      clip.addObject(hit)
    }
  }
  /** Fits an image wholly inside the available region; bands are intentional. */
  private photoContain(parent: SceneObject, texture: Texture, maxWidth: number, maxHeight: number): void {
    const ratio = texture.getHeight() > 0 ? texture.getWidth() / texture.getHeight() : 1
    const width = Math.min(maxWidth, maxHeight * ratio); const height = Math.min(maxHeight, maxWidth / ratio)
    const holder = this.obj(parent, "ActivityPhotoContain")
    const image = holder.createComponent("Component.Image") as Image; const material = IMAGE_MATERIAL.clone(); material.mainPass.baseTex = texture
    image.clearMaterials(); image.addMaterial(material); holder.getTransform().setLocalScale(new vec3(width, height, 1))
    const item = holder.createComponent(FlexItem.getTypeName()) as FlexItem; item.alignSelf = FlexAlignSelf.Center; item.overrideWidth = width; item.overrideHeight = height
    const flex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if (flex) flex.addItems([item])
  }
  /** Reuses the modal frame for one viewer; Dashboard detail objects stay intact behind it. */
  private openPhotoViewer(activity: Activity): void {
    const texture = this.runtimePhotoAttachments.get(activity.id); if (!texture || this.photoViewerActivity) return
    this.dismissPhotoPicker()
    this.photoViewerActivity = activity
    this.transitions.exit(this.top); this.transitions.exit(this.left)
    this.transitions.exit(this.right, () => this.photoViewerView(texture))
  }
  private photoViewerView(texture: Texture): void {
    if (!this.photoViewerActivity) return
    this.clear(this.modalHost)
    const size = new vec2(58, 44)
    this.modalFrame.innerSize = size; this.modal.enabled = true
    this.applySharedPanelStyle(this.modalFrame, this.modalHost, size)
    const stack = this.column(this.modalHost, size.x, size.y, 0)
    const layout = stack.getComponent(FlexLayout.getTypeName()) as FlexLayout; layout.justifyContent = FlexJustify.SpaceBetween; layout.rowGap = 0
    this.text(stack, "PHOTO", "Header", 3.2)
    // 52 × 32 leaves a stable header and close target while containing the
    // complete source image with intentional letter/pillar bands.
    this.photoContain(stack, texture, 52, 32)
    this.button(stack, "CLOSE", 10, () => this.closePhotoViewer())
    this.transitions.enter(this.modal)
  }
  private closePhotoViewer(): void {
    if (!this.photoViewerActivity) return
    this.transitions.exit(this.modal, () => {
      this.photoViewerActivity = null
      // No Dashboard host is cleared here: the original Pending/Update detail
      // state and its surrounding panels are restored exactly as they were.
      this.transitions.enter(this.top); this.transitions.enter(this.left); this.transitions.enter(this.right)
    })
  }

  private auditView(): void {
    this.top.enabled = this.left.enabled = this.right.enabled = false; this.modalFrame.innerSize = DASHBOARD_LAYOUT.auditSize; this.modal.enabled = true
    this.applySharedPanelStyle(this.modalFrame, this.modalHost, DASHBOARD_LAYOUT.auditSize)
    if (this.auditMode === "AdminPin") { this.auditAdminPinView(); this.transitions.enter(this.modal); return }
    if (this.auditMode === "DeleteConfirm") { this.auditDeleteConfirmView(); this.transitions.enter(this.modal); return }
    const stack = this.column(this.modalHost, DASHBOARD_LAYOUT.auditSize.x, DASHBOARD_LAYOUT.auditSize.y, 0)
    const layout = stack.getComponent(FlexLayout.getTypeName()) as FlexLayout; layout.justifyContent = FlexJustify.SpaceBetween
    this.text(stack, "AUDIT LOG", "Title", 3.5)
    this.auditCountText = this.text(stack, "", "Caption", 1.7)
    const filters = this.row(stack, 40, 3.8); this.attach(stack, filters, 3.8)
    this.auditFilterButton(filters, "TODAY", "Today", 12.6)
    this.auditFilterButton(filters, "LAST 7 DAYS", "Last7Days", 12.6)
    this.auditFilterButton(filters, "ALL", "All", 12.6)
    this.auditListHost = this.column(stack, 42, 11.6, 0)
    const listItem = this.auditListHost.createComponent(FlexItem.getTypeName()) as FlexItem
    listItem.alignSelf = FlexAlignSelf.Stretch; listItem.overrideHeight = 11.6
    layout.addItems([listItem])
    const listLayout = this.auditListHost.getComponent(FlexLayout.getTypeName()) as FlexLayout
    listLayout.paddingTop = 0; listLayout.paddingBottom = 0; listLayout.paddingLeft = 0; listLayout.paddingRight = 0
    const footer = this.row(stack, 40, 3.8); this.attach(stack, footer, 3.8)
    const footerLayout = footer.getComponent(FlexLayout.getTypeName()) as FlexLayout; footerLayout.justifyContent = FlexJustify.SpaceBetween
    this.button(footer, "BACK", 9, () => this.transitions.exit(this.modal, () => this.show(ShiftBridgeView.DASHBOARD)))
    this.button(footer, "RESET ALL DATA", 14, () => { this.auditMode = "AdminPin"; this.show(ShiftBridgeView.AUDIT_PLACEHOLDER) }, HorizontalAlignment.Center, SECONDARY_TEXT, false, 2.8)
    this.refreshAuditList()
    this.transitions.enter(this.modal)
  }
  /** Reuses the focused Audit panel for the first administrative guard. */
  private auditAdminPinView(): void {
    const stack = this.column(this.modalHost, DASHBOARD_LAYOUT.auditSize.x, DASHBOARD_LAYOUT.auditSize.y, 1.3)
    this.text(stack, "ADMIN RESET", "Title", 4)
    this.text(stack, "Enter the administrator PIN to continue.", "Body", 3.2)
    const pin = this.input(stack, "Administrator PIN", 40)
    const feedback = this.text(stack, "", "Caption", 2.4, HorizontalAlignment.Left)
    const actions = this.row(stack, 40, 3.8); this.attach(stack, actions, 3.8)
    this.button(actions, "CANCEL", 10, () => this.cancelAuditReset())
    this.button(actions, "CONTINUE", 12, () => {
      const value = pin.text.trim(); pin.text = ""
      if (hashAdminPin(value) !== ADMIN_PIN_HASH) { feedback.text = "Incorrect PIN."; return }
      this.auditMode = "DeleteConfirm"; this.show(ShiftBridgeView.AUDIT_PLACEHOLDER)
    })
  }
  /** A separate destructive acknowledgement prevents reset after PIN entry alone. */
  private auditDeleteConfirmView(): void {
    const stack = this.column(this.modalHost, DASHBOARD_LAYOUT.auditSize.x, DASHBOARD_LAYOUT.auditSize.y, 1.4)
    this.text(stack, "DELETE ALL LOCAL DATA?", "Title", 4)
    this.text(stack, "This permanently removes the business setup, shift history,", "Body", 2.8, HorizontalAlignment.Left)
    this.text(stack, "activities, and audit events from this device.", "Body", 2.8, HorizontalAlignment.Left)
    const actions = this.row(stack, 40, 3.8); this.attach(stack, actions, 3.8)
    this.button(actions, "CANCEL", 10, () => this.cancelAuditReset())
    this.button(actions, "DELETE EVERYTHING", 18, () => this.resetAllLocalData(), HorizontalAlignment.Center, SECONDARY_TEXT)
  }
  private cancelAuditReset(): void { this.auditMode = "List"; this.show(ShiftBridgeView.AUDIT_PLACEHOLDER) }
  /** Clears durable data and every view-facing cache before returning to Setup. */
  private resetAllLocalData(): void {
    this.resetInputFocus()
    this.clearRuntimePhotos(); this.data = this.storage.reset(); this.state = new ShiftBridgeRunState()
    this.setupBusiness = ""; this.setupDepartments = [""]; this.formType = "Pending"; this.formDepartment = ""; this.formPriority = "High"
    this.pendingFilter = "Summary"; this.pendingDetail = null; this.updateDetail = null; this.endShiftConfirmationArmed = false
    this.auditFilter = "Today"; this.auditMode = "List"; this.hydrateRunState()
    this.show(ShiftBridgeView.FIRST_TIME_SETUP)
  }
  private clearRuntimePhotos(): void {
    this.dismissPhotoPicker()
    this.runtimePhotoAttachments.clear(); this.pendingPhotoTexture = null; this.formPhotoHost = null; this.formPhotoStatus = ""; this.photoViewerActivity = null
  }

  private hideDash(): void { this.left.enabled = false; this.right.enabled = false }
  /** Smoothly raises lower focused fields above the keyboard-safe band. */
  private updateSetupFocus(dt: number): void {
    if (!this.setupStack || this.view !== ShiftBridgeView.FIRST_TIME_SETUP) return
    this.setupFocusOffset += (this.setupFocusTarget - this.setupFocusOffset) * Math.min(1, dt * 10)
    const p = this.setupStack.getTransform().getLocalPosition()
    this.setupStack.getTransform().setLocalPosition(new vec3(p.x, this.setupFocusOffset, p.z))
  }
  private attach(parent: SceneObject, child: SceneObject, height: number): void {
    const item = child.createComponent(FlexItem.getTypeName()) as FlexItem
    item.alignSelf = FlexAlignSelf.Stretch; item.overrideHeight = height
    const flex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if (flex) flex.addItems([item])
  }
  private setupInput(parent: SceneObject, placeholder: string, width: number, departmentIndex: number, icon: "building" | "diamond"): TextInputField {
    const field = this.input(parent, placeholder, width, icon)
    field.onTextChanged.add((value: string) => {
      if (departmentIndex < 0) this.setupBusiness = value
      else this.setupDepartments[departmentIndex] = value
    })
    field.onEditMode.add((editing: boolean) => {
      // Department 4–6 move up progressively; returning to idle restores the centered stack.
      this.setupFocusTarget = editing ? Math.max(0, departmentIndex - 1) * 3.3 : 0
    })
    return field
  }
  /** Shared native focus lifecycle for every field produced by input(). */
  private bindInputFocus(field: TextInputField): void {
    field.onEditMode.add((editing: boolean) => {
      if (editing) {
        this.activeInput = field
      } else if (this.activeInput === field) {
        this.activeInput = null
      }
    })
  }
  private resetInputFocus(): void {
    if (this.activeInput) this.activeInput.editMode(false)
    this.activeInput = null
  }
  private addInputIcon(fieldObject: SceneObject, width: number, icon: "building" | "diamond"): void {
    const holder = this.obj(fieldObject, "DecorativeInputIcon", new vec3(-width / 2 + INPUT_ICON_LAYOUT.leftInset, 0, INPUT_ICON_LAYOUT.depth))
    if (icon === "building") {
      const image = holder.createComponent("Component.Image") as Image
      const mat = IMAGE_MATERIAL.clone(); mat.mainPass.baseTex = BUILDING_ICON; mat.mainPass.depthTest = true; mat.mainPass.depthWrite = false
      image.clearMaterials(); image.addMaterial(mat); holder.getTransform().setLocalScale(new vec3(INPUT_ICON_LAYOUT.size, INPUT_ICON_LAYOUT.size, 1))
    } else {
      const t = holder.createComponent("Component.Text") as Text
      t.text = "◆"; t.size = INPUT_ICON_LAYOUT.diamondTextSize; t.textFill.color = SECONDARY_TEXT; t.depthTest = true
      t.horizontalAlignment = HorizontalAlignment.Center; t.verticalAlignment = VerticalAlignment.Center; t.layoutRect = Rect.create(-0.7, 0.7, -0.7, 0.7)
    }
  }
  private clear(host: SceneObject): void { this.resetInputFocus(); while (host.getChildrenCount() > 0) host.getChild(0).destroy() }
  private obj(parent: SceneObject, name: string, pos?: vec3): SceneObject { const o = global.scene.createSceneObject(name); o.setParent(parent); if (pos) o.getTransform().setLocalPosition(pos); return o }
  private column(parent: SceneObject, w: number, h: number, gap: number): SceneObject { return this.flex(parent, w, h, FlexDirection.Column, gap) }
  /** Fixed-height, masked UIKit ScrollWindow shared by all activity/event lists. */
  private scrollableActivityList(parent: SceneObject, width: number, viewportHeight: number, rowHeight: number, count: number, buildRows: (content: SceneObject) => void): void {
    const viewport = this.obj(parent, "ActivityScrollViewport")
    const item = viewport.createComponent(FlexItem.getTypeName()) as FlexItem; item.alignSelf = FlexAlignSelf.Stretch; item.overrideHeight = viewportHeight
    // ScrollWindow's mask uses a ScreenTransform. FlexLayout settles this object's
    // local position after the ScrollWindow is constructed, so keep them in sync.
    const syncMaskPosition = () => {
      const screen = viewport.getComponent("ScreenTransform") as ScreenTransform
      if (screen) screen.position = viewport.getTransform().getLocalPosition()
    }
    const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if (parentFlex) {
      parentFlex.addItems([item])
      parentFlex.onLayoutComplete.add(syncMaskPosition)
    }
    const scroll = viewport.createComponent(ScrollWindow.getTypeName()) as ScrollWindow
    const contentHeight = Math.max(viewportHeight, count * rowHeight + Math.max(0, count - 1) * 0.35)
    scroll.vertical = true; scroll.horizontal = false; scroll.windowSize = new vec2(width, viewportHeight); scroll.scrollDimensions = new vec2(width, contentHeight)
    // ScrollWindow's top edge aligns the first Flex row with the viewport after
    // its deferred layout pass; the native mask clips all lower rows.
    scroll.scrollPosition = new vec2(0, (viewportHeight - contentHeight) * 0.5)
    const content = this.flex(viewport, width, contentHeight, FlexDirection.Column, 0.35)
    const layout = content.getComponent(FlexLayout.getTypeName()) as FlexLayout; layout.paddingTop = 0; layout.paddingBottom = 0; layout.paddingLeft = 0; layout.paddingRight = 0
    scroll.addObject(content); buildRows(content)
    // Preview's world-space Text is not always cropped by ScrollWindow's mask.
    // Cull only after Flex has resolved positions, then update on every scroll.
    let rowsLaidOut = false
    const cullRows = () => {
      const viewportY = viewport.getTransform().getWorldPosition().y
      const scale = Math.abs(viewport.getTransform().getWorldScale().y)
      const top = viewportY + viewportHeight * scale * 0.5
      const bottom = viewportY - viewportHeight * scale * 0.5
      for (let index = 0; index < content.getChildrenCount(); index++) {
        const row = content.getChild(index)
        const y = row.getTransform().getWorldPosition().y
        const half = rowHeight * Math.abs(row.getTransform().getWorldScale().y) * 0.5
        row.enabled = y + half <= top + 0.08 && y - half >= bottom - 0.08
      }
    }
    scroll.onScrollPositionUpdated.add(() => { if (rowsLaidOut) cullRows() })
    scroll.onInitialized.add(() => {
      syncMaskPosition()
      // Do not cull during construction: Flex has not yet assigned row positions
      // and disabled rows would never participate in that first layout pass.
      rowsLaidOut = true
      if (count * rowHeight > viewportHeight) this.scrollIndicator(viewport, width)
    })
  }
  private scrollIndicator(viewport: SceneObject, width: number): void {
    const marker = this.obj(viewport, "ScrollIndicator", new vec3(width / 2 - 0.48, 0, 0.24)); const bar = marker.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    bar.initialize(); bar.size = new vec2(0.12, 1.35); bar.cornerRadius = 0.06; bar.backgroundColor = SECONDARY_TEXT; bar.renderMeshVisual.mainPass.depthTest = true; bar.renderMeshVisual.mainPass.depthWrite = false
  }
  private completedCheck(parent: SceneObject): void {
    const o = this.obj(parent, "CompletedCheck"); const t = o.createComponent("Component.Text") as Text
    t.text = "✓"; t.size = FONT.Button; t.textFill.color = COMPLETED_TEXT; t.depthTest = true; t.horizontalAlignment = HorizontalAlignment.Center; t.verticalAlignment = VerticalAlignment.Center; t.layoutRect = Rect.create(-1, 1, -1, 1)
    const item = o.createComponent(FlexItem.getTypeName()) as FlexItem; item.alignSelf = FlexAlignSelf.Center; item.overrideWidth = 3; item.overrideHeight = 3.4
    const flex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if (flex) flex.addItems([item])
    animate({duration: 0.18, easing: "ease-out-quad", update: (v: number) => { if (!isNull(o)) { const scale = 1 + 0.9 * v; o.getTransform().setLocalScale(new vec3(scale, scale, 1)) } }})
  }
  /** Passive open-state indicator: no Button, Collider, or trigger listener. */
  private openPendingCheck(parent: SceneObject): void {
    const o = this.obj(parent, "OpenPendingCheck"); const t = o.createComponent("Component.Text") as Text
    t.text = "✓"; t.size = FONT.Button; t.textFill.color = SECONDARY_TEXT; t.depthTest = true; t.horizontalAlignment = HorizontalAlignment.Center; t.verticalAlignment = VerticalAlignment.Center; t.layoutRect = Rect.create(-1, 1, -1, 1)
    const item = o.createComponent(FlexItem.getTypeName()) as FlexItem; item.alignSelf = FlexAlignSelf.Center; item.overrideWidth = 3; item.overrideHeight = 3.4
    const flex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if (flex) flex.addItems([item])
  }
  /** Full-width row target stays behind the passive Pending row contents. */
  private pendingRowNavigation(row: SceneObject, action: () => void): void {
    const host = this.obj(row, "PendingRowNavigation", new vec3(0, 0, -0.08))
    const button = host.createComponent(Button.getTypeName()) as Button; button.size = new vec3(18, 3.4, 1); this.applyInteractiveButtonStyle(button)
    this.bindPendingRowAction(button, action)
  }
  private pendingRowTitle(parent: SceneObject, value: string, completed: boolean, photoAvailable: boolean): void {
    const host = this.obj(parent, "PendingRowTitle")
    const item = host.createComponent(FlexItem.getTypeName()) as FlexItem; item.alignSelf = FlexAlignSelf.Start; item.overrideWidth = photoAvailable ? 11.5 : 13.5; item.overrideHeight = 3.4
    const flex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if (flex) flex.addItems([item])
    this.label(host, value, photoAvailable ? 11.5 : 13, HorizontalAlignment.Left, completed ? COMPLETED_TEXT : PRIMARY_TEXT)
    if (completed) this.addStrikeThrough(host, 13.5)
    if (photoAvailable) this.photoIndicator(parent)
  }
  /**
   * Pending rows participate in a ScrollWindow. UIKit's ScrollWindow cancels
   * descendants when SIK recognises a drag; this guard also observes the local
   * drag event, so only a stationary trigger-up can invoke the row action.
   */
  private bindPendingRowAction(button: Button, action: () => void): void {
    let canceledByDrag = false
    button.onInitialized.add(() => {
      button.interactable.onTriggerStart.add(() => { canceledByDrag = false })
      button.interactable.onDragStart.add(() => { canceledByDrag = true })
      button.interactable.onTriggerCanceled.add(() => { canceledByDrag = true })
      button.interactable.onTriggerEndOutside.add(() => { canceledByDrag = true })
    })
    button.onTriggerUp.add(() => { if (!canceledByDrag) action() })
  }
  private row(parent: SceneObject, w: number, h: number): SceneObject {
    const row = this.flex(parent, w, h, FlexDirection.Row, 1)
    // Rows hosting full-height controls must not inherit column card padding.
    const layout = row.getComponent(FlexLayout.getTypeName()) as FlexLayout
    layout.paddingTop = 0; layout.paddingBottom = 0; layout.paddingLeft = 0; layout.paddingRight = 0
    return row
  }
  private flex(parent: SceneObject, w: number, h: number, dir: FlexDirection, gap: number): SceneObject { const o = this.obj(parent, "Layout"); const f = o.createComponent(FlexLayout.getTypeName()) as FlexLayout; f.autoDiscoverItemsOnStart=false; f.width=w; f.height=h; f.direction=dir; f.alignItems=FlexAlign.Stretch; f.justifyContent=FlexJustify.Start; if(dir===FlexDirection.Row) f.columnGap=gap; else f.rowGap=gap; f.paddingTop=1.8; f.paddingBottom=1.8; f.paddingLeft=1.8; f.paddingRight=1.8; return o }
  private text(parent: SceneObject, value: string, role: TextRole, h: number, align: HorizontalAlignment = HorizontalAlignment.Center, overflow: HorizontalOverflow = HorizontalOverflow.Overflow, width?: number): Text {
    const o=this.obj(parent,"Text"); const t=o.createComponent("Component.Text") as Text
    t.text=value; t.depthTest=true; t.size=FONT[role]; t.textFill.color=role==="Caption" ? SECONDARY_TEXT : PRIMARY_TEXT; (t as Text & {weight?:number}).weight=role==="Title"||role==="Header"?700:500
    t.horizontalAlignment=align; t.verticalAlignment=VerticalAlignment.Center; t.horizontalOverflow=overflow; t.layoutRect=width === undefined ? Rect.create(-.5,.5,-.5,.5) : Rect.create(-width/2,width/2,-h/2,h/2)
    const i=o.createComponent(FlexItem.getTypeName()) as FlexItem; i.alignSelf=width === undefined ? FlexAlignSelf.Stretch : FlexAlignSelf.Center; i.overrideHeight=h; if(width !== undefined) i.overrideWidth=width
    const p=parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if(p) p.addItems([i]); return t
  }
  /** Filter controls stay fixed; only the list viewport beneath them is rebuilt. */
  private auditFilterButton(parent: SceneObject, label: string, filter: AuditFilter, width: number): void {
    const button = this.button(parent, label, width, () => {
      if (this.auditFilter !== filter) { this.auditFilter = filter; this.refreshAuditList() }
    })
    const marker = this.obj(button.sceneObject, "AuditFilterActive", new vec3(0, -1.38, 0.2))
    const line = marker.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    line.initialize(); line.size = new vec2(width - 1.3, 0.09); line.cornerRadius = 0.05
    line.backgroundColor = new vec4(0.50, 0.78, 1.0, 0.94); line.renderMeshVisual.mainPass.depthTest = true; line.renderMeshVisual.mainPass.depthWrite = false
    this.auditFilterMarkers.push({filter, marker})
  }
  private refreshAuditList(): void {
    const host = this.auditListHost; if (!host) return
    while (host.getChildrenCount() > 0) host.getChild(0).destroy()
    const events = this.filteredAuditEvents()
    if (this.auditCountText) this.auditCountText.text = events.length + (events.length === 1 ? " event" : " events")
    this.auditFilterMarkers.forEach(entry => { entry.marker.enabled = entry.filter === this.auditFilter })
    if (events.length === 0) {
      this.text(host, "No audit events for this period.", "Caption", 3.2)
      return
    }
    this.scrollableActivityList(host, 40, 11.6, 3.2, events.length, content => events.forEach(event => this.auditEventRow(content, event)))
  }
  private filteredAuditEvents(): AuditEvent[] {
    const now = new Date(); const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000
    return this.data.auditEvents.filter(event => {
      const time = new Date(event.timestamp).getTime(); if (isNaN(time)) return false
      return this.auditFilter === "Today" ? time >= startToday : this.auditFilter === "Last7Days" ? time >= sevenDaysAgo : true
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }
  /** Compact three-zone row: event kind, action, and employee/department context. */
  private auditEventRow(parent: SceneObject, event: AuditEvent): void {
    const row = this.row(parent, 40, 3.2); this.attach(parent, row, 3.2)
    this.text(row, this.auditKind(event), "Caption", 3.2, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis, 7)
    this.text(row, this.auditAction(event), "Body", 3.2, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis, 21)
    this.text(row, this.auditContext(event), "Caption", 3.2, HorizontalAlignment.Left, HorizontalOverflow.Ellipsis, 10)
  }
  private auditKind(event: AuditEvent): string {
    return event.eventType === "ShiftStarted" ? "START" : event.eventType === "ShiftEnded" ? "END" : event.eventType === "ActivityCreated" ? "CREATED" : "DONE"
  }
  private auditAction(event: AuditEvent): string {
    const title = event.activityTitle || event.summary
    if (event.eventType === "ShiftStarted") return "Started Shift " + event.shiftSequence
    if (event.eventType === "ShiftEnded") return "Ended Shift " + event.shiftSequence
    if (event.eventType === "PendingCompleted") return "Completed “" + title + "”"
    return "Created " + (event.priority ? event.priority + " " : "") + (event.activityType || "Activity") + ": " + title
  }
  private auditContext(event: AuditEvent): string {
    const context = event.department || (event.shiftSequence > 0 ? "Shift " + event.shiftSequence : "")
    return event.employeeName + (context ? " · " + context : "") + " · " + this.compactTime(event.timestamp)
  }
  private input(parent: SceneObject, placeholder: string, width: number, icon: "building" | "diamond" = "diamond"): TextInputField { const o=this.obj(parent,placeholder); const f=o.createComponent(TextInputField.getTypeName()) as TextInputField; f.size=new vec3(width,4.0,1); f.placeholderText=placeholder; f.actionSlot="none"; f.textOffset=new vec2(INPUT_ICON_LAYOUT.textOffset,0); this.addInputIcon(o,width,icon); this.bindInputFocus(f); const i=o.createComponent(FlexItem.getTypeName()) as FlexItem; i.alignSelf=FlexAlignSelf.Stretch; i.overrideHeight=4.0; const p=parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if(p) p.addItems([i]); return f }
  /** Shared normal and PrismGhost hover/press treatment for every app button. */
  private applyInteractiveButtonStyle(button: Button): void {
    button.setTheme("SnapOS3", "PrismGhost")
    const surfaceObject = this.obj(button.sceneObject, "ButtonNormalSurface", new vec3(0, 0, -0.12)); const surface = surfaceObject.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    surface.initialize(); surface.size = new vec2(button.size.x, button.size.y); surface.cornerRadius = 0.42; surface.backgroundColor = new vec4(0.16, 0.23, 0.34, 0.20); surface.border = true; surface.borderSize = 0.045; surface.borderColor = new vec4(0.36, 0.58, 0.80, 0.52); surface.borderSoftness = 0.04
    surface.renderMeshVisual.mainPass.depthTest = true; surface.renderMeshVisual.mainPass.depthWrite = false
  }
  /** Shared, non-interactive surface, edge, and restrained blue glow for main panels. */
  private applySharedPanelStyle(frame: Frame, host: SceneObject, size: vec2): void {
    // Keep UIKit's interaction plane, but suppress its opaque SnapOS3 body.
    // The dedicated shared surface below supplies the translucent visual.
    frame.margin = PANEL_STYLE.frameMargin
    const nativeBody = (frame as any)._frameVisual?._rr as RoundedRectangle | null
    if (nativeBody) {
      nativeBody.opacity = 0
      nativeBody.renderMeshVisual.mainPass.border = 0
      nativeBody.renderMeshVisual.enabled = false
    }
    const glowObject = this.obj(host, "PanelGlow", new vec3(0, 0, -0.16)); const glow = glowObject.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    glow.initialize(); glow.size = new vec2(size.x + PANEL_STYLE.frameMargin, size.y + PANEL_STYLE.frameMargin); glow.cornerRadius = PANEL_STYLE.radius + 0.22
    glow.backgroundColor = new vec4(0.08, 0.13, 0.22, 0); glow.opacity = PANEL_STYLE.glowOpacity; glow.border = true; glow.borderSize = PANEL_STYLE.glowSize; glow.borderColor = PANEL_STYLE.glowColor; glow.borderSoftness = PANEL_STYLE.glowSoftness
    glow.renderMeshVisual.mainPass.depthTest = true; glow.renderMeshVisual.mainPass.depthWrite = false
    const surfaceObject = this.obj(host, "PanelSurface", new vec3(0, 0, -0.12)); const surface = surfaceObject.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    surface.initialize(); surface.size = new vec2(size.x - PANEL_STYLE.inset, size.y - PANEL_STYLE.inset); surface.cornerRadius = PANEL_STYLE.radius
    surface.backgroundColor = PANEL_STYLE.fill; surface.opacity = PANEL_STYLE.fillOpacity; surface.border = true; surface.borderSize = PANEL_STYLE.borderSize; surface.borderColor = PANEL_STYLE.borderColor; surface.borderSoftness = 0.05
    surface.renderMeshVisual.mainPass.depthTest = true; surface.renderMeshVisual.mainPass.depthWrite = false
  }
  private button(parent: SceneObject, text: string, width: number, click: (() => void) | null, align: HorizontalAlignment = HorizontalAlignment.Center, labelColor: vec4 = PRIMARY_TEXT, struck = false, height = 3.8): Button { const o=this.obj(parent,text); const b=o.createComponent(Button.getTypeName()) as Button; b.size=new vec3(width,height,1); this.applyInteractiveButtonStyle(b); this.label(o,text,width-.5,align,labelColor); if (struck) this.addStrikeThrough(o, width); const i=o.createComponent(FlexItem.getTypeName()) as FlexItem; i.alignSelf=align===HorizontalAlignment.Left ? FlexAlignSelf.Start : FlexAlignSelf.Center; i.overrideWidth=width; i.overrideHeight=height; const p=parent.getComponent(FlexLayout.getTypeName()) as FlexLayout; if(p) p.addItems([i]); if (click) b.onTriggerUp.add(click); return b }
  private addStrikeThrough(parent: SceneObject, width: number): void { const line = this.obj(parent, "CompletedStrike", new vec3(0.45, 0, 0.18)); const rr = line.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle; rr.initialize(); rr.size = new vec2(Math.max(2, width - 2.1), 0.07); rr.cornerRadius = 0.04; rr.backgroundColor = COMPLETED_TEXT; rr.renderMeshVisual.mainPass.depthTest = true; rr.renderMeshVisual.mainPass.depthWrite = false }
  private label(parent: SceneObject, value: string, width: number, align: HorizontalAlignment = HorizontalAlignment.Center, color: vec4 = PRIMARY_TEXT): void { const label=this.obj(parent,"ButtonLabel",new vec3(0,0,.12)); const t=label.createComponent("Component.Text") as Text; t.text=value; t.depthTest=true; t.size=FONT.Button; t.textFill.color=color; t.horizontalAlignment=align; t.verticalAlignment=VerticalAlignment.Center; t.horizontalOverflow=HorizontalOverflow.Ellipsis; t.layoutRect=align===HorizontalAlignment.Left ? Rect.create(-width/2+.7,width/2-.3,-1.5,1.5) : Rect.create(-width/2,width/2,-1.5,1.5) }
}
