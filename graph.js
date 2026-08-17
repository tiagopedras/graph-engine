// Generic graph indexing and traversal. This file knows nothing about what a
// node's `kind` or an edge's `type` mean — it works on any data shaped like
// { nodes: [{ id, ... }], edges: [{ from, to, ... }] }. Anything that reads
// `kind`/`type` values belongs to whichever project is consuming this, not
// here.
//
// Edge direction convention: `from` depends on / uses `to`. So walking
// outgoing edges from a node gives its dependencies (what it relies on);
// walking incoming edges gives its dependents (what relies on it).

export function loadGraph(graphData) {
  const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]));
  const outgoing = new Map(); // from -> edges
  const incoming = new Map(); // to -> edges
  for (const e of graphData.edges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from).push(e);
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e);
  }
  return { nodes: graphData.nodes, edges: graphData.edges, nodeById, outgoing, incoming };
}

// BFS in one direction, depth-limited. `edgeMap` is either `incoming`
// (walk = dependents) or `outgoing` (walk = dependencies). `neighborId(e)`
// picks the node id on the far side of the edge for that direction.
function walk(startId, edgeMap, neighborId, maxDepth) {
  const depthOf = new Map([[startId, 0]]);
  const viaEdge = new Map();
  const queue = [[startId, 0]];
  while (queue.length) {
    const [id, depth] = queue.shift();
    if (depth >= maxDepth) continue;
    for (const e of edgeMap.get(id) || []) {
      const nid = neighborId(e);
      if (depthOf.has(nid)) continue;
      depthOf.set(nid, depth + 1);
      viaEdge.set(nid, e);
      queue.push([nid, depth + 1]);
    }
  }
  depthOf.delete(startId);
  return { depthOf, viaEdge };
}

// What depends on this node — reverse walk through incoming edges.
export function dependents(graph, startId, maxDepth = Infinity) {
  return walk(startId, graph.incoming, (e) => e.from, maxDepth);
}

// What this node depends on — forward walk through outgoing edges.
export function dependencies(graph, startId, maxDepth = Infinity) {
  return walk(startId, graph.outgoing, (e) => e.to, maxDepth);
}
