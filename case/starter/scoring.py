"""Explainable hypotheses and priority, consuming the starter's feature table."""
import numpy as np


def normalize(values):
    """Log scaling to the observed maximum; zero stays zero, including constants."""
    logged = np.log1p(values)
    maximum = logged.max()
    return logged / maximum if maximum > 0 else logged * 0


def score_nodes(df, config):
    df = df.copy()
    t = config['thresholds']
    explanations = []
    roles = []
    confidence = []
    alternatives = []
    for r in df.itertuples():
        scores = {role: 0.0 for role in config['role_order']}
        reasons = {}
        if r.in_deg >= t['min_payers'] and r.reachable_seed_count >= t['min_seed_reach'] and r.in_concentration <= t['max_concentration']:
            scores['consolidator'] = 0.6 + 0.2 * min(r.in_deg / (2*t['min_payers']), 1) + 0.2*(1-r.in_concentration)
            reasons['consolidator'] = f'сбор: {r.in_deg} плательщиков, seed={r.reachable_seed_count}, макс. доля={r.in_concentration:.0%}'
        if r.out_deg >= t['min_recipients'] and r.out_concentration <= t['max_concentration']:
            scores['distributor'] = 0.6 + 0.2 * min(r.out_deg / (2*t['min_recipients']), 1) + 0.2*(1-r.out_concentration)
            reasons['distributor'] = f'распределение: {r.out_deg} получателей, макс. доля={r.out_concentration:.0%}'
        if not r.is_seed and r.in_deg > 0 and r.out_deg > 0 and min(r.in_kzt,r.out_kzt) >= t['min_volume'] and t['transit_ratio_min'] <= r.pass_through <= t['transit_ratio_max'] and r.out_with_recent_in_share >= t['min_recent_in_share']:
            scores['transit'] = 0.6 + 0.2 * min(r.pass_through,1/r.pass_through) + 0.2*r.out_with_recent_in_share
            reasons['transit'] = f'транзит: выход/вход={r.pass_through:.2f}, близость ≤2д={r.out_with_recent_in_share:.0%}; не трассировка'
        if not r.is_seed and not r.truncated_by_depth and r.in_deg > 0 and r.in_kzt >= t['min_volume'] and r.pass_through <= t['terminal_ratio_max']:
            scores['terminal'] = 0.6 + 0.2*(1-r.pass_through) + 0.2*min(r.in_kzt/(2*t['min_volume']),1)
            reasons['terminal'] = f'удержание в выборке: вход={r.in_kzt:.0f} ₸, выход/вход={r.pass_through:.2f}'
        if r.reachable_seed_count >= t['coordinator_seed_reach'] and r.neighbor_cluster_count >= t['min_neighbor_clusters'] and r.betweenness >= t['min_betweenness']:
            scores['coordinator'] = 0.6 + 0.2*min(r.betweenness/(2*t['min_betweenness']),1) + 0.2*min(r.neighbor_cluster_count/(2*t['min_neighbor_clusters']),1)
            reasons['coordinator'] = f'связующий: seed={r.reachable_seed_count}, внеш. кластеров={r.neighbor_cluster_count}, посредничество={r.betweenness:.4f}'
        eligible = [role for role in config['role_order'] if scores[role] > 0]
        if eligible:
            role = max(eligible, key=lambda name: scores[name])
            other = max((scores[name] for name in eligible if name != role), default=0)
            score = scores[role] * (1 - 0.2 * other)
            reason = reasons[role]
        else:
            role, score = 'peripheral', 0.25
            scores[role] = score
            reason = f'оснований мало: входящих={r.in_deg}, исходящих={r.out_deg}, операций={r.in_tx+r.out_tx}'
        caveat = '; граница depth=4' if r.truncated_by_depth else ('; вход seed неполон' if r.is_seed else '; выборка неполна')
        explanations.append('Гипотеза: ' + reason + caveat)
        roles.append(role)
        confidence.append(score)
        alternatives.append(scores)
    df['role'] = roles
    df['role_score'] = confidence
    df['role_scores'] = alternatives
    df['evidence'] = explanations
    df['next_check'] = [
        'Запросить исходящие переводы за пределами 4-го колена и соседние периоды.'
        if row.truncated_by_depth else
        'Запросить полные входящие переводы исходного клиента за июль 2026.'
        if row.is_seed else
        'Запросить хронологию операций и остатки счёта вокруг дней входа и выхода.'
        if role == 'transit' else
        'Запросить полные входящие и исходящие переводы за соседние периоды.'
        for row, role in zip(df.itertuples(), roles)
    ]
    weights = config['priority_weights']
    df['priority_seed_reach'] = normalize(df.reachable_seed_count) * weights['seed_reach']
    df['priority_structure'] = (normalize(df.betweenness) + normalize(df.in_deg+df.out_deg))/2 * weights['structure']
    df['priority_volume'] = normalize(df.in_kzt+df.out_kzt) * weights['volume']
    df['priority_score'] = df.priority_seed_reach + df.priority_structure + df.priority_volume
    return df
