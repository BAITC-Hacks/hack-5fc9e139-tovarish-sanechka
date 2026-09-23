import json
from pathlib import Path
import tomllib

import numpy as np
import pandas as pd
import pytest

from scoring import normalize, score_nodes
from starter import analyze

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def config():
    with (ROOT / 'config.toml').open('rb') as stream:
        return tomllib.load(stream)


def observed(**changes):
    row = dict(gid=1, in_deg=1, out_deg=1, in_kzt=200000., out_kzt=200000.,
               in_tx=2, out_tx=2, is_seed=False, truncated_by_depth=False,
               pass_through=1., in_concentration=1., out_concentration=1.,
               reachable_seed_count=1, neighbor_cluster_count=0, betweenness=0.,
               out_with_recent_in_share=1.)
    row.update(changes)
    return pd.DataFrame([row])


@pytest.mark.parametrize(('values', 'role'), [
    ({}, 'transit'),
    ({'is_seed': True}, 'peripheral'),
    ({'out_deg': 0, 'out_kzt': 0., 'pass_through': 0.}, 'terminal'),
    ({'out_deg': 0, 'out_kzt': 0., 'pass_through': 0., 'truncated_by_depth': True}, 'peripheral'),
    ({'in_deg': 6, 'in_concentration': .4, 'reachable_seed_count': 3, 'out_kzt': 100000., 'pass_through': .5}, 'consolidator'),
    ({'out_deg': 10, 'out_concentration': .2, 'is_seed': True}, 'distributor'),
    ({'reachable_seed_count': 10, 'neighbor_cluster_count': 4, 'betweenness': .001, 'is_seed': True}, 'coordinator'),
])
def test_role_gates(config, values, role):
    result = score_nodes(observed(**values), config).iloc[0]
    assert result.role == role
    assert 0 <= result.role_score <= 1
    assert len(result.evidence) <= 200


def test_competing_role_reduces_confidence(config):
    solo = score_nodes(observed(is_seed=True, out_deg=10, out_concentration=.2), config).iloc[0]
    competing = score_nodes(observed(is_seed=True, out_deg=10, out_concentration=.2,
                                     in_deg=3, in_concentration=.7, reachable_seed_count=3), config).iloc[0]
    assert competing.role == solo.role == 'distributor'
    assert competing.role_score < solo.role_score
    assert competing.role_scores['consolidator'] > 0


def test_next_check_matches_the_observation_gap(config):
    cases = pd.concat([
        observed(truncated_by_depth=True),
        observed(is_seed=True),
        observed(),
        observed(out_deg=0, out_kzt=0., pass_through=0.),
    ], ignore_index=True)
    result = score_nodes(cases, config)
    assert '4-го колена' in result.next_check.iloc[0]
    assert 'входящие' in result.next_check.iloc[1]
    assert 'хронологию' in result.next_check.iloc[2]
    assert 'соседние периоды' in result.next_check.iloc[3]


def test_zero_and_constant_normalization():
    assert list(normalize(pd.Series([0.,0.]))) == [0.,0.]
    assert list(normalize(pd.Series([5.,5.]))) == [1.,1.]


def test_exports_contract_and_repeatability(tmp_path):
    first = tmp_path/'first'
    second = tmp_path/'second'
    result = analyze(ROOT/'case/data', first, ROOT/'config.toml')
    analyze(ROOT/'case/data', second, ROOT/'config.toml')
    for name in ['nodes_roles.csv','clusters.csv','top_nodes.csv','analysis.json']:
        assert (first/name).read_bytes() == (second/name).read_bytes()
    nodes = pd.read_csv(first/'nodes_roles.csv')
    top = pd.read_csv(first/'top_nodes.csv')
    clusters = pd.read_csv(first/'clusters.csv')
    assert len(nodes) == len(top) == 2248
    assert len(clusters) == 88
    assert set(nodes.role) == {'peripheral','terminal','transit','distributor','consolidator','coordinator'}
    assert all(isinstance(n['gid'],str) for n in result['nodes'])
    assert {n['gid'] for n in result['nodes']} == set(pd.read_parquet(ROOT/'case/data/nodes.parquet').gid.astype(str))
    assert all(isinstance(e['src'],str) and isinstance(e['dst'],str) for e in result['edges'])
    assert all(isinstance(g,str) for c in result['clusters'] for g in c['top_gids'])
    assert nodes[['gid','role','role_score','priority_score','cluster_id','evidence']].notna().all().all()
    assert nodes.role_score.between(0,1).all() and nodes.priority_score.between(0,1).all()
    assert nodes.evidence.str.len().max() <= 200
    assert nodes.next_check.str.len().gt(0).all()
    assert all(isinstance(n['seed_path_gids'], list) for n in result['nodes'])
    assert all(n['seed_path_gids'][-1] == n['gid'] for n in result['nodes'])
    assert not nodes.loc[nodes.truncated_by_depth,'role'].eq('terminal').any()
    assert not nodes.loc[nodes.is_seed,'role'].isin(['terminal','transit']).any()
    assert sum(c['n_nodes'] for c in result['clusters']) == 2248
    assert json.loads((first/'analysis.json').read_text()) == result
    assert np.isclose(nodes.priority_score, nodes.priority_seed_reach + nodes.priority_structure + nodes.priority_volume).all()
    assert result['resilience']['baseline_largest_component'] == 1877
    assert [s['removed_count'] for s in result['resilience']['scenarios']] == [5, 10, 20]


def test_concurrent_output_is_rejected(tmp_path):
    import fcntl
    destination = tmp_path/'result'
    with (tmp_path/'.result.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(RuntimeError, match='already in use'):
            analyze(ROOT/'case/data', destination, ROOT/'config.toml')
    assert not destination.exists()


def test_invalid_input_does_not_publish_results(tmp_path):
    bad = tmp_path/'data'
    bad.mkdir()
    for name in ['nodes','edges','transactions']:
        table = pd.read_parquet(ROOT/f'case/data/{name}.parquet')
        if name == 'edges':
            table.loc[0,'n_tx'] += 1
        table.to_parquet(bad/f'{name}.parquet',index=False)
    with pytest.raises(ValueError, match='counts'):
        analyze(bad, tmp_path/'result', ROOT/'config.toml')
    assert not (tmp_path/'result').exists()


def test_output_lock_is_held_during_ready_callback(tmp_path):
    destination = tmp_path/'result'
    called = []
    def on_ready(result):
        called.append(result['meta']['n_nodes'])
        with pytest.raises(RuntimeError, match='already in use'):
            analyze(ROOT/'case/data', destination, ROOT/'config.toml')
    analyze(ROOT/'case/data', destination, ROOT/'config.toml', on_ready=on_ready)
    assert called == [2248]
