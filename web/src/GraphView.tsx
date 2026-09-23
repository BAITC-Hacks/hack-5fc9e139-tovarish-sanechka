import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import { checkPathChronology } from "./PathChronology";
import { colors, labels, number, type Node, type Edge } from "./types";

export function GraphView({
  nodes,
  edges,
  selected,
  pathMode,
  onSelect,
  ranks,
}: {
  nodes: Node[];
  edges: Edge[];
  selected: string;
  pathMode: boolean;
  onSelect: (gid: string) => void;
  ranks: Map<string, number>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const select = useRef(onSelect);
  const [inspected, setInspected] = useState("");
  const [zoom, setZoom] = useState(100);
  select.current = onSelect;
  const chronology = pathMode ? checkPathChronology(edges) : null;
  const failedId =
    chronology?.failedStep === null || !chronology
      ? ""
      : edges[chronology.failedStep]?.id;
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
            "font-size": 14,
            "text-valign": "bottom",
            "text-margin-y": 6,
            width: 28,
            height: 28,
            color: "#20394c",
            "text-background-color": "#f6f9fc",
            "text-background-opacity": 0.9,
            "text-background-padding": "3px",
          },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "#8192a2",
            "line-color": "#b4c2ce",
            width: "data(weight)",
            "arrow-scale": 1.2,
          },
        },
        {
          selector: "edge.conflict",
          style: {
            "line-color": "#b3352c",
            "target-arrow-color": "#b3352c",
            "line-style": "dashed",
            label: "Конфликт дат",
            "font-size": 14,
            color: "#9a332b",
            "text-background-color": "#fff",
            "text-background-opacity": 1,
            "text-background-padding": "3px",
            "text-rotation": "autorotate",
          },
        },
        {
          selector: "edge:selected",
          style: { "line-color": "#2165ac", "target-arrow-color": "#2165ac" },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 4,
            "border-color": "#152e42",
            width: 36,
            height: 36,
            "font-weight": "bold",
          },
        },
      ],
    });
    graph.current = cy;
    cy.on("tap", "node", (event) => select.current(event.target.id()));
    cy.on("tap mouseover", "edge, node", (event) =>
      setInspected(event.target.data("description")),
    );
    cy.on("zoom", () => {
      setZoom(Math.round(cy.zoom() * 100));
      // Keep rank labels readable when fitting a small neighborhood to the panel.
      cy.nodes().style("font-size", `${Math.min(80, 13 / cy.zoom())}px`);
      cy.edges(".conflict").style(
        "font-size",
        `${Math.min(80, 13 / cy.zoom())}px`,
      );
      cy.edges(".conflict").style("text-margin-y", `${-18 / cy.zoom()}px`);
      cy.nodes().style(
        "text-opacity",
        cy.nodes().length > 30 && cy.zoom() < 0.6 ? 0 : 1,
      );
      cy.nodes(":selected").style("text-opacity", 1);
    });
    const observer = new ResizeObserver(() => {
      if (!container.current?.clientWidth) return;
      cy.resize();
      cy.fit(undefined, 40);
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
    setInspected("");
    const incoming = nodes.filter(
      (n) =>
        n.gid !== selected &&
        edges.some((e) => e.src === n.gid && e.dst === selected),
    );
    const outgoing = nodes.filter(
      (n) => n.gid !== selected && !incoming.includes(n),
    );
    const maximum = Math.max(1, ...edges.map((e) => e.sum_kzt));
    cy.batch(() => {
      cy.elements().remove();
      cy.add(
        nodes.map((node, index) => {
          const column = incoming.includes(node) ? incoming : outgoing;
          const row = column.indexOf(node);
          return {
            data: {
              id: node.gid,
              label: `№ ${ranks.get(node.gid)}`,
              color: colors[node.role],
              description: `№ ${ranks.get(node.gid)} · ${node.gid} · ${labels[node.role]}`,
            },
            position: pathMode
              ? { x: index * 150, y: 0 }
              : node.gid === selected
                ? { x: 0, y: 0 }
                : {
                    x: incoming.includes(node) ? -180 : 180,
                    y: (row - (column.length - 1) / 2) * 75,
                  },
          };
        }),
      );
      cy.add(
        edges.map((edge) => ({
          data: {
            id: edge.id,
            source: edge.src,
            target: edge.dst,
            weight: 1.5 + 6 * Math.sqrt(edge.sum_kzt / maximum),
            description: `${edge.src} → ${edge.dst} · ${number(edge.sum_kzt)} ₸ · ${edge.n_tx} операций за месяц${edge.id === failedId ? " · Конфликт дат" : ""}`,
          },
          classes: edge.id === failedId ? "conflict" : "",
        })),
      );
      cy.getElementById(selected).select();
    });
    cy.fit(undefined, 40);
  }, [nodes, edges, selected, pathMode, ranks, failedId]);
  function changeZoom(factor: number) {
    const cy = graph.current;
    if (cy)
      cy.zoom({
        level: cy.zoom() * factor,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      });
  }
  return (
    <>
      <div
        className={pathMode ? "graph graph-path" : "graph"}
        ref={container}
        role="img"
        aria-label={`Направленный граф: ${nodes.length} узлов, ${edges.length} связей.${failedId ? " Конфликт дат выделен красным пунктиром." : ""} Полные идентификаторы и связи доступны ниже.`}
      />
      <div className="graph-controls">
        <button aria-label="Уменьшить граф" onClick={() => changeZoom(1 / 1.3)}>
          −
        </button>
        <span aria-label="Масштаб графа">{zoom}%</span>
        <button aria-label="Увеличить граф" onClick={() => changeZoom(1.3)}>
          +
        </button>
        <button onClick={() => graph.current?.fit(undefined, 40)}>
          Вписать граф
        </button>
      </div>
      <p className="muted">
        Перетащите фон для перемещения, узел — для изменения положения. Масштаб:
        + / − или жест двумя пальцами. Нажмите на связь, чтобы увидеть сумму.
      </p>
      {inspected && (
        <p className="graph-inspection" role="status">
          {inspected}
        </p>
      )}
      {failedId && (
        <p className="conflict-key">
          Красный пунктир: конфликт дат на шаге {chronology!.failedStep! + 1}.
        </p>
      )}
      <details className="graph-identifiers">
        <summary>Номера и полные gid на графе</summary>
        {nodes.map((node) => (
          <button
            className="link-button"
            key={node.gid}
            onClick={() => onSelect(node.gid)}
          >
            № {ranks.get(node.gid)} · {node.gid}
          </button>
        ))}
      </details>
    </>
  );
}
