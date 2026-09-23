#!/usr/bin/env python3
"""
Стартовый код кейса «Граф денег» — HackAlem AI.

Что он делает:
  1. грузит три parquet-файла и проверяет их консистентность;
  2. собирает направленный взвешенный граф;
  3. считает БАЗОВЫЕ метрики узлов (степени, обороты, PageRank);
  4. пишет три выгрузки в требуемой ТЗ схеме — с ПУСТЫМИ ролями.

Чего он НЕ делает — это ваша работа:
  * не присваивает роли,
  * не кластеризует,
  * не ранжирует узлы,
  * не рисует граф.

Запуск:
    python starter.py --data ../data --out ./out
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import networkx as nx

ROLES = ["consolidator", "transit", "distributor", "terminal", "coordinator", "peripheral"]


# ---------------------------------------------------------------- загрузка

def load(data_dir: Path):
    edges = pd.read_parquet(data_dir / "edges.parquet")
    nodes = pd.read_parquet(data_dir / "nodes.parquet")
    tx = pd.read_parquet(data_dir / "transactions.parquet")
    tx["date"] = pd.to_datetime(tx["date"])
    return edges, nodes, tx


def sanity_check(edges, nodes, tx):
    """Validate the declared dataset before computing or publishing anything."""
    schemas = {
        "nodes": (nodes, ["gid", "depth", "is_seed"]),
        "edges": (edges, ["src", "dst", "sum_kzt", "n_tx", "depth"]),
        "transactions": (tx, ["src", "dst", "date", "sum_kzt"]),
    }
    for name, (frame, columns) in schemas.items():
        if not set(columns) <= set(frame.columns):
            raise ValueError(f"{name}: missing required columns")
        if frame[columns].isna().any().any():
            raise ValueError(f"{name}: null values")
        integer_columns = [c for c in columns if c in {"gid", "src", "dst", "depth", "n_tx"}]
        for column in integer_columns:
            if not pd.api.types.is_integer_dtype(frame[column]) or pd.api.types.is_bool_dtype(frame[column]):
                raise ValueError(f"{name}.{column}: expected integer dtype")
        if "sum_kzt" in columns:
            amounts = frame.sum_kzt
            if not pd.api.types.is_numeric_dtype(amounts) or not np.isfinite(amounts).all():
                raise ValueError(f"{name}: amounts must be finite numbers")
            if (amounts < 5000).any():
                raise ValueError(f"{name}: amount below dataset threshold 5000 KZT")
    if nodes.empty or edges.empty or tx.empty:
        raise ValueError("Dataset must contain nodes, edges and transactions")
    if nodes.gid.duplicated().any():
        raise ValueError("nodes: duplicate gid")
    if edges.duplicated(["src", "dst"]).any():
        raise ValueError("edges: duplicate directed pair")
    if not pd.api.types.is_bool_dtype(nodes.is_seed):
        raise ValueError("nodes.is_seed: expected boolean dtype")
    if not nodes.depth.between(0, 4).all() or not edges.depth.between(1, 4).all():
        raise ValueError("depth outside dataset bounds")
    if not (nodes.is_seed == (nodes.depth == 0)).all():
        raise ValueError("seed must agree with depth=0")
    if (edges.n_tx <= 0).any():
        raise ValueError("edges.n_tx must be positive")
    gids = set(nodes.gid)
    for name, frame in [("edges", edges), ("transactions", tx)]:
        if not (set(frame.src) | set(frame.dst)) <= gids:
            raise ValueError(f"{name}: endpoint missing from nodes")
    if not pd.api.types.is_datetime64_any_dtype(tx.date):
        raise ValueError("transactions.date: expected parsed dates")
    if not tx.date.between(pd.Timestamp("2026-07-01"), pd.Timestamp("2026-07-31")).all():
        raise ValueError("transactions.date outside July 2026")
    if not (tx.date == tx.date.dt.normalize()).all():
        raise ValueError("transactions.date must have day precision")
    # Repeated transactions are observations, not duplicates to discard.
    agg = tx.groupby(["src", "dst"]).agg(s=("sum_kzt", "sum"), c=("sum_kzt", "size")).reset_index()
    merged = edges.merge(agg, on=["src", "dst"], how="outer", indicator=True, validate="one_to_one")
    if not (merged._merge == "both").all():
        raise ValueError("edges and transactions disagree on directed pairs")
    if not np.isclose(merged.sum_kzt, merged.s, rtol=1e-10, atol=0.01).all():
        raise ValueError("edges and transactions disagree on amounts")
    if not (merged.n_tx == merged.c).all():
        raise ValueError("edges and transactions disagree on transaction counts")
    return gids - (set(edges.src) | set(edges.dst))


# ---------------------------------------------------------------- граф

def build_graph(edges, nodes) -> nx.DiGraph:
    """Направленный граф. sum_kzt — вес ребра, n_tx — количество переводов."""
    G = nx.DiGraph()
    G.add_nodes_from(int(gid) for gid in sorted(nodes.gid))
    for r in edges.sort_values(["src", "dst"]).itertuples(index=False):
        G.add_edge(r.src, r.dst, sum_kzt=float(r.sum_kzt), n_tx=int(r.n_tx), depth=int(r.depth))
    return G


def basic_features(G: nx.DiGraph, nodes: pd.DataFrame) -> pd.DataFrame:
    """Базовые метрики. Это старт, а не финиш — добавляйте свои."""
    in_deg = {gid: sum(other != gid for other in G.predecessors(gid)) for gid in G}
    out_deg = {gid: sum(other != gid for other in G.successors(gid)) for gid in G}
    in_kzt = dict(G.in_degree(weight="sum_kzt"))
    out_kzt = dict(G.out_degree(weight="sum_kzt"))
    in_tx = dict(G.in_degree(weight="n_tx"))
    out_tx = dict(G.out_degree(weight="n_tx"))
    pr = nx.pagerank(G, weight="sum_kzt")

    df = nodes[["gid", "depth", "is_seed"]].copy()
    df["in_deg"] = df.gid.map(in_deg).fillna(0).astype(int)
    df["out_deg"] = df.gid.map(out_deg).fillna(0).astype(int)
    df["in_kzt"] = df.gid.map(in_kzt).fillna(0.0)
    df["out_kzt"] = df.gid.map(out_kzt).fillna(0.0)
    df["in_tx"] = df.gid.map(in_tx).fillna(0).astype(int)
    df["out_tx"] = df.gid.map(out_tx).fillna(0).astype(int)
    df["pagerank"] = df.gid.map(pr).fillna(0.0)

    # доля полученного, которая ушла дальше. Около 1.0 — деньги не задерживаются.
    df["pass_through"] = np.where(df.in_kzt > 0, df.out_kzt / df.in_kzt.replace(0, np.nan), np.nan)

    # ЛОВУШКА КЕЙСА: узел на 4-м колене без исходящих может быть не «стоком»,
    # а просто местом, где закончился обход. Разберитесь с этим.
    df["truncated_by_depth"] = (df.depth == 4) & (df.out_deg == 0)
    return df


# ---------------------------------------------------------------- выгрузки

def write_outputs(df: pd.DataFrame, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. nodes_roles.csv — схема из ТЗ, роли не заполнены
    roles = df[["gid"]].copy()
    roles["role"] = ""            # TODO: одна из ROLES
    roles["role_score"] = 0.0     # TODO: 0..1
    roles["cluster_id"] = -1      # TODO: номер кластера
    roles["priority_score"] = 0.0 # TODO: 0..1
    roles["evidence"] = ""        # TODO: почему — с числами, до 200 символов
    roles = roles.merge(
        df[["gid", "in_deg", "out_deg", "in_kzt", "out_kzt", "pagerank",
            "pass_through", "depth", "is_seed", "truncated_by_depth"]],
        on="gid", how="left")
    roles.to_csv(out_dir / "nodes_roles.csv", index=False)

    # 2. clusters.csv — пустой каркас
    pd.DataFrame(columns=["cluster_id", "n_nodes", "n_seed",
                          "sum_kzt_internal", "top_gids", "hypothesis"]) \
        .to_csv(out_dir / "clusters.csv", index=False)

    # 3. top_nodes.csv — пустой каркас, нужно ≥20 строк
    pd.DataFrame(columns=["rank", "gid", "role", "priority_score", "why"]) \
        .to_csv(out_dir / "top_nodes.csv", index=False)

    print(f"Выгрузки записаны в {out_dir}/  (роли пока пустые — это ваша задача)")


# ---------------------------------------------------------------- подсказки

def hints(G: nx.DiGraph, df: pd.DataFrame):
    """Куда смотреть дальше. Ответов здесь нет — только направления."""
    print("\nС ЧЕГО НАЧАТЬ")
    print("-" * 64)
    print(f"  узлов, получающих от 3+ разных плательщиков : {(df.in_deg >= 3).sum()}")
    print(f"  узлов, рассылающих на 10+ получателей       : {(df.out_deg >= 10).sum()}")
    print(f"  узлов и с входом, и с выходом               : {((df.in_deg > 0) & (df.out_deg > 0)).sum()}")
    print(f"  узлов, обрезанных 4-м коленом               : {df.truncated_by_depth.sum()}  <- разберитесь")
    print(f"  слабосвязных компонент                      : {nx.number_weakly_connected_components(G)}")
    print("""
  Вопросы, на которые стоит ответить метриками:
    * чем «деньги пришли и остались» отличается от «пришли и ушли дальше»?
    * что важнее для роли — количество плательщиков или сумма?
    * узел собирает средства от нескольких SEED — это случайность или структура?
    * если убрать узел, сеть распадётся или переживёт?

  Полезное в networkx: pagerank, hits, betweenness_centrality,
  community.louvain_communities, simple_cycles, all_simple_paths.
  Не забудьте: граф НАПРАВЛЕННЫЙ и ВЗВЕШЕННЫЙ.
""")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../data", help="папка с parquet-файлами")
    ap.add_argument("--out", default="./out", help="куда писать выгрузки")
    a = ap.parse_args()

    edges, nodes, tx = load(Path(a.data))
    sanity_check(edges, nodes, tx)
    G = build_graph(edges, nodes)
    df = basic_features(G, nodes)
    write_outputs(df, Path(a.out))
    hints(G, df)


if __name__ == "__main__":
    main()
