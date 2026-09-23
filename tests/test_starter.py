from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
import pytest

from starter import basic_features, build_graph, load, representative_seed_paths, sanity_check


@pytest.fixture
def sample():
    nodes = pd.DataFrame({'gid': [1, 2, 3], 'depth': [0, 1, 0], 'is_seed': [True, False, True]})
    tx = pd.DataFrame({'src': [1, 1, 2], 'dst': [2, 2, 2],
                       'date': pd.to_datetime(['2026-07-01'] * 3),
                       'sum_kzt': [5000., 5000., 7000.]})
    edges = pd.DataFrame({'src': [1, 2], 'dst': [2, 2], 'sum_kzt': [10000., 7000.],
                          'n_tx': [2, 1], 'depth': [1, 2]})
    return edges, nodes, tx


def test_isolate_repeated_transactions_and_self_transfer(sample):
    edges, nodes, tx = sample
    assert sanity_check(*sample) == {3}
    graph = build_graph(edges, nodes)
    features = basic_features(graph, nodes).set_index('gid')
    assert set(graph) == {1, 2, 3}
    assert features.loc[2, 'in_deg'] == 1
    assert features.loc[2, 'out_deg'] == 0
    assert features.loc[2, 'in_kzt'] == 17000
    assert features.loc[2, 'out_kzt'] == 7000
    assert features.loc[2, 'in_tx'] == 3
    assert np.isnan(features.loc[3, 'pass_through'])
    assert features.pagerank.sum() == pytest.approx(1)
    assert features.loc[3, 'pagerank'] > 0


@pytest.mark.parametrize(('table', 'column', 'value', 'message'), [
    (0, 'sum_kzt', 10001., 'amounts'),
    (0, 'n_tx', 3, 'counts'),
    (0, 'src', 999, 'endpoint'),
    (2, 'src', 999, 'endpoint'),
    (0, 'sum_kzt', float('inf'), 'finite'),
    (2, 'sum_kzt', -5000., 'threshold'),
    (1, 'depth', 5, 'depth'),
    (1, 'is_seed', False, 'seed'),
    (2, 'date', pd.Timestamp('2026-08-01'), 'July'),
])
def test_rejects_invalid_input(sample, table, column, value, message):
    sample[table].loc[0, column] = value
    with pytest.raises(ValueError, match=message):
        sanity_check(*sample)


def test_rejects_duplicate_ids(sample):
    sample[1].loc[1, 'gid'] = 1
    with pytest.raises(ValueError, match='duplicate gid'):
        sanity_check(*sample)


def test_rejects_missing_columns(sample):
    with pytest.raises(ValueError, match='missing required'):
        sanity_check(sample[0].drop(columns='n_tx'), sample[1], sample[2])


def test_real_data_full_graph():
    edges, nodes, tx = load(Path(__file__).resolve().parents[1] / 'case/data')
    assert len(sanity_check(edges, nodes, tx)) == 19
    graph = build_graph(edges, nodes)
    assert (len(graph), graph.number_of_edges(), len(tx)) == (2248, 3119, 4840)
    assert nx.number_weakly_connected_components(graph) == 35
    features = basic_features(graph, nodes)
    assert features.truncated_by_depth.sum() == 444
    assert features.pagerank.sum() == pytest.approx(1)


def test_reachability_counts_distinct_seeds_and_excludes_self():
    from starter import extended_features
    graph = nx.DiGraph()
    graph.add_edges_from([(1, 2), (2, 1), (2, 4), (3, 4)])
    nodes = pd.DataFrame({'gid': [1, 2, 3, 4], 'is_seed': [True, False, True, False],
                          'depth': [0, 1, 0, 2]})
    edges = pd.DataFrame([{'src': a, 'dst': b, 'sum_kzt': 5000., 'n_tx': 1, 'depth': 1}
                          for a, b in graph.edges])
    tx = edges[['src', 'dst', 'sum_kzt']].assign(date=pd.Timestamp('2026-07-01'))
    graph = build_graph(edges, nodes)
    features = extended_features(graph, basic_features(graph, nodes), tx).set_index('gid')
    assert features.reachable_seed_count.to_dict() == {1: 0, 2: 1, 3: 0, 4: 2}


def test_representative_paths_are_directed_shortest_and_stable():
    nodes = pd.DataFrame({'gid': [1, 2, 3, 4, 5, 6, 7],
                          'is_seed': [True, True, True, False, False, False, False]})
    graph = nx.DiGraph()
    graph.add_nodes_from(nodes.gid)
    graph.add_edges_from([(1, 5), (1, 4), (2, 4), (5, 7), (4, 7), (1, 2),
                          (4, 1), (7, 4)])
    paths = representative_seed_paths(graph, nodes)
    assert paths == {1: [2, 4, 1], 2: [1, 2], 3: [3], 4: [1, 4],
                     5: [1, 5], 6: [], 7: [1, 4, 7]}
    reversed_edges = nx.DiGraph()
    reversed_edges.add_nodes_from(nodes.gid)
    reversed_edges.add_edges_from(reversed(list(graph.edges)))
    assert representative_seed_paths(reversed_edges, nodes) == paths


def test_daily_proximity_does_not_count_outgoing_volume_twice():
    from starter import extended_features
    nodes = pd.DataFrame({'gid': [1, 2, 3], 'depth': [0, 1, 2], 'is_seed': [True, False, False]})
    tx = pd.DataFrame({'src': [1, 1, 2, 2], 'dst': [2, 2, 3, 3],
                       'date': pd.to_datetime(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-05']),
                       'sum_kzt': [5000., 5000., 10000., 10000.]})
    edges = tx.groupby(['src', 'dst']).agg(sum_kzt=('sum_kzt', 'sum'), n_tx=('sum_kzt', 'size')).reset_index().assign(depth=1)
    graph = build_graph(edges, nodes)
    features = extended_features(graph, basic_features(graph, nodes), tx).set_index('gid')
    assert features.loc[2, 'out_with_recent_in_share'] == 0.5
    assert features.loc[2, 'active_days'] == 4
    assert features.loc[2, 'max_daily_payers'] == 1


def test_cluster_projection_sums_reciprocals_ignores_loops(monkeypatch, sample):
    from starter import assign_clusters
    edges, nodes, _ = sample
    graph = build_graph(edges, nodes)
    graph.add_edge(2, 1, sum_kzt=5000., n_tx=1, depth=2)
    seen = {}

    def louvain(projection, **kwargs):
        seen['graph'] = projection
        return [{1, 2}]

    monkeypatch.setattr(nx.community, 'louvain_communities', louvain)
    features = assign_clusters(graph, basic_features(graph, nodes)).set_index('gid')
    assert seen['graph'][1][2]['weight'] == 15000
    assert not list(nx.selfloop_edges(seen['graph']))
    assert features.cluster_id.to_dict() == {1: 0, 2: 0, 3: 1}


def test_real_features_and_clusters_repeat():
    from starter import assign_clusters, extended_features
    edges, nodes, tx = load(Path(__file__).resolve().parents[1] / 'case/data')
    graph = build_graph(edges, nodes)
    features = extended_features(graph, basic_features(graph, nodes), tx)
    first = assign_clusters(graph, features)
    shuffled_graph = build_graph(edges.sample(frac=1, random_state=9), nodes.sample(frac=1, random_state=9))
    second = assign_clusters(shuffled_graph, features)
    pd.testing.assert_frame_equal(first, second)
    assert first.cluster_id.nunique() == 88
    assert first.out_with_recent_in_share.between(0, 1).all()
    assert first.reachable_seed_count.between(0, nodes.is_seed.sum()).all()
