const assert = require('node:assert/strict');
const test = require('node:test');

const utilsPath = '../dist/nodes/shared/convexUtils.js';

test('parseJsonObject accepts object JSON and rejects every non-object shape', () => {
	const { parseJsonObject } = require(utilsPath);
	assert.deepEqual(parseJsonObject('{"name":"Ada"}', 'Arguments'), { name: 'Ada' });
	assert.deepEqual(parseJsonObject({ name: 'Ada' }, 'Arguments'), { name: 'Ada' });
	for (const value of ['[]', 'null', '"x"', '42', '{', [], null, 42, '', '   ']) {
		assert.throws(() => parseJsonObject(value, 'Arguments'), /Arguments must be a JSON object/);
	}
});

test('parseJsonObject only treats blank input as an empty object when allowEmpty is set', () => {
	const { parseJsonObject } = require(utilsPath);
	for (const value of ['', '   ', '\n\t', undefined, null]) {
		assert.deepEqual(parseJsonObject(value, 'Headers', { allowEmpty: true }), {});
	}
	assert.deepEqual(parseJsonObject('{"a":1}', 'Headers', { allowEmpty: true }), { a: 1 });
	for (const value of ['[]', 'null', '"x"', '42', '{', [], 42]) {
		assert.throws(
			() => parseJsonObject(value, 'Headers', { allowEmpty: true }),
			/Headers must be a JSON object/,
		);
	}
});

test('resolveActionUrl never escapes the configured origin', () => {
	const { resolveActionUrl } = require(utilsPath);
	assert.equal(
		resolveActionUrl('https://demo.convex.site', '/hooks/run'),
		'https://demo.convex.site/hooks/run',
	);
	for (const [value, expected] of [
		['https://evil.example/x', /Path must be an absolute path/],
		['//evil.example/x', /Path must be an absolute path/],
		['\\\\evil.example\\x', /Path must be an absolute path/],
		['/hooks/run?admin=true', /Path must be an absolute path .* without query or hash/],
		['/hooks/run#fragment', /Path must be an absolute path .* without query or hash/],
		['/a/../secret', /Path cannot contain traversal segments/],
		['/a/%2e%2e/secret', /Path cannot contain traversal segments/],
		['/%252e%252e/secret', /Path cannot contain traversal segments/],
		['/%', /Path must be a valid percent-encoded absolute path/],
		['/%zz', /Path must be a valid percent-encoded absolute path/],
	]) {
		assert.throws(() => resolveActionUrl('https://demo.convex.site', value), expected);
	}
});

test('reserved headers are rejected case-insensitively', () => {
	const { validateHeaders } = require(utilsPath);
	for (const name of [
		'accept',
		'Accept',
		'authorization',
		'HOST',
		'Content-Length',
		'transfer-encoding',
		'content-type',
	]) {
		assert.throws(() => validateHeaders({ [name]: 'secret' }), /cannot be overridden/);
	}
});

test('normalizeBaseUrl rejects unsafe URL components and accepts local HTTP URLs', () => {
	const { normalizeBaseUrl } = require(utilsPath);
	assert.equal(normalizeBaseUrl('http://localhost:3210/', 'HTTP Actions URL'), 'http://localhost:3210');
	for (const value of [
		'https://user:password@demo.convex.site',
		'https://demo.convex.site?token=USER_SECRET_SENTINEL',
		'https://demo.convex.site#USER_SECRET_SENTINEL',
		'ftp://demo.convex.site',
	]) {
		assert.throws(() => normalizeBaseUrl(value, 'HTTP Actions URL'), /HTTP Actions URL must be an HTTP\(S\) URL/);
	}
});

test('validateHeaders accepts custom headers unchanged', () => {
	const { validateHeaders } = require(utilsPath);
	assert.deepEqual(validateHeaders('{"X-Request-ID":"request-123","X-Trace":"abc"}'), {
		'X-Request-ID': 'request-123',
		'X-Trace': 'abc',
	});
	assert.deepEqual(validateHeaders('', { allowEmpty: true }), {});
	assert.throws(() => validateHeaders(''), /Headers must be a JSON object/);
});

test('normalizeJsonOutput preserves objects and wraps non-object JSON values', () => {
	const { normalizeJsonOutput } = require(utilsPath);
	const object = { result: 'ok' };
	assert.deepEqual(normalizeJsonOutput(object), object);
	assert.deepEqual(normalizeJsonOutput(['one']), { data: ['one'] });
	assert.deepEqual(normalizeJsonOutput('one'), { data: 'one' });
	assert.deepEqual(normalizeJsonOutput(1), { data: 1 });
	assert.deepEqual(normalizeJsonOutput(null), { data: null });
});

test('assertTeamId accepts trimmed matches and rejects mismatches', () => {
	const { assertTeamId } = require(utilsPath);
	assert.doesNotThrow(() => assertTeamId(' team-123 ', 'team-123'));
	assert.throws(
		() => assertTeamId('team-123', 'team-456'),
		/Team Access Token belongs to a different team/,
	);
});

test('getSafeConvexError redacts sensitive nested and embedded error context', () => {
	const { getSafeConvexError } = require(utilsPath);
	const circularErrorData = { code: 'BAD_INPUT', field: 'name' };
	circularErrorData.self = circularErrorData;
	const safe = getSafeConvexError({
		errorMessage: 'Invalid arguments: Bearer MESSAGE_SECRET_SENTINEL token=MESSAGE_TOKEN_SECRET_SENTINEL',
		errorData: {
			code: 'BAD_INPUT',
			field: 'name',
			request_config: {
				headers: { Authorization: 'Bearer HEADER_SECRET_SENTINEL' },
				'X-Api-Key': 'API_KEY_SECRET_SENTINEL',
				body: { token: 'BODY_TOKEN_SECRET_SENTINEL' },
			},
			'access-token': 'ACCESS_TOKEN_SECRET_SENTINEL',
			circularErrorData,
		},
		logLines: [
			'safe log line',
			'retrying secret: LOG_SECRET_SENTINEL jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature',
		],
	});
	assert.match(safe.message, /Invalid arguments/);
	assert.match(safe.message, /\[REDACTED\]/);
	assert.match(safe.description, /BAD_INPUT/);
	assert.match(safe.description, /"field":"name"/);
	assert.match(safe.description, /safe log line/);
	assert.match(safe.description, /\[REDACTED\]/);
	assert.doesNotMatch(
		JSON.stringify(safe),
		/MESSAGE_SECRET_SENTINEL|MESSAGE_TOKEN_SECRET_SENTINEL|HEADER_SECRET_SENTINEL|API_KEY_SECRET_SENTINEL|BODY_TOKEN_SECRET_SENTINEL|ACCESS_TOKEN_SECRET_SENTINEL|LOG_SECRET_SENTINEL|eyJhbGciOiJIUzI1NiJ9/,
	);
});

test('sanitization redacts real JWTs without destroying dotted identifiers', () => {
	const { getSafeConvexError } = require(utilsPath);
	const safe = getSafeConvexError({
		errorMessage:
			'users.list.byId failed on api.convex.dev v1.24.3 with eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c',
		logLines: ['ran convex/http.ts:handler at 1.2.3'],
	});
	assert.match(safe.message, /users\.list\.byId/);
	assert.match(safe.message, /api\.convex\.dev/);
	assert.match(safe.message, /v1\.24\.3/);
	assert.match(safe.message, /\[REDACTED\]/);
	assert.doesNotMatch(safe.message, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
	assert.match(safe.description, /convex\/http\.ts:handler at 1\.2\.3/);
});

test('sensitive-key redaction matches whole keys and does not eat lookalike keys', () => {
	const { getSafeConvexError } = require(utilsPath);
	const safe = getSafeConvexError({
		errorMessage: 'failed',
		errorData: {
			bodyWeight: 72,
			tokenCount: 1024,
			headersSent: true,
			bearerType: 'none',
			apiKey: 'API_KEY_SECRET_SENTINEL',
			accessToken: 'ACCESS_TOKEN_SECRET_SENTINEL',
			'X-Api-Key': 'X_API_KEY_SECRET_SENTINEL',
			authorization: 'AUTHORIZATION_SECRET_SENTINEL',
			body: 'BODY_SECRET_SENTINEL',
			headers: 'HEADERS_SECRET_SENTINEL',
		},
	});
	assert.match(safe.description, /"bodyWeight":72/);
	assert.match(safe.description, /"tokenCount":1024/);
	assert.match(safe.description, /"headersSent":true/);
	assert.match(safe.description, /"bearerType":"none"/);
	assert.doesNotMatch(safe.description, /SECRET_SENTINEL/);
	for (const key of ['apiKey', 'accessToken', 'X-Api-Key', 'authorization', 'body', 'headers']) {
		assert.match(safe.description, new RegExp(`"${key}":"\\[REDACTED\\]"`));
	}
});
