/**
 * Small reusable transform transition. UIKit owns surface rendering; this
 * controller keeps view changes from snapping between their two layouts.
 */
export class ShiftBridgeTransitionController {
  private active: { root: SceneObject; elapsed: number; duration: number; from: number; to: number; onDone?: () => void }[] = []

  enter(root: SceneObject, done?: () => void): void {
    root.enabled = true
    this.start(root, 0.93, 1.0, done)
  }

  exit(root: SceneObject, done?: () => void): void {
    this.start(root, 1.0, 0.93, () => { root.enabled = false; if (done) done() })
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const t = this.active[i]
      t.elapsed += dt
      const p = Math.min(1, t.elapsed / t.duration)
      // Smoothstep mirrors the intended short fade/scale cadence. UIKit owns
      // the panel alpha while its transform supplies the visible motion.
      const eased = p * p * (3 - 2 * p)
      const s = t.from + (t.to - t.from) * eased
      t.root.getTransform().setLocalScale(new vec3(s, s, s))
      if (p >= 1) { this.active.splice(i, 1); if (t.onDone) t.onDone() }
    }
  }

  private start(root: SceneObject, from: number, to: number, onDone?: () => void): void {
    this.active = this.active.filter(x => x.root !== root)
    root.getTransform().setLocalScale(new vec3(from, from, from))
    this.active.push({ root, elapsed: 0, duration: 0.22, from, to, onDone })
  }
}
