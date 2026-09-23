import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import { colors, type Node, type Edge } from "./types";

export function GraphView({
  nodes,
  edges,
  selected,
  pathMode,
  onSelect,
}: {
  nodes: Node[];
  edges: Edge[];
  selected: string;
  pathMode: boolean;
  onSelect: (gid: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const select = useRef(onSelect);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const previousPathMode = useRef(false);
  select.current = onSelect;
  useEffect(() => {
    const cy = cytoscape({
      container: container.current!,
      elements: [],
      layout: { name: "preset" },
      minZoom: 0.08,
      maxZoom: 4,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "data(label)",
            "font-size": 11,
            "text-valign": "bottom",
            "text-margin-y": 6,
            width: 24,
            height: 24,
            color: "#23394b",
          },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "#8192a2",
            "line-color": "#b4c2ce",
            width: 1.5,
            "arrow-scale": 1.2,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 4,
            "border-color": "#152e42",
            width: 34,
            height: 34,
            "font-weight": "bold",
          },
        },
      ],
    });
    graph.current = cy;
    cy.on("tap", "node", (event) => select.current(event.target.id()));
    const observer = new ResizeObserver(() => {
      cy.resize();
      cy.fit(undefined, 45);
    });
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      cy.removeAllListeners();
      cy.destroy();
      graph.current = null;
    };
  }, []);
  useEffect(() => {
    const cy = graph.current;
    if (!cy) return;
    if (!previousPathMode.current)
      cy.nodes().forEach((n) => {
        positions.current.set(n.id(), { ...n.position() });
      });
    const center = positions.current.get(selected) ?? { x: 0, y: 0 };
    const fresh = nodes.filter((n) => !positions.current.has(n.gid));
    if (!pathMode) fresh.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(fresh.length, 1);
      const radius = 100 + 25 * Math.sqrt(fresh.length);
      positions.current.set(
        node.gid,
        node.gid === selected
          ? center
          : {
              x: center.x + radius * Math.cos(angle),
              y: center.y + radius * Math.sin(angle),
            },
      );
    });
    cy.batch(() => {
      cy.elements().remove();
      cy.add(
        nodes.map((n, index) => ({
          data: { id: n.gid, label: n.gid.slice(-8), color: colors[n.role] },
          position: pathMode
            ? { x: index * 150, y: 0 }
            : positions.current.get(n.gid),
        })),
      );
      cy.add(
        edges.map((e) => ({
          data: { id: e.id, source: e.src, target: e.dst },
        })),
      );
      cy.getElementById(selected).select();
    });
    previousPathMode.current = pathMode;
    cy.fit(undefined, 45);
  }, [nodes, edges, pathMode]);
  useEffect(() => {
    const cy = graph.current;
    if (cy) {
      cy.nodes().unselect();
      cy.getElementById(selected).select();
    }
  }, [selected]);
  return (
    <>
      <div
        className={pathMode ? "graph graph-path" : "graph"}
        ref={container}
        role="img"
        aria-label={`Направленный граф: ${nodes.length} узлов, ${edges.length} связей. Полные идентификаторы и связи доступны ниже.`}
      />
      <button
        className="graph-fit"
        onClick={() => graph.current?.fit(undefined, 45)}
      >
        Вписать граф
      </button>
    </>
  );
}
