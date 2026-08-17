// Public surface of the graph engine. Everything here takes and returns
// plain { nodes, edges } data. It never reads a node's `kind` or an edge's
// `type` as anything more than a string to key colours or styling off —
// what those strings mean is entirely up to whoever calls in. A consumer
// (e.g. ds-graph's viewer/src/lib/graph.js) supplies that vocabulary on top.
export { loadGraph, dependents, dependencies } from "./graph";
export { default as GraphView } from "./GraphView";
