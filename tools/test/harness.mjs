#!/usr/bin/env node
/**
 * harness.mjs — a dependency-free fake DOM + fake Web Audio loader that runs
 * the Form 909-WARP inline script under Node's `vm` module.
 *
 * The application is a single HTML file with one inline <script>. There is no
 * browser in CI, and the project forbids runtime dependencies, so the test
 * suite drives the real script through this harness instead:
 *
 *   - The <body> markup is parsed into a minimal DOM (elements, attributes,
 *     ids, classes, datasets, events, a small querySelector engine).
 *   - Web Audio is replaced by a recording fake: every node creation,
 *     connection and scheduled start/stop is logged, and OfflineAudioContext
 *     renders a deterministic signal derived from that log. Two renders with
 *     the same seed therefore produce byte-identical WAV blobs, which is
 *     exactly the property the offline export path promises.
 *
 * What this harness is NOT: a Web Audio implementation. It validates the
 * application's own logic — scheduling, gating, serialisation, parity between
 * the live and offline paths — not the browser's DSP. Perceptual checks remain
 * manual (docs/TESTING.md §5).
 *
 * Usage in tests:
 *
 *   import { loadApp, FakeAudioContext, serializeEvents } from './harness.mjs';
 *   const { app, document, window } = loadApp();
 *   app.loadPreset('confield');
 */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP_FILE = new URL('../../Form-909 Warp IDM Drum Machine.html', import.meta.url);

/* =========================================================================
   Fake DOM
   ========================================================================= */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

function camelCase(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

class FakeClassList {
  constructor(el) { this.el = el; }
  _set() { return new Set(this.el.className.split(/\s+/).filter(Boolean)); }
  _write(s) { this.el.className = [...s].join(' '); }
  add(...cs) { const s = this._set(); cs.forEach((c) => s.add(c)); this._write(s); }
  remove(...cs) { const s = this._set(); cs.forEach((c) => s.delete(c)); this._write(s); }
  contains(c) { return this._set().has(c); }
  toggle(c) { const s = this._set(); if (s.has(c)) { s.delete(c); } else { s.add(c); } this._write(s); return s.has(c); }
}

let fakeEventId = 0;

class FakeEvent {
  constructor(type, props = {}) {
    this.type = type;
    this.id = ++fakeEventId;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    Object.assign(this, props);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

class FakeElement {
  constructor(tagName, doc) {
    this.ownerDocument = doc;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    // dataset reflects to data-* attributes, as in the real DOM — the app both
    // writes cell.dataset.track and queries [data-track="…"] selectors.
    this.dataset = new Proxy({}, {
      set: (t, k, v) => {
        t[k] = v;
        const attr = 'data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
        this.attributes[attr] = String(v);
        return true;
      },
      get: (t, k) => t[k],
      deleteProperty: (t, k) => {
        delete t[k];
        delete this.attributes['data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())];
        return true;
      }
    });
    this.style = {};
    this.classList = new FakeClassList(this);
    this._className = '';
    this._text = '';
    this._listeners = {};
    this.value = '';
    this.files = [];
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = -1;
    this.title = '';
    this.width = 0;
    this.height = 0;
  }

  get className() { return this._className; }
  set className(v) {
    this._className = String(v);
    this.attributes.class = this._className;
  }

  get id() { return this.attributes.id || ''; }
  set id(v) {
    this.attributes.id = String(v);
    this.ownerDocument._register(this);
  }

  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }

  get innerHTML() { return ''; }
  set innerHTML(html) {
    this.children = [];
    this._text = '';
    if (html) parseHTML(this.ownerDocument, String(html), this);
  }

  get firstChild() { return this.children[0] || null; }

  setAttribute(name, value) {
    const v = String(value);
    this.attributes[name] = v;
    if (name === 'class') { this._className = v; }
    else if (name === 'id') { this.ownerDocument._register(this); }
    else if (name.startsWith('data-')) { this.dataset[camelCase(name.slice(5))] = v; }
    else if (name === 'tabindex') { this.tabIndex = parseInt(v, 10); }
    else if (name === 'value') { this.value = v; }
    else if (name === 'disabled') { this.disabled = true; }
    else if (name === 'hidden') { this.hidden = true; }
  }

  getAttribute(name) {
    if (name === 'class') return this._className;
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name] : null;
  }

  removeAttribute(name) { delete this.attributes[name]; }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  remove() { if (this.parentNode) this.parentNode.removeChild(this); }

  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this._listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const fn of [...(this._listeners[event.type] || [])]) fn(event);
    return !event.defaultPrevented;
  }

  click() { this.dispatchEvent(new FakeEvent('click', { target: this })); }

  focus() { this.ownerDocument.activeElement = this; }
  blur() {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }

  getContext() {
    // Canvas 2D stub: every method is a no-op, every property is settable.
    return new Proxy({}, {
      get: (t, k) => (typeof k === 'string' ? () => {} : undefined),
      set: () => true
    });
  }

  querySelector(sel) { return querySelectorAll(this, sel, true)[0] || null; }
  querySelectorAll(sel) { return querySelectorAll(this, sel, false); }
}

/* -----------------------------------------------------------------------
   Minimal selector engine. Supports compound selectors only (no descendant
   combinators): tag, .class, [attr], [attr="v"], :not(<compound>), and
   comma-separated groups. That covers every selector the app uses.
   ----------------------------------------------------------------------- */

function parseCompound(s) {
  const out = { tag: null, classes: [], attrs: [], nots: [] };
  const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|\[([\w-]+)(?:\s*=\s*["']?([^"'\]]*)["']?)?\]|:not\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) out.tag = m[1].toLowerCase();
    else if (m[2]) out.classes.push(m[2]);
    else if (m[3]) out.attrs.push({ name: m[3], value: m[4] });
    else if (m[5]) out.nots.push(parseCompound(m[5]));
  }
  return out;
}

function matchesCompound(el, c) {
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
  for (const attr of c.attrs) {
    const v = el.getAttribute(attr.name);
    if (v === null) return false;
    if (attr.value !== undefined && v !== attr.value) return false;
  }
  for (const not of c.nots) if (matchesCompound(el, not)) return false;
  return true;
}

function querySelectorAll(root, selector, firstOnly) {
  const groups = selector.split(',').map((s) => parseCompound(s.trim()));
  const out = [];
  const walk = (el) => {
    for (const child of el.children) {
      if (groups.some((g) => matchesCompound(child, g))) {
        out.push(child);
        if (firstOnly) return true;
      }
      if (walk(child)) return true;
    }
    return false;
  };
  walk(root);
  return out;
}

/* -----------------------------------------------------------------------
   Minimal HTML parser: builds FakeElements from markup, registering ids.
   ----------------------------------------------------------------------- */

function parseAttrs(el, attrStr) {
  const re = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m;
  while ((m = re.exec(attrStr))) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    el.setAttribute(name, value);
  }
  if (el.tagName === 'CANVAS') {
    el.width = parseInt(el.getAttribute('width'), 10) || 0;
    el.height = parseInt(el.getAttribute('height'), 10) || 0;
  }
}

export function parseHTML(doc, html, root) {
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let m;
  while ((m = re.exec(html))) {
    const tok = m[0];
    if (tok.startsWith('<!--') || tok.startsWith('<!')) continue;
    if (tok[0] === '<') {
      if (tok[1] === '/') {
        const tag = tok.slice(2, -1).trim().toLowerCase();
        while (stack.length > 1) {
          const top = stack.pop();
          if (top.tagName.toLowerCase() === tag) break;
        }
      } else {
        const selfClose = /\/\s*>$/.test(tok);
        const inner = tok.slice(1, tok.length - (selfClose ? 2 : 1));
        const sp = inner.search(/\s/);
        const tag = (sp === -1 ? inner : inner.slice(0, sp)).toLowerCase();
        const attrStr = sp === -1 ? '' : inner.slice(sp);
        const el = doc.createElement(tag);
        parseAttrs(el, attrStr);
        stack[stack.length - 1].appendChild(el);
        if (!selfClose && !VOID_TAGS.has(tag)) stack.push(el);
      }
    } else {
      stack[stack.length - 1]._text += tok;
    }
  }
  return root;
}

class FakeDocument {
  constructor() {
    this._ids = new Map();
    this._listeners = {};
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }
  createElement(tag) { return new FakeElement(tag, this); }
  _register(el) { if (el.id) this._ids.set(el.id, el); }
  getElementById(id) { return this._ids.get(id) || null; }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    const list = this._listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this.body;
    for (const fn of [...(this._listeners[event.type] || [])]) fn(event);
    return true;
  }
}

/* =========================================================================
   Fake Web Audio
   ========================================================================= */

export class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); return this; }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; }
}

let fakeNodeId = 0;

class FakeAudioNode {
  constructor(ctx, nodeKind) {
    this.ctx = ctx;
    this.nodeKind = nodeKind;
    this.id = ++fakeNodeId;
    this.inputs = [];
    this.outputs = [];
    ctx.nodes.push(this);
  }
  connect(dest) {
    this.outputs.push(dest);
    if (dest.inputs) dest.inputs.push(this);
    this.ctx.connections.push([this, dest]);
    return dest;
  }
  disconnect(dest) {
    if (dest) {
      this.outputs = this.outputs.filter((d) => d !== dest);
      dest.inputs = (dest.inputs || []).filter((d) => d !== this);
    } else {
      for (const d of this.outputs) d.inputs = (d.inputs || []).filter((n) => n !== this);
      this.outputs = [];
    }
  }
}

export class FakeAudioBuffer {
  constructor(channels, length, sampleRate, data) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._data = data || Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(i) { return this._data[i]; }
  copyToChannel(src, i) { this._data[i].set(src); }
}

class FakeOscillatorNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'oscillator');
    this.type = 'sine';
    this.frequency = new FakeAudioParam(440);
    this.detune = new FakeAudioParam(0);
  }
  setPeriodicWave(w) { this.periodicWave = w; }
  start(t = 0) { this.startedAt = t; this.ctx.events.push({ kind: 'oscStart', node: this, time: t }); }
  stop(t = 0) { this.stoppedAt = t; this.ctx.events.push({ kind: 'oscStop', node: this, time: t }); }
}

class FakeBufferSourceNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'bufferSource');
    this.buffer = null;
    this.loop = false;
    this.playbackRate = new FakeAudioParam(1);
  }
  start(t = 0, offset = 0, duration) {
    this.startedAt = t;
    this.ctx.events.push({ kind: 'bufferStart', node: this, time: t, offset, duration });
  }
  stop(t = 0) { this.stoppedAt = t; this.ctx.events.push({ kind: 'bufferStop', node: this, time: t }); }
}

class FakeGainNode extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'gain'); this.gain = new FakeAudioParam(1); }
}

class FakeBiquadFilterNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'biquadFilter');
    this.type = 'lowpass';
    this.frequency = new FakeAudioParam(350);
    this.Q = new FakeAudioParam(1);
    this.gain = new FakeAudioParam(0);
    this.detune = new FakeAudioParam(0);
  }
}

class FakeWaveShaperNode extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'waveShaper'); this.curve = null; this.oversample = 'none'; }
}

class FakeDelayNode extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'delay'); this.delayTime = new FakeAudioParam(0); }
}

class FakeDynamicsCompressorNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'dynamicsCompressor');
    this.threshold = new FakeAudioParam(-24);
    this.knee = new FakeAudioParam(30);
    this.ratio = new FakeAudioParam(12);
    this.attack = new FakeAudioParam(0.003);
    this.release = new FakeAudioParam(0.25);
    this.reduction = 0;
  }
}

class FakeAnalyserNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'analyser');
    this.fftSize = 2048;
    this.smoothingTimeConstant = 0.8;
  }
  get frequencyBinCount() { return this.fftSize / 2; }
  getByteTimeDomainData(arr) { arr.fill(128); }
  getByteFrequencyData(arr) { arr.fill(0); }
}

class FakeStereoPannerNode extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'stereoPanner'); this.pan = new FakeAudioParam(0); }
}

class FakeMediaStreamDestinationNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'mediaStreamDestination');
    this.stream = { getTracks: () => [{ stop() {} }] };
  }
}

export class FakeAudioContext {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 48000;
    this.state = 'suspended';
    this.nodes = [];
    this.connections = [];
    this.events = [];
    this.destination = new FakeAudioNode(this, 'destination');
    this._t0 = Date.now();
  }
  // A live context runs on wall-clock time so the scheduler can be exercised.
  get currentTime() { return (Date.now() - this._t0) / 1000; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }

  createGain() { return new FakeGainNode(this); }
  createOscillator() { return new FakeOscillatorNode(this); }
  createBufferSource() { return new FakeBufferSourceNode(this); }
  createBiquadFilter() { return new FakeBiquadFilterNode(this); }
  createWaveShaper() { return new FakeWaveShaperNode(this); }
  createDelay() { return new FakeDelayNode(this); }
  createDynamicsCompressor() { return new FakeDynamicsCompressorNode(this); }
  createAnalyser() { return new FakeAnalyserNode(this); }
  createStereoPanner() { return new FakeStereoPannerNode(this); }
  createChannelMerger() { return new FakeAudioNode(this, 'channelMerger'); }
  createChannelSplitter() { return new FakeAudioNode(this, 'channelSplitter'); }
  createMediaStreamDestination() { return new FakeMediaStreamDestinationNode(this); }
  createPeriodicWave(real, imag) { return { real, imag }; }
  createBuffer(channels, length, sampleRate) {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class FakeOfflineAudioContext extends FakeAudioContext {
  constructor(channels, length, sampleRate) {
    super({ sampleRate });
    this.channelCount = channels;
    this.length = length;
    this._suspends = [];
    this._t0 = 0;
  }
  // Offline time only advances when rendered; the app never reads it mid-build.
  get currentTime() { return 0; }

  suspend(t) {
    this._suspends.push(t);
    this.state = 'suspended';
    return Promise.resolve();
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  async startRendering() {
    // Drive through the suspend() checkpoints the app scheduled. The app's
    // progress pump only calls resume() after it has observed the context in
    // the 'running' state and then seen it park at 'suspended' — so each
    // checkpoint must hold 'running' long enough for a pump tick (30 ms)
    // before parking. A deadline guarantees the fake can never hang a test.
    this.state = 'suspended';
    await sleep(0);
    for (const t of this._suspends) {
      this.state = 'running';
      await sleep(40);
      this.state = 'suspended';
      const deadline = Date.now() + 5000;
      while (this.state === 'suspended' && Date.now() < deadline) await sleep(2);
    }
    this.state = 'running';
    await sleep(10);
    const buffer = this._renderFake();
    this.state = 'suspended';
    return buffer;
  }

  /**
   * Produce a deterministic signal from the recorded event log: every started
   * oscillator contributes a short decaying sine at its initial frequency,
   * every buffer source a short noise burst. The content is not meant to
   * sound like the app — it is a deterministic function of the schedule, so
   * identical schedules produce identical bytes and different schedules
   * produce different bytes.
   */
  _renderFake() {
    const { channelCount, length, sampleRate } = this;
    const chans = Array.from({ length: channelCount }, () => new Float32Array(length));
    let rngState = 0x2f6e2b1 >>> 0;
    const lcg = () => {
      rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
      return rngState / 4294967296;
    };
    for (const ev of this.events) {
      const startSample = Math.max(0, Math.min(length - 1, Math.round(ev.time * sampleRate)));
      if (ev.kind === 'oscStart') {
        const freq = Math.max(1, ev.node.frequency ? ev.node.frequency.value : 440);
        const dur = Math.min(0.25, (length - startSample) / sampleRate);
        const n = Math.floor(dur * sampleRate);
        for (let i = 0; i < n; i++) {
          const s = Math.sin((2 * Math.PI * freq * i) / sampleRate) * Math.exp(-i / (sampleRate * 0.05)) * 0.15;
          for (let c = 0; c < channelCount; c++) chans[c][startSample + i] += s;
        }
      } else if (ev.kind === 'bufferStart') {
        const n = Math.min(Math.floor(0.03 * sampleRate), length - startSample);
        for (let i = 0; i < n; i++) {
          const s = (lcg() * 2 - 1) * 0.1;
          for (let c = 0; c < channelCount; c++) chans[c][startSample + i] += s;
        }
      }
    }
    return new FakeAudioBuffer(channelCount, length, sampleRate, chans);
  }
}

/**
 * Reduce a fake context's event log to a comparable plain structure: the kind
 * and time of every scheduled event plus the salient parameter values. Used
 * to assert that two contexts received identical schedules.
 */
export function serializeEvents(ctx) {
  return ctx.events.map((ev) => {
    const node = ev.node;
    const out = { kind: ev.kind, time: ev.time };
    if (node.frequency) out.freq = node.frequency.value;
    if (node.playbackRate) out.rate = node.playbackRate.value;
    if (node.type && node.nodeKind === 'oscillator') out.wave = node.type;
    if (node.nodeKind === 'biquadFilter') {
      out.filterType = node.type;
      out.filterFreq = node.frequency.value;
      out.filterQ = node.Q.value;
    }
    if (node.nodeKind === 'bufferSource' && node.buffer) {
      out.bufferLen = node.buffer.length;
      out.bufferHash = hashBuffer(node.buffer.getChannelData(0));
    }
    return out;
  });
}

function hashBuffer(arr) {
  let h = 0;
  const step = Math.max(1, Math.floor(arr.length / 512));
  for (let i = 0; i < arr.length; i += step) h = (Math.imul(h, 31) + arr[i]) | 0;
  return h;
}

/* =========================================================================
   Sandbox assembly
   ========================================================================= */

class FakeURL extends URL {
  static createObjectURL() { return `blob:fake-${++fakeObjectUrlId}`; }
  static revokeObjectURL() {}
}
let fakeObjectUrlId = 0;

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _store: store
  };
}

// Intervals (scheduler, lore ticker) are unref'd so they never keep the test
// process alive. Timeouts stay ref'd: the export progress pump and the fake
// offline renderer are driven by short timeout chains, and an awaited promise
// does not keep the event loop alive on its own — unref'd timeouts there let
// the loop drain and the test hang.
const unref = (fn) => (...args) => {
  const handle = fn(...args);
  if (handle && typeof handle.unref === 'function') handle.unref();
  return handle;
};

/**
 * Load the application: parse its body markup into a fake DOM, run its inline
 * script in a vm sandbox with fake Web Audio, and return the handles tests
 * need. Options:
 *
 *   - `hash`        initial value of location.hash (URL-fragment sessions)
 *   - `mediaRecorder`  a MediaRecorder constructor, or undefined to simulate
 *                      a browser without recording support
 *   - `htmlPath`    override the app file location
 */
export function loadApp(options = {}) {
  // options.localStorage: install a pre-seeded fake localStorage (used to test
  // that boot restores an autosaved session).
  const html = readFileSync(options.htmlPath || APP_FILE, 'utf8');

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) throw new Error('harness: no <body> found in the app file');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error('harness: no inline <script> found in the app file');

  // The body contains the script block itself; strip it before parsing so the
  // parser never sees JavaScript (which is full of `<` comparisons).
  const bodyHtml = bodyMatch[1].replace(/<script>[\s\S]*?<\/script>/, '');

  const document = new FakeDocument();
  parseHTML(document, bodyHtml, document.body);

  const windowListeners = {};
  const window = {
    document,
    AudioContext: FakeAudioContext,
    OfflineAudioContext: FakeOfflineAudioContext,
    webkitAudioContext: FakeAudioContext,
    webkitOfflineAudioContext: FakeOfflineAudioContext,
    MediaRecorder: options.mediaRecorder,
    localStorage: options.localStorage || makeLocalStorage(),
    location: { hash: options.hash || '', href: 'http://localhost/', replace() {} },
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const list = windowListeners[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatchEvent(event) {
      for (const fn of [...(windowListeners[event.type] || [])]) fn(event);
      return true;
    }
  };
  window.window = window;

  const sandbox = {
    window,
    document,
    console,
    navigator: {},
    performance,
    Blob,
    Response,
    TextEncoder,
    TextDecoder,
    URL: FakeURL,
    CompressionStream,
    DecompressionStream,
    localStorage: window.localStorage,
    location: window.location,
    setTimeout,
    clearTimeout,
    setInterval: unref(setInterval),
    clearInterval,
    // Never invoke the callback: the oscilloscope loop would run forever.
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {}
  };

  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], sandbox, { filename: 'Form-909 Warp IDM Drum Machine.html#script' });

  if (!window.Form909Warp) {
    throw new Error('harness: the app did not expose window.Form909Warp — did the script throw during boot?');
  }

  return { window, document, sandbox, app: window.Form909Warp };
}

export { FakeEvent, FakeDocument, FakeElement };
