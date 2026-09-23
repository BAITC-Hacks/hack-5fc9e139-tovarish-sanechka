from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
import pytest

from starter import basic_features, build_graph, load, sanity_check


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
