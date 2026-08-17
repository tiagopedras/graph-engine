# graph-engine

A focused-node dependency diagram, as a React component. Give it a plain graph —

```js
{ nodes: [{ id, kind, name, ... }], edges: [{ from, to, type, ... }] }
```

— and a node id to focus, and it draws that node with what it depends on above
and what depends on it below, laid out by [ELK](https://www.eclipse.org/elk/)
and rendered with [Cytoscape](https://js.cytoscape.org/). Click a node to
preview it; a "+" badge appears on any node whose own connections haven't been
expanded yet, so the tree grows one branch at a time instead of dumping the
whole graph on screen.

This package doesn't know what a "component" or a "token" is, or what an edge
`type` like `BINDS` or `NESTS` means. A node's `kind` is just a string it uses
to look up a colour in the `kindColor` prop; an edge's `type` rides along on
each edge but the engine never branches on it. All of that meaning belongs to
whoever is calling in.

## Why this exists

It was pulled out of [ds-graph](https://github.com/tiagopedras-twinkl/ds-graph),
a tool that maps dependencies in a Figma design system, once the diagram itself
turned out to have nothing Figma-specific left in it. ds-graph is still the
fullest example of using it — its `viewer/src/lib/graph.js` is the adapter
that supplies the design-system vocabulary this package doesn't have.

## Installing

This isn't published to npm. Point at the repo directly:

```json
{
  "dependencies": {
    "graph-engine": "github:tiagopedras/graph-engine"
  }
}
```

`npm install` clones it straight from GitHub. Because the repo is private,
whichever machine or CI runs that install needs read access to it — a GitHub
account with access, or a deploy key/token with `repo` scope.

React, Cytoscape and its ELK layout plugin are peer dependencies — install
them alongside in the consuming project (see this repo's `package.json` for
the versions this was built against):

```bash
npm install cytoscape cytoscape-elk elkjs
```

## Using it

```jsx
import { loadGraph, GraphView } from "graph-engine";

const graph = loadGraph({ nodes, edges }); // indexes nodes/edges once
const kindColor = { thing: "#2563eb", otherThing: "#059669" };

<GraphView graph={graph} focusedId={someNodeId} kindColor={kindColor} onPreview={setPreviewId} />
```

`loadGraph`, `dependents` and `dependencies` (in `graph.js`) are the traversal
half — plain BFS in either direction, with no rendering involved — useful for
building your own impact summary or search the way ds-graph's `lib/graph.js`
does.

## What's not here on purpose

Loading data, search, a sidebar, a "what does this affect" write-up in prose —
none of that belongs in an engine meant to be reused with different data each
time. That's the layer every consumer builds for its own vocabulary.
