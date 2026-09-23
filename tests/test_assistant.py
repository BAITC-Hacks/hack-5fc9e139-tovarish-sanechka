import json
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest

import assistant
from assistant import AlemSettings, AssistantError, interpret, load_settings


NODES = {'100000000000000001': {'is_seed': True}, '100000000000000002': {'is_seed': True},
         '100000000000000003': {'is_seed': False}, '100000000000000004': {'is_seed': False}}
A, B, C, D = NODES
SETTINGS = AlemSettings('test-key', 'https://llm.example.test/v1/chat/completions', 'test-model')


def question():
    return {'question': f'Путь от {A} к {C}', 'context': {'selected': C, 'seeds': [A, B]}, 'history': []}


def response(value):
    return {'choices': [{'message': {'content': json.dumps(value)}}]}


@pytest.mark.parametrize('operation', [
    {'type': 'node', 'gid': C}, {'type': 'sensitivity', 'gid': C},
    {'type': 'common', 'seeds': [A, B]}, {'type': 'route', 'source': A, 'target': C},
])
def test_interpret_valid_operations_only_sends_minimal_context(monkeypatch, operation):
    def provider(settings, payload):
        assert settings == SETTINGS
        assert payload['model'] == 'test-model'
        assert len(payload['messages']) == 2
        sent = json.loads(payload['messages'][1]['content'])
        assert sent == question()
        assert 'nodes' not in sent and 'note' not in sent
        return response({'operations': [operation]})
    monkeypatch.setattr(assistant, 'call_alem', provider)
    assert interpret(SETTINGS, question(), NODES) == {'operations': [operation]}


@pytest.mark.parametrize('value', [
    {}, {'operations': []}, {'operations': [{'type': 'delete', 'gid': C}]},
    {'operations': [{'type': 'node', 'gid': '999'}]},
    {'operations': [{'type': 'node', 'gid': D}]},
    {'operations': [{'type': 'node', 'gid': int(C)}]},
    {'operations': [{'type': 'node', 'gid': C, 'url': 'https://example.test'}]},
    {'operations': [{'type': 'common', 'seeds': [A, C]}]},
    {'operations': [{'type': 'common', 'seeds': [A, A]}]},
    {'operations': [{'type': 'node', 'gid': C}] * 4},
    {'clarification': '<script>alert(1)</script>'},
])
def test_reject_invalid_or_invented_commands(monkeypatch, value):
    monkeypatch.setattr(assistant, 'call_alem', lambda *args: response(value))
    with pytest.raises(AssistantError):
        interpret(SETTINGS, question(), NODES)


@pytest.mark.parametrize('content', ['```json\n{}\n```', '{', '', None])
def test_invalid_model_json_is_not_a_result(monkeypatch, content):
    monkeypatch.setattr(assistant, 'call_alem', lambda *args: {'choices': [{'message': {'content': content}}]})
    with pytest.raises(AssistantError, match='JSON'):
        interpret(SETTINGS, question(), NODES)


def test_clarification_limits_and_missing_settings(monkeypatch):
    monkeypatch.setattr(assistant, 'call_alem', lambda *args: response({'clarification': 'missing_context'}))
    assert interpret(SETTINGS, question(), NODES) == {'clarification': 'missing_context'}
    for body in [{**question(), 'question': 'x' * 2001}, {**question(), 'history': ['x'] * 7},
                 {**question(), 'context': {'selected': '999', 'seeds': []}}, {**question(), 'note': 'private'}]:
        with pytest.raises(AssistantError): interpret(SETTINGS, body, NODES)
    with pytest.raises(AssistantError, match='не настроен'):
        interpret(AlemSettings(), question(), NODES)


def test_env_is_data_and_process_environment_has_precedence(tmp_path):
    (tmp_path/'.env').write_text('ALEM_API_KEY="$(touch /tmp/never-run)"\nALEM_CHAT_URL=https://example.test/chat/completions\nALEM_MODEL=local\n')
    settings = load_settings(tmp_path, {'ALEM_MODEL': 'override'})
    assert settings.key == '$(touch /tmp/never-run)'
    assert settings.model == 'override'
    assert load_settings(tmp_path, {'ALEM_API_KEY': ''}).enabled is False
    (tmp_path/'.env').write_text('ALEM_CHAT_URL=http://example.test\n')
    with pytest.raises(AssistantError, match='HTTPS'): load_settings(tmp_path, {})


@pytest.mark.parametrize(('error', 'message'), [
    (HTTPError('https://example.test', 401, 'secret-provider-body', {}, None), 'API-ключ'),
    (HTTPError('https://example.test', 429, 'secret-provider-body', {}, None), 'лимит'),
    (HTTPError('https://example.test', 500, 'secret-provider-body', {}, None), 'недоступен'),
    (TimeoutError('secret'), '60 секунд'), (URLError('secret'), 'соединиться'),
])
def test_provider_failures_are_safe(monkeypatch, error, message):
    class Opener:
        def open(self, request, timeout):
            assert timeout == 60
            raise error
    monkeypatch.setattr(assistant, 'build_opener', lambda *args: Opener())
    with pytest.raises(AssistantError, match=message) as caught:
        assistant.call_alem(SETTINGS, {})
    assert 'secret' not in str(caught.value)


def test_redirects_never_forward_credentials():
    assert assistant.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.test') is None


@pytest.mark.parametrize(('overrides', 'expected'), [
    ({}, 200), ({'Origin': 'https://foreign.test'}, 403),
    ({'Host': 'foreign.test:8081'}, 403), ({'Sec-Fetch-Site': 'cross-site'}, 403),
    ({'Content-Type': 'text/plain'}, 415), ({'Content-Length': '999999'}, 413),
    ({'Transfer-Encoding': 'chunked'}, 415),
])
def test_http_boundary(monkeypatch, overrides, expected):
    from email.message import Message
    from io import BytesIO
    from types import SimpleNamespace
    import run
    body = json.dumps(question()).encode()
    handler = object.__new__(run.ResultHandler)
    handler.path = '/api/assistant/interpret'
    handler.headers = Message()
    for key, value in {'Host': '127.0.0.1:8081', 'Origin': 'http://127.0.0.1:8081',
                       'Content-Type': 'application/json', 'Content-Length': str(len(body)), **overrides}.items():
        handler.headers[key] = value
    handler.rfile = BytesIO(body)
    handler.connection = SimpleNamespace(settimeout=lambda seconds: None)
    handler.assistant_settings = SETTINGS
    handler.assistant_nodes = NODES
    handler.assistant_error = ''
    replies = []
    handler.json_response = lambda status, value: replies.append((status, value))
    monkeypatch.setattr(run, 'interpret', lambda *args: {'operations': [{'type': 'node', 'gid': C}]})
    handler.do_POST()
    assert replies[0][0] == expected
