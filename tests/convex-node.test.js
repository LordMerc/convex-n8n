const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const nodePath = '../dist/nodes/Convex/Convex.node.js';
const transportPath = '../dist/nodes/Convex/transport.js';

// Leak checks have to read the compiled JavaScript, not JSON.stringify() of the
// loaded module: a functions-only module serializes to '{}' and a node
// description silently drops its function-valued routing and hooks, so a
// stringify-based assertion can never fail.
function readCompiled(entry) {
	return fs.readFileSync(require.resolve(entry), 'utf8');
}

function readCompiledTree(entry) {
	const dir = path.dirname(require.resolve(entry));
	return fs
		.readdirSync(dir, { recursive: true })
		.map((file) => String(file))
		.filter((file) => file.endsWith('.js'))
		.map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
		.join('\n');
}

function parameterContext(parameters, credentials = {}) {
	return {
		getNode: () => ({ name: 'Convex' }),
		getNodeParameter: (name) => parameters[name],
		getCredentials: async () => credentials,
	};
}

test('Convex exposes only approved resources, operations, and application credentials', () => {
	const { Convex } = require(nodePath);
	const description = new Convex().description;
	const resource = description.properties.find((field) => field.name === 'resource');
	assert.deepEqual(resource.options.map((option) => option.value), ['function', 'httpAction']);
	const operations = description.properties
		.filter((field) => field.name === 'operation')
		.flatMap((field) => field.options.map((option) => option.value));
	assert.deepEqual(operations.sort(), ['request', 'runAction', 'runMutation', 'runQuery']);
	assert.equal(description.credentials[0].name, 'convexApi');
	assert.equal(description.usableAsTool, true);
	assert.equal(description.requestDefaults.baseURL, '={{$credentials.deploymentUrl}}');
	assert.equal(description.subtitle, '={{$parameter["resource"] + ": " + $parameter["operation"]}}');
	assert.doesNotMatch(readCompiledTree(nodePath), /convexTeamApi|teamAccessToken/);
});

test('function hooks validate deployment URLs, select Convex endpoints, send exact JSON envelopes, and disable redirects', async () => {
	const { Convex } = require(nodePath);
	const { prepareFunctionRequest } = require(transportPath);
	const description = new Convex().description;
	const operations = description.properties.find(
		(field) => field.name === 'operation' && field.displayOptions.show.resource[0] === 'function',
	).options;
	assert.deepEqual(
		operations.map((operation) => [operation.value, operation.routing.request.method, operation.routing.request.url]),
		[
			['runQuery', 'POST', '/api/query'],
			['runMutation', 'POST', '/api/mutation'],
			['runAction', 'POST', '/api/action'],
		],
	);
	for (const args of ['{"name":"Ada"}', { name: 'Ada' }]) {
		const request = await prepareFunctionRequest.call(
			parameterContext({ functionPath: 'users:get', arguments: args }, { deploymentUrl: 'https://demo.convex.cloud///' }),
			{ url: '/api/query' },
		);
		assert.deepEqual(request.body, { path: 'users:get', args: { name: 'Ada' }, format: 'json' });
		assert.equal(request.baseURL, 'https://demo.convex.cloud');
		assert.equal(request.disableFollowRedirect, true);
		assert.equal(request.ignoreHttpStatusErrors, true);
	}
	for (const deploymentUrl of [
		'https://user:password@demo.convex.cloud',
		'https://demo.convex.cloud?token=USER_SECRET_SENTINEL',
		'https://demo.convex.cloud#USER_SECRET_SENTINEL',
		'ftp://demo.convex.cloud',
	]) {
		await assert.rejects(
			() =>
				prepareFunctionRequest.call(
					parameterContext({ functionPath: 'users:get', arguments: '{}' }, { deploymentUrl }),
					{ url: '/api/query' },
				),
			/Deployment URL must be an HTTP\(S\) URL/,
		);
	}
	for (const args of ['[1]', 'null', '{']) {
		await assert.rejects(
			() =>
				prepareFunctionRequest.call(
					parameterContext({ functionPath: 'users:get', arguments: args }, { deploymentUrl: 'https://demo.convex.cloud' }),
					{ url: '/api/query' },
				),
			/Arguments must be a JSON object/,
		);
	}
	for (const args of ['', '   ', undefined, null]) {
		await assert.rejects(
			() =>
				prepareFunctionRequest.call(
					parameterContext({ functionPath: 'users:get', arguments: args }, { deploymentUrl: 'https://demo.convex.cloud' }),
					{ url: '/api/query' },
				),
			/Arguments must be a JSON object/,
		);
	}
	for (const functionPath of [{ path: 'users:get' }, '', '   ', 42, undefined, null]) {
		await assert.rejects(
			() =>
				prepareFunctionRequest.call(
					parameterContext({ functionPath, arguments: '{}' }, { deploymentUrl: 'https://demo.convex.cloud' }),
					{ url: '/api/query' },
				),
			/Function Path must be a non-empty string/,
		);
	}
	const trimmed = await prepareFunctionRequest.call(
		parameterContext({ functionPath: '  users:get  ', arguments: '{}' }, { deploymentUrl: 'https://demo.convex.cloud' }),
		{ url: '/api/query' },
	);
	assert.equal(trimmed.body.path, 'users:get');
});

test('function response preserves successful envelopes and redacts error envelopes', async () => {
	const { handleFunctionResponse } = require(transportPath);
	const success = {
		status: 'success',
		value: { name: 'Ada' },
		logLines: ['safe log'],
	};
	assert.deepEqual(
		await handleFunctionResponse.call(parameterContext({}), [], { body: success }),
		[{ json: success }],
	);
	await assert.rejects(
		() =>
			handleFunctionResponse.call(parameterContext({}), [], {
				body: {
					status: 'error',
					errorMessage: 'failed',
					errorData: { code: 'BAD_INPUT' },
					logLines: ['safe log'],
					requestOptions: { headers: { Authorization: 'Bearer TEAM_SECRET_SENTINEL' } },
				},
			}),
		(error) => {
			assert.match(String(error), /failed/);
			assert.doesNotMatch(String(error), /TEAM_SECRET_SENTINEL/);
			return true;
		},
	);
});

test('function response parses string and Buffer envelopes before validating them', async () => {
	const { handleFunctionResponse } = require(transportPath);
	const success = { status: 'success', value: { name: 'Ada' }, logLines: [] };
	for (const body of [JSON.stringify(success), Buffer.from(JSON.stringify(success), 'utf8')]) {
		assert.deepEqual(
			await handleFunctionResponse.call(parameterContext({}), [], { body, statusCode: 200 }),
			[{ json: success }],
		);
	}
	const errorEnvelope = JSON.stringify({
		status: 'error',
		errorMessage: 'boom',
		errorData: { apiKey: 'TEAM_SECRET_SENTINEL' },
	});
	for (const body of [errorEnvelope, Buffer.from(errorEnvelope, 'utf8')]) {
		await assert.rejects(
			() => handleFunctionResponse.call(parameterContext({}), [], { body, statusCode: 200 }),
			(error) => {
				assert.match(String(error), /boom/);
				assert.doesNotMatch(JSON.stringify(error, Object.getOwnPropertyNames(error)), /TEAM_SECRET_SENTINEL/);
				return true;
			},
		);
	}
});

test('function response rejects bodies that are not Convex envelopes', async () => {
	const { handleFunctionResponse } = require(transportPath);
	for (const body of [
		'<html><body>Checking your browser</body></html>',
		'{"code":"NotFound","message":"missing"}',
		{ code: 'NotFound', message: 'missing' },
		'null',
		'[1,2,3]',
		'not json at all',
		{ status: 'pending' },
	]) {
		await assert.rejects(
			() => handleFunctionResponse.call(parameterContext({}), [], { body, statusCode: 200 }),
			/Convex function response was not a Convex response envelope/,
		);
	}
});

test('function response sanitizes non-2xx Convex responses instead of surfacing them raw', async () => {
	const { handleFunctionResponse } = require(transportPath);
	await assert.rejects(
		() =>
			handleFunctionResponse.call(parameterContext({}), [], {
				statusCode: 400,
				body: JSON.stringify({
					status: 'error',
					errorMessage: 'Could not find function',
					errorData: { authorization: 'Bearer TEAM_SECRET_SENTINEL' },
				}),
			}),
		(error) => {
			assert.match(String(error), /Could not find function/);
			assert.doesNotMatch(JSON.stringify(error, Object.getOwnPropertyNames(error)), /TEAM_SECRET_SENTINEL/);
			return true;
		},
	);
	await assert.rejects(
		() =>
			handleFunctionResponse.call(parameterContext({}), [], {
				statusCode: 401,
				body: 'Unauthorized: token=TEAM_SECRET_SENTINEL',
			}),
		(error) => {
			assert.match(String(error), /Convex request failed/);
			assert.doesNotMatch(JSON.stringify(error, Object.getOwnPropertyNames(error)), /TEAM_SECRET_SENTINEL/);
			return true;
		},
	);
});

test('HTTP Action request confines JSON requests to configured origin with safe headers', async () => {
	const { Convex } = require(nodePath);
	const { prepareHttpActionRequest } = require(transportPath);
	const description = new Convex().description;
	const operation = description.properties.find(
		(field) => field.name === 'operation' && field.displayOptions.show.resource[0] === 'httpAction',
	);
	assert.deepEqual(operation.options.map((option) => option.value), ['request']);
	const method = description.properties.find((field) => field.name === 'method');
	assert.deepEqual(method.options.map((option) => option.value), ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
	const body = description.properties.find((field) => field.name === 'body');
	assert.deepEqual(body.displayOptions.show.method.sort(), ['PATCH', 'POST', 'PUT']);

	for (const httpMethod of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
		const request = await prepareHttpActionRequest.call(
			parameterContext(
				{
					method: httpMethod,
					path: '/hooks/run',
					queryParameters: '{"mode":"safe"}',
					headers: '{"X-Request-ID":"request-123"}',
					body: '{"name":"Ada"}',
				},
				{ httpActionsUrl: 'https://demo.convex.site' },
			),
			{ url: '/ignored' },
		);
		assert.equal(request.url, 'https://demo.convex.site/hooks/run');
		assert.deepEqual(request.qs, { mode: 'safe' });
		assert.deepEqual(request.headers, {
			'X-Request-ID': 'request-123',
			Accept: 'application/json',
			'Content-Type': 'application/json',
		});
		assert.equal(request.disableFollowRedirect, true);
		assert.equal(request.ignoreHttpStatusErrors, true);
		assert.deepEqual(request.body, ['POST', 'PUT', 'PATCH'].includes(httpMethod) ? { name: 'Ada' } : undefined);
	}
	for (const [path, expected] of [
		['https://evil.example/x', /Path must be an absolute path/],
		['//evil.example/x', /Path must be an absolute path/],
		['\\evil.example\\x', /Path must be an absolute path/],
		['/hooks/run?admin=true', /Path must be an absolute path .* without query or hash/],
		['/hooks/run#admin', /Path must be an absolute path .* without query or hash/],
		['/a/../secret', /Path cannot contain traversal segments/],
		['/%', /Path must be a valid percent-encoded absolute path/],
	]) {
		await assert.rejects(
			() =>
				prepareHttpActionRequest.call(
					parameterContext({ method: 'GET', path, queryParameters: '{}', headers: '{}' }, { httpActionsUrl: 'https://demo.convex.site' }),
					{ url: '/ignored' },
				),
			expected,
		);
	}
	await assert.rejects(
		() =>
			prepareHttpActionRequest.call(
				parameterContext({ method: 'GET', path: '/ok', queryParameters: '{}', headers: '{}' }, {}),
				{ url: '/ignored' },
			),
		/HTTP Actions URL is required/,
	);
	await assert.rejects(
		() =>
			prepareHttpActionRequest.call(
				parameterContext(
					{ method: 'GET', path: '/ok', queryParameters: '{}', headers: '{"Authorization":"Bearer injected"}' },
					{ httpActionsUrl: 'https://demo.convex.site' },
				),
				{ url: '/ignored' },
			),
		/Header Authorization cannot be overridden/,
	);
	await assert.rejects(
		() =>
			prepareHttpActionRequest.call(
				parameterContext(
					{ method: 'GET', path: '/ok', queryParameters: '{}', headers: '{"X Test":"invalid"}' },
					{ httpActionsUrl: 'https://demo.convex.site' },
				),
				{ url: '/ignored' },
			),
		/Headers must use valid HTTP field-name tokens/,
	);
	await assert.rejects(
		() =>
			prepareHttpActionRequest.call(
				parameterContext(
					{ method: 'TRACE', path: '/ok', queryParameters: '{}', headers: '{}' },
					{ httpActionsUrl: 'https://demo.convex.site' },
				),
				{ url: '/ignored' },
			),
		/HTTP Action method is not supported/,
	);
});

test('HTTP Action request rejects reserved and malformed headers and accepts cleared optional JSON fields', async () => {
	const { prepareHttpActionRequest } = require(transportPath);
	const credentials = { httpActionsUrl: 'https://demo.convex.site' };
	for (const headers of ['{"accept":"text/html"}', '{"Accept":"text/html"}']) {
		await assert.rejects(
			() =>
				prepareHttpActionRequest.call(
					parameterContext({ method: 'GET', path: '/ok', queryParameters: '{}', headers }, credentials),
					{ url: '/ignored' },
				),
			/cannot be overridden/,
		);
	}
	for (const headers of [
		JSON.stringify({ 'X-Test': `bad${String.fromCharCode(0)}value` }),
		JSON.stringify({ 'X-Test': `bad${String.fromCharCode(1)}value` }),
		JSON.stringify({ 'X-Test': `bad${String.fromCharCode(127)}value` }),
		JSON.stringify({ 'X-Test': 'line\rbreak' }),
		JSON.stringify({ 'X-Test': 'line\nbreak' }),
		JSON.stringify({ 'X-Test': 42 }),
	]) {
		await assert.rejects(
			() =>
				prepareHttpActionRequest.call(
					parameterContext({ method: 'GET', path: '/ok', queryParameters: '{}', headers }, credentials),
					{ url: '/ignored' },
				),
			/Headers must use single-line string values without control characters/,
		);
	}

	for (const blank of ['', '   ', undefined, null]) {
		const request = await prepareHttpActionRequest.call(
			parameterContext(
				{ method: 'POST', path: '/ok', queryParameters: blank, headers: blank, body: blank },
				credentials,
			),
			{ url: '/ignored' },
		);
		assert.deepEqual(request.qs, {});
		assert.deepEqual(request.body, {});
		assert.deepEqual(request.headers, { Accept: 'application/json', 'Content-Type': 'application/json' });
	}
});

test('HTTP Action response rejects non-success statuses that reach postReceive', async () => {
	const { handleHttpActionResponse } = require(transportPath);
	for (const statusCode of [302, 400, 401, 500]) {
		await assert.rejects(
			() =>
				handleHttpActionResponse.call(parameterContext({}), [], {
					body: '{"error":"nope"}',
					statusCode,
					headers: { 'content-type': 'application/json' },
				}),
			/HTTP Action request failed/,
		);
	}
});

test('HTTP Action responses require successful JSON and normalize non-object output', async () => {
	const { handleHttpActionResponse } = require(transportPath);
	for (const [body, expected] of [
		[{ ok: true }, { ok: true }],
		['["one"]', { data: ['one'] }],
		['"one"', { data: 'one' }],
		['1', { data: 1 }],
		['null', { data: null }],
	]) {
		assert.deepEqual(
			await handleHttpActionResponse.call(parameterContext({}), [], {
				body,
				statusCode: 200,
				headers: { 'content-type': 'application/json; charset=utf-8' },
			}),
			[{ json: expected }],
		);
	}
	for (const [response, expected] of [
		[
			{ body: '{}', statusCode: 302, headers: { 'content-type': 'application/json' } },
			/HTTP Action request failed/,
		],
		[
			{ body: '{}', statusCode: 200, headers: { 'content-type': 'text/html' } },
			/HTTP Action response must be JSON/,
		],
		[
			{ body: 'not json', statusCode: 200, headers: { 'content-type': 'application/json' } },
			/HTTP Action response was not valid JSON/,
		],
	]) {
		await assert.rejects(() => handleHttpActionResponse.call(parameterContext({}), [], response), expected);
	}
});

test('application metadata and transport configure neither retries nor Team credentials', () => {
	const nodeSource = readCompiledTree(nodePath);
	const transportSource = readCompiled(transportPath);
	// Positive controls: if these ever stop matching the scan is looking at the
	// wrong (or empty) files and the leak assertions below would be vacuous.
	assert.match(nodeSource, /convexApi/);
	assert.match(transportSource, /prepareFunctionRequest/);
	assert.doesNotMatch(nodeSource, /retry|convexTeamApi|teamAccessToken/);
	assert.doesNotMatch(transportSource, /retry|convexTeamApi|teamAccessToken/);
});
