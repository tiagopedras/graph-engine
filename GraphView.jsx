// The diagram itself: a focused-node tree that expands on click, laid out by
// ELK and drawn by Cytoscape. Nothing in this file reads a ds-snapshot, or
// knows what a "component" or a "token" is — it draws whatever `graph` (see
// graph.js's loadGraph) and `focusedId` it's given, and colours a node's
// `kind` however `kindColor` says to. A caller with entirely different data
// and vocabulary can reuse this file unchanged.
import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import elk from "cytoscape-elk";

cytoscape.use(elk);

const DEFAULT_COLOR = "#9ca3af";
const LABEL_FONT = "11px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif";
const NODE_H_PADDING = 16;
const BADGE_SIZE = 22;
const BADGE_GAP = 6;
const NODE_GAP = 24;
let measureCtx = null;

// Cytoscape's built-in `width: 'label'` sizing only becomes accurate once
// the renderer has measured text at least once, which isn't guaranteed by
// the time the first layout runs. Measuring labels ourselves up front keeps
// node width available immediately, so ELK spaces nodes correctly from the
// very first layout instead of packing them as if unlabeled.
function measureLabelWidth(label) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = LABEL_FONT;
  return Math.ceil(measureCtx.measureText(label).width) + NODE_H_PADDING;
}

// Walks one direction (outgoing for dependencies, incoming for dependents)
// starting from the hub, but only crosses a node's own edges if that node is
// the hub itself or has been explicitly expanded — everything else stops one
// hop short. A node whose edges exist but weren't followed gets flagged in
// `hasHidden`, which is what drives its own "+" badge. This applies uniformly
// to every kind in the chain (component → token → token → primitive, …), so
// a token's primitive stays collapsed behind its own badge exactly like any
// other grandparent would.
function frontierWalk(startId, edgeMap, neighborId, expandedIds) {
  const parentEdge = new Map();
  const visited = new Set([startId]);
  const hasHidden = new Map();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    const canExpand = id === startId || expandedIds.has(id);
    const edges = edgeMap.get(id) || [];
    let childCount = 0;
    for (const e of edges) {
      childCount++;
      const nid = neighborId(e);
      if (canExpand && !visited.has(nid)) {
        visited.add(nid);
        parentEdge.set(nid, e);
        queue.push(nid);
      }
    }
    hasHidden.set(id, !canExpand && childCount > 0);
  }
  visited.delete(startId);
  return { visited, parentEdge, hasHidden };
}

// Builds a two-sided tree: what the focused node depends on (above) and
// what depends on it (below). Only direct parents/children are shown at
// first; anything past that stays behind a small "+" badge attached to the
// specific node that hides it, so expanding one branch never reveals
// unrelated ones. Badges carry no edge — they're positioned directly against
// their node after layout (see positionBadges) and only turn into a real,
// connected part of the tree once clicked.
function buildElements(graph, focusedId, expandedIds) {
  const depsWalk = frontierWalk(focusedId, graph.outgoing, (e) => e.to, expandedIds);
  const dependentsWalk = frontierWalk(focusedId, graph.incoming, (e) => e.from, expandedIds);

  const roles = new Map([[focusedId, "selected"]]);
  for (const id of depsWalk.visited) roles.set(id, "dependency");
  for (const id of dependentsWalk.visited) roles.set(id, "dependent");

  const elements = [];
  for (const [id, role] of roles) {
    const n = graph.nodeById.get(id);
    const label = n?.name || id.split("/").pop();
    elements.push({
      data: {
        id,
        label,
        width: measureLabelWidth(label),
        kind: n?.kind || "unknown",
        role,
        external: !!n?.external,
      },
    });
  }

  const seenEdges = new Set();
  // Display edges are the reverse of the data edge: raw `from` depends on
  // `to`, so reversing puts the depended-upon node above (ELK direction DOWN
  // places an edge's source above its target) for both walks uniformly.
  const addEdge = (raw) => {
    const key = `${raw.to}->${raw.from}->${raw.type}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    elements.push({
      data: {
        id: key,
        source: raw.to,
        target: raw.from,
        type: raw.type,
        props: raw.props,
        mode: raw.mode,
      },
    });
  };
  for (const [id, e] of depsWalk.parentEdge) if (roles.has(id)) addEdge(e);
  for (const [id, e] of dependentsWalk.parentEdge) if (roles.has(id)) addEdge(e);

  const addBadge = (targetId, side) => {
    elements.push({
      data: {
        id: `__expand__${targetId}__${side}`,
        label: "+",
        width: BADGE_SIZE,
        kind: "expand-badge",
        role: "expand-badge",
        expandsId: targetId,
        side,
      },
    });
  };
  for (const [id, hidden] of depsWalk.hasHidden) if (hidden && roles.has(id)) addBadge(id, "dependency");
  for (const [id, hidden] of dependentsWalk.hasHidden)
    if (hidden && roles.has(id)) addBadge(id, "dependent");

  return elements;
}

// ELK centres the hub over its neighbours only loosely — good enough for a
// generic graph, not tight enough for this always-symmetric hub-and-spoke
// shape. Snap every rank to equal gaps, centred on the hub's position along
// the cross-axis, once ELK has placed everything so real node sizes are
// known. In a vertical tree ranks are horizontal rows centred on x; in a
// horizontal tree they're vertical columns centred on y.
function centerRanks(cy, focusedId, gap, vertical) {
  const hub = cy.$id(focusedId);
  if (hub.empty()) return;
  const mainAxis = vertical ? "x" : "y";
  const rankAxis = vertical ? "y" : "x";
  const sizeOf = (n) => (vertical ? n.width() : n.height());
  const hubMain = hub.position(mainAxis);
  const hubRank = Math.round(hub.position(rankAxis));
  const ranks = new Map();
  cy.nodes().forEach((n) => {
    if (n.data("role") === "expand-badge") return;
    const rank = Math.round(n.position(rankAxis));
    if (!ranks.has(rank)) ranks.set(rank, []);
    ranks.get(rank).push(n);
  });
  for (const [rank, rankNodes] of ranks) {
    if (rank === hubRank) continue;
    rankNodes.sort((a, b) => a.position(mainAxis) - b.position(mainAxis));
    const total = rankNodes.reduce((sum, n) => sum + sizeOf(n), 0) + gap * (rankNodes.length - 1);
    let pos = hubMain - total / 2;
    for (const n of rankNodes) {
      n.position(mainAxis, pos + sizeOf(n) / 2);
      pos += sizeOf(n) + gap;
    }
  }
}

// Badges have no edge, so ELK never sees them — place each directly against
// the outer edge of the node it belongs to (above/below in a vertical tree,
// left/right in a horizontal one), on the side further from the hub.
function positionBadges(cy, vertical) {
  cy.nodes('[role = "expand-badge"]').forEach((badge) => {
    const target = cy.$id(badge.data("expandsId"));
    if (target.empty()) return;
    const away = badge.data("side") === "dependency" ? -1 : 1;
    if (vertical) {
      const offset = (target.height() + BADGE_SIZE) / 2 + BADGE_GAP;
      badge.position({ x: target.position("x"), y: target.position("y") + away * offset });
    } else {
      const offset = (target.width() + BADGE_SIZE) / 2 + BADGE_GAP;
      badge.position({ x: target.position("x") + away * offset, y: target.position("y") });
    }
  });
}

// `kindColor` maps a node's `kind` to a CSS colour; anything not in the map
// falls back to a neutral grey, so this renders something sensible even for
// a caller that passes none at all.
export default function GraphView({
  graph,
  focusedId,
  kindColor = {},
  onPreview,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [vertical, setVertical] = useState(true);
  const prevFocusedIdRef = useRef(null);
  const prevVerticalRef = useRef(vertical);
  const savedViewportRef = useRef(null);

  // Start fully collapsed again whenever the focused node changes.
  useEffect(() => setExpandedIds(new Set()), [focusedId]);

  const elements = useMemo(
    () => (focusedId ? buildElements(graph, focusedId, expandedIds) : []),
    [graph, focusedId, expandedIds],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const colorOf = (el) => kindColor[el.data("kind")] || DEFAULT_COLOR;
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": colorOf,
            "label": "data(label)",
            "color": "#fff",
            "text-outline-width": 2,
            "text-outline-color": colorOf,
            "font-size": 11,
            "text-valign": "center",
            "text-halign": "center",
            "width": "data(width)",
            "height": 28,
            "shape": "round-rectangle",
            "opacity": (el) => (el.data("external") ? 0.5 : 1),
          },
        },
        {
          selector: "node[role = 'selected']",
          style: {
            "border-width": 3,
            "border-color": "#f43f5e",
            "font-weight": "bold",
            "font-size": 13,
          },
        },
        {
          selector: "node[role = 'expand-badge']",
          style: {
            "shape": "ellipse",
            "height": BADGE_SIZE,
            "background-color": "#6b7280",
            "text-outline-color": "#6b7280",
            "font-size": 15,
            "font-weight": "bold",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#9ca3af",
            "target-arrow-color": "#9ca3af",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            opacity: 0.7,
          },
        },
      ],
      layout: { name: "preset" },
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 3,
    });

    // Tapping a node only previews it — the map keeps its current focus
    // until the user explicitly commits from the right-hand panel. The hub
    // itself is a no-op (it's already what's focused).
    cy.on("tap", "node", (evt) => {
      const d = evt.target.data();
      if (d.role === "expand-badge") {
        setExpandedIds((prev) => new Set(prev).add(d.expandsId));
      } else if (d.role !== "selected") {
        onPreview(evt.target.id());
      }
    });

    // Badges carry no edge, so keep them out of ELK's graph entirely —
    // otherwise they'd show up as disconnected singletons and get placed
    // wherever ELK packs stray components, rather than beside their node.
    const layout = cy
      .elements()
      .not('[role = "expand-badge"]')
      .layout({
        name: "elk",
        fit: false,
        padding: 40,
        elk: {
          algorithm: "layered",
          "elk.direction": vertical ? "DOWN" : "RIGHT",
          "elk.spacing.nodeNode": NODE_GAP,
          "elk.layered.spacing.nodeNodeBetweenLayers": 60,
        },
      });
    layout.one("layoutstop", () => {
      centerRanks(cy, focusedId, NODE_GAP, vertical);
      positionBadges(cy, vertical);

      // A brand-new hub (or a flipped orientation) is a different enough
      // scene to warrant framing it. Expanding a branch on the node already
      // on screen shouldn't yank the camera — restore whatever pan/zoom the
      // user had instead, so they stay in control of the view.
      const isFreshView = focusedId !== prevFocusedIdRef.current || vertical !== prevVerticalRef.current;
      if (isFreshView || !savedViewportRef.current) {
        cy.fit(cy.elements(), 40);
      } else {
        cy.pan(savedViewportRef.current.pan);
        cy.zoom(savedViewportRef.current.zoom);
      }
      prevFocusedIdRef.current = focusedId;
      prevVerticalRef.current = vertical;
    });
    layout.run();

    cyRef.current = cy;
    window.__cy = cy;
    return () => {
      savedViewportRef.current = { pan: cy.pan(), zoom: cy.zoom() };
      cy.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, vertical, kindColor]);

  if (!focusedId) {
    return (
      <div className="graph-empty">
        <p>Pick something on the left, then focus it to see what it touches.</p>
      </div>
    );
  }

  return (
    <div className="graph-view-wrap">
      <div className="graph-view" ref={containerRef} />
      <div className="history-nav">
        <button disabled={!canGoBack} onClick={onBack} title="Back">
          ←
        </button>
        <button disabled={!canGoForward} onClick={onForward} title="Forward">
          →
        </button>
      </div>
      <div className="direction-toggle">
        <button className={vertical ? "active" : ""} onClick={() => setVertical(true)}>
          Vertical
        </button>
        <button className={!vertical ? "active" : ""} onClick={() => setVertical(false)}>
          Horizontal
        </button>
      </div>
    </div>
  );
}
