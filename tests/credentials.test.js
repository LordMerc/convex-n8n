const assert = require('node:assert/strict');
const test = require('node:test');

const { ConvexApi } = require('../dist/credentials/ConvexApi.credentials.js');
const { ConvexTeamApi } = require('../dist/credentials/ConvexTeamApi.credentials.js');
const { ConvexPlatform } = require('../dist/nodes/ConvexPlatform/ConvexPlatform.node.js');

const tokenSentinel = 'TEAM_SECRET_SENTINEL';

function credentialTest() {
	return new ConvexPlatform().methods.credentialTest.convexPlatform;
}

function requestContext(handler) {
	const calls = [];
	return {
		calls,
		context: {
			logger: { debug() {}, error() {}, info() {}, warn() {} },
			helpers: {
				request: async (options) => {
					calls.push(options);
					return handler(options);
				},
			},
		},
	};
}

function teamCredential(data) {
	return { id: 'credential-1', name: 'Convex Team API', type: 'convexTeamApi', data };
}

test('tokens are secret fields and credentials use separate auth schemes', () => {
	const app = new ConvexApi();
	const team = new ConvexTeamApi();

	assert.equal(app.name, 'convexApi');
	assert.equal(team.name, 'convexTeamApi');
	assert.equal(app.properties.find((field) => field.name === 'deploymentUrl').type, 'string');
	assert.equal(app.properties.find((field) => field.name === 'deploymentUrl').required, true);
	assert.equal(app.properties.find((field) => field.name === 'httpActionsUrl').type, 'string');
	assert.notEqual(app.properties.find((field) => field.name === 'httpActionsUrl').required, true);
	assert.equal(app.properties.find((field) => field.name === 'bearerToken').typeOptions.password, true);
	assert.equal(
		team.properties.find((field) => field.name === 'teamAccessToken').typeOptions.password,
		true,
	);
});

test('application authentication attaches only a non-empty application bearer token', async () => {
	const app = new ConvexApi();
	const authenticated = await app.authenticate(
		{ bearerToken: ' USER_SECRET_SENTINEL ' },
		{ headers: { 'X-Request-ID': 'request-123' } },
	);
	const unauthenticated = await app.authenticate({ bearerToken: '  ' }, { headers: {} });

	assert.deepEqual(authenticated.headers, {
		'X-Request-ID': 'request-123',
		Authorization: 'Bearer USER_SECRET_SENTINEL',
	});
	assert.equal(unauthenticated.headers.Authorization, undefined);
});

test('application credential test probes the deployment function API and reports auth failures', () => {
	const { test: credentialTestRequest } = new ConvexApi();

	assert.equal(credentialTestRequest.request.method, 'POST');
	assert.equal(credentialTestRequest.request.baseURL, '={{$credentials.deploymentUrl}}');
	assert.equal(credentialTestRequest.request.url, '/api/query');
	assert.equal(credentialTestRequest.request.disableFollowRedirect, true);
	assert.equal(credentialTestRequest.request.headers['Content-Type'], 'application/json');
	assert.equal(credentialTestRequest.request.body.format, 'json');
	assert.deepEqual(credentialTestRequest.request.body.args, {});
	assert.match(credentialTestRequest.request.body.path, /^[A-Za-z0-9_]+:[A-Za-z0-9_]+$/);
	assert.deepEqual(
		credentialTestRequest.rules.map((rule) => [rule.type, rule.properties.value]),
		[
			['responseCode', 401],
			['responseCode', 404],
		],
	);
	for (const rule of credentialTestRequest.rules) {
		assert.equal(typeof rule.properties.message, 'string');
		assert.notEqual(rule.properties.message, '');
	}
});

test('team authentication is fixed to the Team API and has no declarative team check', () => {
	const team = new ConvexTeamApi();

	assert.deepEqual(team.authenticate, {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.teamAccessToken}}',
			},
		},
	});
	// Declarative rules never resolve `$credentials`, so the team check lives in the node instead.
	assert.equal(team.test, undefined);
	assert.doesNotMatch(JSON.stringify(team), /deploymentUrl|httpActionsUrl|bearerToken/);
});

test('team credential test accepts a token scoped to the configured team', async () => {
	const { calls, context } = requestContext(async () => ({ teamId: 123, type: 'teamToken' }));

	const result = await credentialTest().call(
		context,
		teamCredential({ teamId: ' 123 ', teamAccessToken: tokenSentinel }),
	);

	assert.deepEqual(result, { status: 'OK', message: 'Connection tested successfully' });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].method, 'GET');
	assert.equal(calls[0].url, 'https://api.convex.dev/v1/token_details');
	assert.equal(calls[0].headers.Authorization, `Bearer ${tokenSentinel}`);
	assert.equal(calls[0].followRedirect, false);
	assert.equal(calls[0].json, true);
});

test('team credential test rejects tokens for another team, missing teams, and bad responses', async () => {
	const otherTeam = await credentialTest().call(
		requestContext(async () => ({ teamId: 999 })).context,
		teamCredential({ teamId: '123', teamAccessToken: tokenSentinel }),
	);
	const projectToken = await credentialTest().call(
		requestContext(async () => ({ id: 'token-1', projectId: 7, type: 'projectToken' })).context,
		teamCredential({ teamId: '123', teamAccessToken: tokenSentinel }),
	);
	const htmlBody = await credentialTest().call(
		requestContext(async () => `<html><body>${tokenSentinel}</body></html>`).context,
		teamCredential({ teamId: '123', teamAccessToken: tokenSentinel }),
	);
	const missingTeamId = await credentialTest().call(
		requestContext(async () => ({ teamId: 1 })).context,
		teamCredential({ teamId: '   ', teamAccessToken: tokenSentinel }),
	);
	const missingToken = await credentialTest().call(
		requestContext(async () => ({ teamId: 1 })).context,
		teamCredential({ teamId: '123' }),
	);

	assert.deepEqual(otherTeam, {
		status: 'Error',
		message: 'Team Access Token belongs to a different team',
	});
	assert.deepEqual(projectToken, {
		status: 'Error',
		message: 'Convex did not return a team ID for this Team Access Token',
	});
	assert.deepEqual(htmlBody, {
		status: 'Error',
		message: 'Convex returned an unexpected token details response',
	});
	assert.deepEqual(missingTeamId, { status: 'Error', message: 'Team ID is required' });
	assert.deepEqual(missingToken, { status: 'Error', message: 'Team Access Token is required' });
	for (const result of [otherTeam, projectToken, htmlBody, missingTeamId, missingToken]) {
		assert.doesNotMatch(result.message, new RegExp(tokenSentinel));
	}
});

test('team credential test reports request failures without echoing credentials or bodies', async () => {
	const unauthorized = Object.assign(new Error(`Request failed for Bearer ${tokenSentinel}`), {
		statusCode: 401,
		response: { body: { message: tokenSentinel } },
	});
	const offline = new Error(`connect ECONNREFUSED for ${tokenSentinel}`);

	const rejected = await credentialTest().call(
		requestContext(async () => {
			throw unauthorized;
		}).context,
		teamCredential({ teamId: '123', teamAccessToken: tokenSentinel }),
	);
	const unreachable = await credentialTest().call(
		requestContext(async () => {
			throw offline;
		}).context,
		teamCredential({ teamId: '123', teamAccessToken: tokenSentinel }),
	);

	assert.deepEqual(rejected, {
		status: 'Error',
		message: 'Convex Platform API returned HTTP 401',
	});
	assert.deepEqual(unreachable, {
		status: 'Error',
		message: 'Could not reach the Convex Platform API',
	});
	for (const result of [rejected, unreachable]) {
		assert.doesNotMatch(result.message, new RegExp(tokenSentinel));
		assert.doesNotMatch(result.message, /Bearer/);
	}
});
