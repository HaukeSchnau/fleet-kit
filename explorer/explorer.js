// The fleet explorer: every view of fleet.json, laid out with ELK, with a failure simulation.
// views.js and d2.js are public/generators compiled by the explorer package.
/* global ELK */
import { views, viewGraph } from "./lib/generators/views.js"
import { d2 } from "./lib/generators/d2.js"

const $ = (sel) => document.querySelector(sel)
const SVGNS = "http://www.w3.org/2000/svg"
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v)
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v)
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid))
  return el
}
const s = (tag, attrs) => {
  const el = document.createElementNS(SVGNS, tag)
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v)
  return el
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage unavailable */ } },
}
const gib = (b) => `${Math.round((b / 2 ** 30) * 10) / 10} GiB`

const fleet = await (await fetch("fleet.json")).json()

// Every node any edge or entity names, with a label, a kind and a second line.
const nodes = new Map()
const node = (id, n) => { if (!nodes.has(id)) nodes.set(id, { id, ...n }) }
for (const [name, host] of Object.entries(fleet.hosts)) {
  const spec = [host.system, host.cpu && `${host.cpu} CPU`, host.memory && gib(host.memory)].filter(Boolean).join(" · ")
  node(`host:${name}`, { kind: "host", label: name, sub: spec, host })
}
for (const [name, n] of Object.entries(fleet.networks)) node(`net:${name}`, { kind: "net", label: name, sub: n.kind, realizer: n.realizer })
for (const [name, e] of Object.entries(fleet.externals)) node(`ext:${name}`, { kind: "ext", label: name, sub: e.provides, realizer: e.realizer })
for (const [id, i] of Object.entries(fleet.instances)) {
  node(id, { kind: "instance", label: i.service, sub: i.slice ? gib(i.slice.memory) : "", hostName: i.host, realizer: i.realizer, inst: i })
  for (const r of i.routes)
    node(`route:${r.fqdn}`, { kind: "route", label: r.fqdn, sub: [r.visibility, r.runtime && "runtime", r.static && "static"].filter(Boolean).join(" · "), hostName: i.host, visibility: r.visibility, runtime: r.runtime, realizer: r.runtime ? "runtime" : "nix" })
  for (const st of i.state) node(`state:${id}:${st.name}`, { kind: "state", label: st.path, sub: st.backup, hostName: i.host })
  for (const sec of i.secrets) node(`secret:${sec}`, { kind: "secret", label: sec, sub: "secret" })
}
for (const [name, host] of Object.entries(fleet.hosts))
  for (const st of host.state) node(`state:${name}:${st.name}`, { kind: "state", label: st.path, sub: st.backup, hostName: name })
for (const e of fleet.edges) for (const id of [e.from, e.to]) node(id, { kind: id.split(":")[0], label: id.slice(id.indexOf(":") + 1), sub: "" })
const nameOf = (n) => (n.kind === "instance" ? `${n.label} on ${n.hostName}` : n.label)

// Failure propagation. down: stops working. degraded: works without something it needs.
function blastRadius(start) {
  const out = new Map([[start, { state: "down", reason: "failed" }]])
  const rank = { degraded: 1, down: 2 }
  const set = (id, state, reason) => {
    const cur = out.get(id)
    if (cur && rank[cur.state] >= rank[state]) return false
    out.set(id, { state, reason })
    return true
  }
  const label = (id) => nameOf(nodes.get(id) || { label: id })
  const hostNets = new Map()
  for (const e of fleet.edges) if (e.kind === "memberOf" && e.from.startsWith("host:")) hostNets.set(e.from, [...(hostNets.get(e.from) || []), e.to])
  const entries = new Map()
  for (const e of fleet.edges) if (e.kind === "enters") entries.set(e.to, [...(entries.get(e.to) || []), e.from])
  const buildSources = new Map()
  for (const e of fleet.edges) if (e.kind === "buildsFrom") buildSources.set(e.from, [...(buildSources.get(e.from) || []), e])
  const reachable = (e) => !e.via || e.via.some((n) => out.get(`net:${n}`)?.state !== "down")
  let changed = true
  for (let guard = 0; changed && guard < 200; guard++) {
    changed = false
    for (const e of fleet.edges) {
      const f = out.get(e.from), t = out.get(e.to)
      if ((e.kind === "runsOn" || e.kind === "hostedBy") && t?.state === "down") changed = set(e.from, "down", `${label(e.to)} is down`) || changed
      if (e.kind === "serves" && f) changed = set(e.to, f.state, `${label(e.from)} is ${f.state}`) || changed
      if (e.kind === "enters" && f?.state === "down" && (entries.get(e.to) || []).every((n) => out.get(n)?.state === "down"))
        changed = set(e.to, "down", `${label(e.from)} is down`) || changed
      if (e.kind === "uses" && t) changed = set(e.from, "degraded", `needs ${label(e.to)}`) || changed
      if (e.kind === "uses" && e.via && e.via.every((n) => out.get(`net:${n}`)?.state === "down"))
        changed = set(e.from, "degraded", `can't reach ${label(e.to)}`) || changed
      if (e.kind === "storesIn" && f?.state === "down") changed = set(e.to, "degraded", `${label(e.from)} is down`) || changed
      if (e.kind === "backedUpTo" && t?.state === "down") changed = set(e.from, "degraded", "no backups") || changed
    }
    // A host rebuilds as long as one of its sources (the forge or a fallback) is up.
    for (const [host, sources] of buildSources)
      if (host !== start && sources.every((e) => out.get(e.to)?.state === "down" || !reachable(e))) changed = set(host, "degraded", "can't rebuild: no source is up and reachable") || changed
    for (const [host, nets] of hostNets)
      if (nets.every((n) => out.get(n)?.state === "down")) changed = set(host, "down", "no network left") || changed
  }
  return out
}

const state = { view: store.get("fleet.view", "ingress"), selected: null, blast: null, zoom: "auto", source: "d2", size: null, vg: null, render: 0 }
const VIEW_LIST = [["placement", null], ...Object.entries(views)]

function renderTabs() {
  const bar = $("#tabs")
  bar.innerHTML = ""
  for (const [key] of VIEW_LIST)
    bar.append(h("button", { class: `tab${key === state.view ? " on" : ""}`, type: "button", onclick: () => { state.view = key; store.set("fleet.view", key); state.selected = null; state.blast = null; render() } }, key))
  $("#question").textContent = state.view === "placement" ? "What runs where, and how much memory has each host promised?" : views[state.view].question
}

// Text measurement for ELK node sizes
const ctx = document.createElement("canvas").getContext("2d")
const FONT = getComputedStyle(document.body).fontFamily
const textW = (t, px, w) => { ctx.font = `${w || 400} ${px}px ${FONT}`; return ctx.measureText(t).width }

let elk
async function renderGraph() {
  const token = state.render
  const view = views[state.view]
  const vg = viewGraph(fleet, view)
  state.vg = vg
  renderSource()
  const canvas = $("#canvas")
  if (typeof ELK === "undefined") { canvas.innerHTML = "<p class='pad muted'>The layout library didn't load. The D2 source below still works.</p>"; return }
  elk ??= new ELK()
  const groups = [...new Set(vg.nodes.flatMap((n) => (n.host ? [n.host] : [])))].sort()
  const children = new Map(groups.map((g) => {
    const hn = nodes.get(`host:${g}`)
    const minW = Math.max(textW(g, 14, 700), textW(hn?.sub || "", 11)) + 28
    return [g, { id: `host:${g}`, children: [], layoutOptions: { "elk.padding": "[top=40,left=12,bottom=12,right=12]", "elk.nodeSize.minimum": `(${Math.ceil(minW)},60)`, "elk.nodeSize.constraints": "MINIMUM_SIZE" } }]
  }))
  const top = [...children.values()]
  const sizes = new Map()
  for (const vn of vg.nodes) {
    const n = nodes.get(vn.id) || vn
    const sub = n.sub || ""
    const w = Math.ceil(Math.max(textW(vn.label, 12.5, 600), sub ? textW(sub, 10.5) : 0, 40) + 22)
    const hgt = sub ? 40 : 28
    sizes.set(vn.id, { w, h: hgt, sub })
    const el = { id: vn.id, width: w, height: hgt }
    if (vn.host && children.has(vn.host) && vn.id !== `host:${vn.host}`) children.get(vn.host).children.push(el)
    else if (!children.has(vn.id.replace(/^host:/, "")) || !vn.id.startsWith("host:")) top.push(el)
  }
  const res = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.json.edgeCoords": "ROOT", "elk.json.shapeCoords": "ROOT", "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "46", "elk.spacing.nodeNode": "12", "elk.spacing.edgeNode": "10",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES", "elk.padding": "[top=10,left=10,bottom=10,right=10]",
    },
    children: top,
    edges: vg.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  })
  if (token !== state.render) return
  draw(res, vg, sizes, new Set(groups.map((g) => `host:${g}`)))
}

function draw(res, vg, sizes, groupIds) {
  const W = Math.ceil(res.width), H = Math.ceil(res.height)
  state.size = { W, H }
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph", role: "img", "aria-label": `${state.view} view` })
  const defs = s("defs")
  for (const k of ["uses", "serves", "enters", "storesIn", "backedUpTo", "reads", "memberOf", "hostedBy", "provides", "buildsFrom", "runsOn"]) {
    const m = s("marker", { id: `a-${k}`, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" })
    m.append(s("path", { d: "M0,0 L10,5 L0,10 z", class: `ah e-${k}` }))
    defs.append(m)
  }
  svg.append(defs)
  const gG = s("g"), gE = s("g"), gN = s("g")
  svg.append(gG, gE, gN)
  const flat = []
  const walk = (n) => { for (const c of n.children || []) { flat.push(c); walk(c) } }
  walk(res)
  for (const c of flat) {
    const n = nodes.get(c.id) || { label: c.id, kind: "?" }
    if (groupIds.has(c.id)) {
      const g = s("g", { class: "grp", "data-id": c.id })
      g.append(s("rect", { x: c.x, y: c.y, width: c.width, height: c.height, rx: 10 }))
      const t = s("text", { x: c.x + 12, y: c.y + 18, class: "gt" }); t.textContent = n.label
      const st = s("text", { x: c.x + 12, y: c.y + 32, class: "gs" }); st.textContent = n.sub || ""
      g.append(t, st)
      g.addEventListener("click", (ev) => { ev.stopPropagation(); select(c.id) })
      gG.append(g)
      continue
    }
    const sz = sizes.get(c.id) || { sub: "" }
    const vis = n.kind === "route" ? ` vis-${n.visibility}` : ""
    const g = s("g", { class: `nd k-${n.kind}${n.runtime || n.realizer === "runtime" ? " runtime" : ""}${vis}`, "data-id": c.id, tabindex: "0" })
    g.append(s("rect", { x: c.x, y: c.y, width: c.width, height: c.height, rx: n.kind === "route" ? c.height / 2 : n.kind === "ext" ? 12 : 6 }))
    const t = s("text", { x: c.x + c.width / 2, y: c.y + (sz.sub ? 17 : 18), class: "nt" }); t.textContent = (vg.nodes.find((x) => x.id === c.id) || n).label
    g.append(t)
    if (sz.sub) { const st = s("text", { x: c.x + c.width / 2, y: c.y + 31, class: "ns" }); st.textContent = sz.sub; g.append(st) }
    g.addEventListener("click", (ev) => { ev.stopPropagation(); select(c.id) })
    g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(c.id) } })
    gN.append(g)
  }
  for (const [i, e] of (res.edges || []).entries()) {
    const meta = vg.edges[Number(e.id.slice(1))] || vg.edges[i]
    for (const sec of e.sections || []) {
      const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint]
      gE.append(s("path", { d: pts.map((p, j) => `${j ? "L" : "M"}${p.x},${p.y}`).join(" "), class: `ed e-${meta.kind}${meta.derived ? " derived" : ""}`, "data-from": meta.from, "data-to": meta.to, "marker-end": `url(#a-${meta.kind})` }))
    }
  }
  svg.addEventListener("click", () => select(null))
  $("#canvas").innerHTML = ""
  $("#canvas").append(svg)
  zoom()
  highlight()
}

function zoom() {
  const svg = $("#canvas svg")
  if (!svg || !state.size) return
  const fit = Math.min(1, ($("#canvas").clientWidth - 2) / state.size.W)
  const scale = state.zoom === "fit" ? fit : Math.max(0.7, fit)
  svg.setAttribute("width", Math.round(state.size.W * scale))
  svg.setAttribute("height", Math.round(state.size.H * scale))
  $("#zoom").textContent = state.zoom === "fit" ? "Readable size" : "Fit everything"
}

function highlight() {
  const root = $("#canvas")
  const svg = root.querySelector("svg")
  if (svg) {
    svg.classList.toggle("has-sel", !!state.selected && !state.blast)
    svg.classList.toggle("has-blast", !!state.blast)
  }
  const near = new Set()
  for (const el of root.querySelectorAll(".ed")) {
    const on = !!state.selected && (el.dataset.from === state.selected || el.dataset.to === state.selected)
    el.classList.toggle("hl", on)
    if (on) { near.add(el.dataset.from); near.add(el.dataset.to) }
  }
  for (const el of root.querySelectorAll("[data-id]")) {
    const id = el.dataset.id
    const b = state.blast?.get(id)
    el.classList.toggle("sel", id === state.selected)
    el.classList.toggle("near", near.has(id))
    el.classList.toggle("down", b?.state === "down")
    el.classList.toggle("degraded", b?.state === "degraded")
  }
}

function select(id) {
  if (state.blast && id !== state.selected) state.blast = null
  state.selected = id
  highlight()
  details()
}

function details() {
  const box = $("#details")
  box.innerHTML = ""
  const id = state.selected
  if (!id) { box.append(h("p", { class: "muted" }, "Click a node for its facts, its edges and what breaks when it fails.")); return }
  const n = nodes.get(id) || { label: id, kind: "?" }
  box.append(h("div", { class: "d-head" }, h("strong", {}, nameOf(n)), n.realizer ? h("span", { class: `chip r-${n.realizer}` }, n.realizer) : null, h("span", { class: "chip" }, n.kind)))
  box.append(h("code", { class: "d-id" }, id))
  const facts = []
  if (n.sub) facts.push(["detail", n.sub])
  if (n.kind === "host") {
    facts.push(["power", n.host.power])
    for (const [cls, sl] of Object.entries(n.host.slices)) facts.push([`${cls} slice`, `${gib(sl.memory)}${sl.each ? `, ${gib(sl.each)} each` : ""}`])
    if (n.host.batch) facts.push(["batch slice", `${gib(n.host.batch.memory)}, shared by ${n.host.batch.classes.join(" and ")}`])
  }
  if (n.inst) {
    for (const e of n.inst.endpoints) facts.push([`${e.name} endpoint`, `${e.protocol} ${e.port}, ${e.visibility}`])
    if (n.inst.slice) facts.push(["budget", gib(n.inst.slice.memory)])
  }
  for (const f of fleet.findings.filter((f) => f.subject === id || f.subject === `host:${n.hostName}` && n.kind === "host"))
    facts.push([`${f.severity} (${f.check})`, `${f.message}${f.accepted ? `; accepted: ${f.accepted}` : ""}`])
  if (facts.length) box.append(h("dl", { class: "facts" }, ...facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])))
  box.append(h("div", { class: "d-actions" }, state.blast
    ? h("button", { class: "btn", type: "button", onclick: () => { state.blast = null; highlight(); details() } }, "Recover")
    : h("button", { class: "btn danger", type: "button", onclick: () => { state.blast = blastRadius(id); highlight(); details() } }, "Fail it")))
  if (state.blast) {
    const down = [], deg = []
    for (const [bid, b] of state.blast) if (bid !== id) (b.state === "down" ? down : deg).push([nodes.get(bid) || { label: bid }, b.reason])
    const li = ([bn, why]) => h("li", {}, nameOf(bn), h("span", { class: "muted" }, ` ${why}`))
    box.append(h("p", { class: "blast-sum" }, `${down.length} down, ${deg.length} degraded in the whole fleet`))
    if (down.length) box.append(h("h4", { class: "t-down" }, "Down"), h("ul", { class: "elist" }, ...down.sort().map(li)))
    if (deg.length) box.append(h("h4", { class: "t-deg" }, "Degraded"), h("ul", { class: "elist" }, ...deg.sort().map(li)))
  }
  const list = (edges, dir) => h("ul", { class: "elist" }, ...edges.slice(0, 50).map((e) => {
    const other = dir === "out" ? e.to : e.from
    return h("li", {}, h("span", { class: "ek" }, e.kind), " ", h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); select(other) } }, nameOf(nodes.get(other) || { label: other })))
  }))
  const out = fleet.edges.filter((e) => e.from === id), inc = fleet.edges.filter((e) => e.to === id)
  if (out.length) box.append(h("h4", {}, "Outgoing"), list(out, "out"))
  if (inc.length) box.append(h("h4", {}, "Incoming"), list(inc, "in"))
}

function renderPlacement() {
  state.size = null
  state.vg = null
  renderSource()
  const wrap = h("div", { class: "hosts" })
  for (const [name, host] of Object.entries(fleet.hosts)) {
    const total = host.ceilings
    const over = host.memory !== undefined && total > host.memory
    // Classes in the batch share its ceiling, so the bar draws the batch once and splits it among them.
    const shared = new Set(host.batch?.classes ?? [])
    const top = Object.entries(host.slices).filter(([cls]) => !shared.has(cls))
    const members = Object.entries(host.slices).filter(([cls]) => shared.has(cls))
    const seg = ([cls, sl]) => h("span", { class: `seg c-${cls}`, style: `flex:${sl.memory}`, title: `${cls} ${gib(sl.memory)}` })
    const sharedBy = members.map(([cls, sl]) => `${cls} ${gib(sl.memory)}`).join(" and ")
    const segs = [
      host.reserve ? h("span", { class: "seg c-reserve", style: `flex:${host.reserve}`, title: `reserve ${gib(host.reserve)}` }) : null,
      ...top.map(seg),
      host.batch ? h("span", { class: "seg batch", style: `flex:${host.batch.memory}`, title: `batch ${gib(host.batch.memory)}, shared by ${sharedBy}` }, ...members.map(seg)) : null,
    ]
    const capacity = host.memory ?? total
    wrap.append(h("div", { class: `hcard${over ? " over" : ""}`, "data-id": `host:${name}`, onclick: () => select(`host:${name}`) },
      h("div", { class: "hc-head" }, h("strong", {}, name), h("span", { class: `chip p-${host.power}` }, host.power)),
      h("div", { class: "hc-spec muted" }, nodes.get(`host:${name}`).sub),
      h("div", { class: "membar" }, ...segs, total < capacity ? h("span", { class: "seg free", style: `flex:${capacity - total}` }) : null),
      h("div", { class: "hc-mem" }, host.memory === undefined ? "memory not declared" : `${gib(total)} of ceilings on ${gib(host.memory)}${over ? `, ${Math.round((total / host.memory) * 10) / 10}x` : ""}`),
      h("div", { class: "legend-mini" }, ...top.map(([cls, sl]) => h("span", {}, h("i", { class: `sw c-${cls}` }), `${cls} ${gib(sl.memory)}`)),
        host.batch ? h("span", {}, h("i", { class: "sw batch" }), `batch ${gib(host.batch.memory)}: ${sharedBy}`) : null),
      h("ul", { class: "svcs" }, ...host.instances.map((id) => h("li", { class: `svc${fleet.instances[id].realizer === "runtime" ? " runtime" : ""}`, "data-id": id, onclick: (ev) => { ev.stopPropagation(); select(id) } },
        fleet.instances[id].service, fleet.instances[id].slice ? h("span", { class: "b" }, gib(fleet.instances[id].slice.memory)) : null)))))
  }
  $("#canvas").innerHTML = ""
  $("#canvas").append(wrap)
  highlight()
}

function renderSource() {
  for (const b of document.querySelectorAll("#src-tabs [data-src]")) b.classList.toggle("on", b.dataset.src === state.source)
  $("#src").textContent = !state.vg ? "The placement view is a table; its data is fleet.json's hosts.<host>.slices and instances."
    : state.source === "d2" ? d2(state.vg) : JSON.stringify(state.vg, null, 2)
}

function renderFindings() {
  const box = $("#findings")
  box.innerHTML = ""
  for (const f of fleet.findings)
    box.append(h("li", { class: `f-${f.accepted ? "accepted" : f.severity}` }, h("strong", {}, `${f.accepted ? "accepted" : f.severity} ${f.check}`), ` ${f.subject}: ${f.message}`, f.accepted ? h("div", { class: "muted" }, f.accepted) : null))
  const c = fleet.coverage
  const total = Object.values(c).reduce((a, b) => a + b, 0)
  $("#coverage").innerHTML = ""
  $("#coverage").append(...["nix", "stack", "runtime", "manual"].map((k) => h("span", { class: `seg r-${k}`, style: `flex:${c[k]}`, title: `${k} ${c[k]}` })))
  $("#coverage-legend").textContent = `${total} entities: ${c.nix} nix, ${c.stack} stack, ${c.runtime} runtime, ${c.manual} manual · ${fleet.edges.length} edges`
}

function render() {
  state.render += 1
  renderTabs()
  details()
  if (state.view === "placement") renderPlacement()
  else renderGraph()
}

$("#zoom").addEventListener("click", () => { state.zoom = state.zoom === "fit" ? "auto" : "fit"; zoom() })
for (const b of document.querySelectorAll("#src-tabs [data-src]")) b.addEventListener("click", () => { state.source = b.dataset.src; renderSource() })
window.addEventListener("resize", zoom)
if (!VIEW_LIST.some(([k]) => k === state.view)) state.view = "ingress"
renderFindings()
render()
