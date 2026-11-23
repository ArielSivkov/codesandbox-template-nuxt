/* ESH27 aviation — camera.js : chase + cockpit cameras for the jet and the ship (three.js objects injected).
 * The rig works in float64 local coordinates (rig.pos is a THREE.Vector3 whose numbers are JS doubles);
 * the far field is drawn camera-relative from it, the near scene uses it directly. */
export class CameraRig {
  constructor(T) { this.T = T; this.view = 'chase'; this.pos = new T.Vector3(); this.q = new T.Quaternion(); this._sq = new T.Quaternion(); this.ok = false;
    this.look = { yaw: 0, pitch: 0 }; this._m = new T.Matrix4(); this._v = new T.Vector3(); this._u = new T.Vector3(); this._t = new T.Vector3(); this._e = new T.Vector3(); }
  toggle() { this.view = this.view === 'chase' ? 'cockpit' : 'chase'; this.ok = false; return this.view; }
  /** pose: {pos:{x,y,z}, q:{x,y,z,w}} (render-interpolated); up: local radial up {x,y,z}; o: {dist, height, eye: Vector3, ahead} */
  update(dt, pose, up, o = {}) {
    const T = this.T, bq = this._bq || (this._bq = new T.Quaternion()); bq.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
    if (this.view === 'cockpit') {
      const e = this._e.copy(o.eye || new T.Vector3(0, 1, -4)).applyQuaternion(bq); this.pos.set(pose.pos.x + e.x, pose.pos.y + e.y, pose.pos.z + e.z);
      this.q.copy(bq); if (this.look.yaw || this.look.pitch) { const lq = new T.Quaternion().setFromEuler(new T.Euler(this.look.pitch, this.look.yaw, 0, 'YXZ')); this.q.multiply(lq); }
      this.ok = true; return this;
    }
    // chase: smoothed body orientation (lazy roll), up blended toward the local vertical
    if (!this.ok) this._sq.copy(bq); else this._sq.slerp(bq, 1 - Math.exp(-dt * (o.stiff || 5)));
    const dist = o.dist || 24, h = o.height || 5;
    const back = this._v.set(0, 0, 1).applyQuaternion(this._sq), bu = this._u.set(0, 1, 0).applyQuaternion(this._sq);
    const U = this._t.set(up.x, up.y, up.z); bu.lerp(U, 0.55).normalize();
    // orbit the camera around the vehicle when the user drags (look.yaw / look.pitch)
    if (this.look.yaw || this.look.pitch) { const ax = new T.Vector3().crossVectors(bu, back).normalize(); back.applyAxisAngle(bu, this.look.yaw).applyAxisAngle(ax, -this.look.pitch); }
    this.pos.set(pose.pos.x + back.x * dist + bu.x * h, pose.pos.y + back.y * dist + bu.y * h, pose.pos.z + back.z * dist + bu.z * h);
    const ah = o.ahead || 8, fwd = new T.Vector3(0, 0, -1).applyQuaternion(this._sq);
    const target = new T.Vector3(pose.pos.x + fwd.x * ah + bu.x * h * 0.25, pose.pos.y + fwd.y * ah + bu.y * h * 0.25, pose.pos.z + fwd.z * ah + bu.z * h * 0.25);
    if (o.minY != null && this.pos.y < o.minY) this.pos.y = o.minY;
    // orientation from (target − pos) with up = bu (float64 subtraction first)
    const z = new T.Vector3(this.pos.x - target.x, this.pos.y - target.y, this.pos.z - target.z).normalize(), x = new T.Vector3().crossVectors(bu, z).normalize(), y = new T.Vector3().crossVectors(z, x);
    this._m.makeBasis(x, y, z); this.q.setFromRotationMatrix(this._m); this.ok = true; return this;
  }
  apply(camera) { camera.position.copy(this.pos); camera.quaternion.copy(this.q); camera.updateMatrixWorld(); }
}
