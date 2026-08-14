const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const nodePath = '../dist/nodes/ConvexPlatform/ConvexPlatform.node.js';
const transportPath = '../dist/nodes/ConvexPlatform/transport.js';

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

const node = {
	id: 'node-1',
	name: 'Convex Platform',
	type: 'convexPlatform',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function parameterContext(parameters, credentials = {}, itemIndex = 0) {
	return {
		getNode: () => node,
		getItemIndex: () => itemIndex,
		getNodeParameter: (name) => parameters[name],
		getCredentials: async () => credentials,
	};
}

function operationsByValue(description, resource) {
	return Object.fromEntries(
		description.properties
			.filter((field) => field.name === 'operation' && field.displayOptions.show.resource[0] === resource)
			.flatMap((field) => field.options)
			.map((option) => [option.value, option]),
	);
}

async function runPreSend(option, parameters, credentials = {}) {
	return option.routing.send.preSend[0].call(parameterContext(parameters, credentials), {
		url: option.routing.request.url,
		qs: { ...(option.routing.request.qs ?? {}) },
	});
}

test('Platform exposes only approved read operations and Team API defaults', () => {
	const { ConvexPlatform } = require(nodePath);
	const description = new ConvexPlatform().description;
	const operations = description.properties
		.filter((field) => field.name === 'operation')
		.flatMap((field) => field.options.map((option) => option.value));

	assert.deepEqual(operations.sort(), ['get', 'getDetails', 'getMany', 'getMany']);
	assert.equal(description.requestDefaults.baseURL, 'https://api.convex.dev/v1');
	assert.equal(description.credentials[0].name, 'convexTeamApi');
	assert.equal(description.credentials[0].testedBy, 'convexPlatform');
	assert.equal(
		typeof new ConvexPlatform().methods.credentialTest.convexPlatform,
		'function',
		'testedBy must resolve to a credential test function',
	);
	assert.equal(description.usableAsTool, true);
	assert.equal(description.group[0], 'input');
	assert.deepEqual(description.inputs, ['main']);
	assert.deepEqual(description.outputs, ['main']);
	assert.doesNotMatch(
		readCompiledTree(nodePath),
		/convexApi|bearerToken|deploymentUrl|httpActionsUrl|retry|POST|PUT|PATCH|DELETE/,
	);
});

test('Platform operation routing uses exact GET paths with redirects disabled', async () => {
	const { ConvexPlatform } = require(nodePath);
	const description = new ConvexPlatform().description;
	const deployment = operationsByValue(description, 'deployment');
	const project = operationsByValue(description, 'project');
	const token = operationsByValue(description, 'token');
	const methods = description.properties
		.filter((field) => field.name === 'operation')
		.flatMap((field) => field.options)
		.map((option) => option.routing.request.method);

	assert.deepEqual([...new Set(methods)], ['GET']);

	const requests = [
		await runPreSend(deployment.get, {
			resource: 'deployment',
			operation: 'get',
			projectId: '481',
			lookupMode: 'defaultProd',
		}),
		await runPreSend(deployment.getMany, {
			resource: 'deployment',
			operation: 'getMany',
			projectId: '481',
		}),
		await runPreSend(project.getMany, { resource: 'project', operation: 'getMany', returnAll: true }, { teamId: '17' }),
		await runPreSend(token.getDetails, { resource: 'token', operation: 'getDetails' }),
	];

	assert.deepEqual(
		requests.map((request) => request.url),
		[
			'/projects/481/deployment',
			'/projects/481/list_deployments',
			'/teams/17/projects',
			'/token_details',
		],
	);
	for (const request of requests) {
		assert.equal(request.disableFollowRedirect, true);
	}
});

test('Platform request preparation rejects path injection in project and team identifiers', async () => {
	const { ConvexPlatform } = require(nodePath);
	const description = new ConvexPlatform().description;
	const deployment = operationsByValue(description, 'deployment').getMany;
	const project = operationsByValue(description, 'project').getMany;
	const hostileIds = ['abc/../x', '../../teams/999/projects', 'abc?limit=1', 'abc#f', 'abc def', '', '   '];

	for (const projectId of hostileIds) {
		await assert.rejects(
			() => runPreSend(deployment, { resource: 'deployment', operation: 'getMany', projectId }),
			/Project ID must contain only letters, numbers, hyphens, or underscores/,
			`project id ${JSON.stringify(projectId)} must be rejected`,
		);
		await assert.rejects(
			() =>
				runPreSend(project, { resource: 'project', operation: 'getMany', returnAll: true }, { teamId: projectId }),
			/Team ID must contain only letters, numbers, hyphens, or underscores/,
			`team id ${JSON.stringify(projectId)} must be rejected`,
		);
	}

	for (const projectId of ['481', 'proj_1', 'proj-1', 481]) {
		const request = await runPreSend(deployment, {
			resource: 'deployment',
			operation: 'getMany',
			projectId,
		});
		assert.equal(request.url, `/projects/${projectId}/list_deployments`);
	}
});

test('Platform request preparation clamps the wire limit and drops blank query values', async () => {
	const { preparePlatformRequest } = require(transportPath);
	const context = parameterContext({ resource: 'project', operation: 'getMany', returnAll: false }, { teamId: '17' });

	const clamped = await preparePlatformRequest.call(context, {
		url: '/teams/17/projects',
		qs: { limit: 500, cursor: undefined, q: '', deploymentType: null },
	});
	const raised = await preparePlatformRequest.call(context, { url: '', qs: { limit: '0' } });
	const returnAll = await preparePlatformRequest.call(
		parameterContext({ resource: 'project', operation: 'getMany', returnAll: true }, { teamId: '17' }),
		{ url: '', qs: { limit: undefined } },
	);

	assert.deepEqual(clamped.qs, { limit: 100 });
	assert.deepEqual(raised.qs, { limit: 1 });
	assert.deepEqual(returnAll.qs, {});
});

test('Deployment lookup by reference requires a non-empty reference', async () => {
	const { ConvexPlatform } = require(nodePath);
	const get = operationsByValue(new ConvexPlatform().description, 'deployment').get;

	const resolved = await get.routing.send.preSend[0].call(
		parameterContext({ resource: 'deployment', operation: 'get', projectId: '481', lookupMode: 'reference' }),
		{ url: get.routing.request.url, qs: { reference: ' prod ', defaultProd: undefined, defaultDev: undefined } },
	);
	assert.deepEqual(resolved.qs, { reference: 'prod' });

	for (const reference of [undefined, '', '   ', null]) {
		await assert.rejects(
			() =>
				get.routing.send.preSend[0].call(
					parameterContext({
						resource: 'deployment',
						operation: 'get',
						projectId: '481',
						lookupMode: 'reference',
					}),
					{ url: get.routing.request.url, qs: { reference } },
				),
			/Reference is required when Lookup Mode is Reference/,
		);
	}

	const defaultProd = await get.routing.send.preSend[0].call(
		parameterContext({ resource: 'deployment', operation: 'get', projectId: '481', lookupMode: 'defaultProd' }),
		{ url: get.routing.request.url, qs: { reference: undefined, defaultProd: true, defaultDev: undefined } },
	);
	assert.deepEqual(defaultProd.qs, { defaultProd: true });
});

test('token details validates the Team Access Token team before returning one paired item', async () => {
	const { handleTokenDetails } = require(transportPath);
	const body = { teamId: 123, id: 'token-id', type: 'teamToken' };

	assert.deepEqual(
		await handleTokenDetails.call(parameterContext({}, { teamId: ' 123 ' }, 3), [], { body }),
		[{ json: body, pairedItem: { item: 3 } }],
	);
	await assert.rejects(
		() => handleTokenDetails.call(parameterContext({}, { teamId: '456' }), [], { body }),
		/Team Access Token belongs to a different team/,
	);
	await assert.rejects(
		() => handleTokenDetails.call(parameterContext({}, { teamId: '' }), [], { body }),
		/Team ID is missing from the Convex Team API credential/,
	);
	await assert.rejects(
		() =>
			handleTokenDetails.call(parameterContext({}, { teamId: '123' }), [], {
				body: { id: 'token-id', projectId: 7, type: 'projectToken' },
			}),
		/Convex did not return a team ID for this Team Access Token/,
	);
	await assert.rejects(
		() => handleTokenDetails.call(parameterContext({}, { teamId: '123' }), [], { body: '<html>ok</html>' }),
		/Convex returned an unexpected token details response/,
	);
});

test('project pagination configuration has bounded limits and sends limit only without Return All', () => {
	const { ConvexPlatform } = require(nodePath);
	const description = new ConvexPlatform().description;
	const returnAll = description.properties.find((field) => field.name === 'returnAll');
	const limit = description.properties.find((field) => field.name === 'limit');
	const projectOperation = operationsByValue(description, 'project').getMany;

	assert.equal(returnAll.default, false);
	assert.equal(limit.default, 50);
	assert.equal(limit.typeOptions.minValue, 1);
	assert.equal(limit.typeOptions.maxValue, 100);
	assert.equal(typeof projectOperation.routing.operations.pagination, 'function');
	assert.deepEqual(projectOperation.routing.request.qs, {
		limit: '={{$parameter.returnAll ? undefined : $parameter.limit}}',
	});
	assert.equal(
		projectOperation.routing.output.maxResults,
		'={{$parameter.returnAll ? undefined : $parameter.limit}}',
	);
	assert.equal(projectOperation.routing.send.paginate, '={{$parameter.returnAll}}');
});

test('project extraction pairs items, respects a final limit, and rejects unexpected bodies', async () => {
	const { extractProjects } = require(transportPath);
	const response = {
		body: {
			items: [{ id: 'project-1' }, { id: 'project-2' }, { id: 'project-3' }],
			pagination: { hasMore: false },
		},
	};

	assert.deepEqual(await extractProjects.call(parameterContext({ returnAll: false, limit: 2 }, {}, 5), [], response), [
		{ json: { id: 'project-1' }, pairedItem: { item: 5 } },
		{ json: { id: 'project-2' }, pairedItem: { item: 5 } },
	]);
	assert.equal(
		(await extractProjects.call(parameterContext({ returnAll: true, limit: 100 }), [], response)).length,
		3,
	);
	for (const body of [{ projects: [] }, [{ id: 'project-1' }], '<html>ok</html>', null]) {
		await assert.rejects(
			() => extractProjects.call(parameterContext({ returnAll: true }), [], { body }),
			/Convex returned an unexpected projects response/,
		);
	}
});

test('project cursor guard rejects empty pages, absent cursors, and stalled cursors', () => {
	const { guardProjectCursor } = require(transportPath);

	assert.equal(guardProjectCursor(undefined, 'cursor-1', [{ id: 1 }]), true);
	assert.equal(guardProjectCursor('cursor-1', 'cursor-2', [{ id: 1 }]), true);
	assert.throws(
		() => guardProjectCursor(undefined, 'cursor-1', []),
		/Project pagination reported more results but returned an empty page/,
	);
	for (const cursor of [undefined, null, '', '   ', { nextCursor: 'x' }]) {
		assert.throws(
			() => guardProjectCursor('cursor-1', cursor, [{ id: 1 }]),
			/Project pagination reported more results but returned no cursor/,
		);
	}
	assert.throws(
		() => guardProjectCursor('cursor-1', 'cursor-1', [{ id: 1 }]),
		/Project pagination did not advance/,
	);
});

test('project pagination rejects cursor cycles and restores a reused request object between executions', async () => {
	const { extractProjects, paginateProjects } = require(transportPath);

	async function runPages(pages, requestOptions, execution = {}) {
		let requestCount = 0;
		const requestQueries = [];
		const options = requestOptions ?? {
			options: { url: '/teams/17/projects', qs: {} },
			preSend: [],
			postReceive: [{ data: { parameterValue: undefined }, actions: [extractProjects] }],
		};
		const context = {
			getNode: () => node,
			getItemIndex: () => 0,
			getNodeParameter: (name) => (name === 'returnAll' ? true : 100),
			makeRoutingRequest: async (routingOptions) => {
				execution.requestCount = ++requestCount;
				requestQueries.push({ ...routingOptions.options.qs });
				const response = pages[requestCount - 1];
				let items = [];
				for (const action of routingOptions.postReceive[0].actions) {
					items = await action.call(context, items, response);
				}
				return items;
			},
		};
		return { output: await paginateProjects.call(context, options), options, requestCount, requestQueries };
	}

	const twoPages = [
		{ body: { items: [{ id: 'project-1' }], pagination: { hasMore: true, nextCursor: 'cursor-1' } } },
		{ body: { items: [{ id: 'project-2' }], pagination: { hasMore: false } } },
	];
	const firstExecution = await runPages(twoPages);
	assert.deepEqual(firstExecution.output, [
		{ json: { id: 'project-1' }, pairedItem: { item: 0 } },
		{ json: { id: 'project-2' }, pairedItem: { item: 0 } },
	]);
	assert.equal(firstExecution.requestCount, 2);
	assert.deepEqual(firstExecution.requestQueries, [{}, { cursor: 'cursor-1' }]);

	const cycleExecution = {};
	await assert.rejects(
		() =>
			runPages(
				[
					{ body: { items: [{ id: 'project-1' }], pagination: { hasMore: true, nextCursor: 'cursor-a' } } },
					{ body: { items: [{ id: 'project-2' }], pagination: { hasMore: true, nextCursor: 'cursor-b' } } },
					{ body: { items: [{ id: 'project-3' }], pagination: { hasMore: true, nextCursor: 'cursor-a' } } },
				],
				undefined,
				cycleExecution,
			),
		/Project pagination did not advance/,
	);
	assert.equal(cycleExecution.requestCount, 3);

	const independentExecution = await runPages(twoPages, firstExecution.options);
	assert.equal(independentExecution.requestCount, 2);
	assert.deepEqual(independentExecution.requestQueries, [{}, { cursor: 'cursor-1' }]);
	assert.deepEqual(independentExecution.options.options.qs, {});

	await assert.rejects(
		() =>
			runPages([
				{ body: { items: [{ id: 'project-1' }], pagination: { hasMore: true, nextCursor: '' } } },
			]),
		/Project pagination reported more results but returned no cursor/,
	);
	await assert.rejects(
		() => runPages([{ body: { items: [{ id: 'project-1' }], pagination: { hasMore: true } } }]),
		/Project pagination reported more results but returned no cursor/,
	);
	await assert.rejects(
		() => runPages([{ body: { items: [], pagination: { hasMore: true, nextCursor: 'cursor-1' } } }]),
		/Project pagination reported more results but returned an empty page/,
	);
	await assert.rejects(
		() => runPages([{ body: { items: [{ id: 'project-1' }] } }]),
		/Convex returned an unexpected projects pagination response/,
	);
});

test('deployment extraction pairs items, matches the operation shape, and rejects other bodies', async () => {
	const { ConvexPlatform } = require(nodePath);
	const { extractDeployments } = require(transportPath);
	const description = new ConvexPlatform().description;
	const get = operationsByValue(description, 'deployment').get;

	assert.deepEqual(
		await extractDeployments.call(parameterContext({ operation: 'getMany' }, {}, 2), [], {
			body: [{ name: 'prod' }, { name: 'dev' }],
		}),
		[
			{ json: { name: 'prod' }, pairedItem: { item: 2 } },
			{ json: { name: 'dev' }, pairedItem: { item: 2 } },
		],
	);
	assert.deepEqual(
		await extractDeployments.call(parameterContext({ operation: 'get' }), [], { body: { name: 'prod' } }),
		[{ json: { name: 'prod' }, pairedItem: { item: 0 } }],
	);
	for (const body of [{ name: 'prod' }, '<html>ok</html>', null]) {
		await assert.rejects(
			() => extractDeployments.call(parameterContext({ operation: 'getMany' }), [], { body }),
			/Convex returned an unexpected deployments response/,
		);
	}
	for (const body of [[{ name: 'prod' }], '<html>ok</html>', null]) {
		await assert.rejects(
			() => extractDeployments.call(parameterContext({ operation: 'get' }), [], { body }),
			/Convex returned an unexpected deployment response/,
		);
	}

	assert.deepEqual(get.routing.request.qs, {
		reference: '={{$parameter.lookupMode === "reference" ? $parameter.reference : undefined}}',
		defaultProd: '={{$parameter.lookupMode === "defaultProd" ? true : undefined}}',
		defaultDev: '={{$parameter.lookupMode === "defaultDev" ? true : undefined}}',
	});
	assert.deepEqual(
		description.properties.find((field) => field.name === 'lookupMode').options.map((option) => option.value),
		['reference', 'defaultProd', 'defaultDev'],
	);
	const reference = description.properties.find((field) => field.name === 'reference');
	assert.equal(reference.required, true);
	assert.deepEqual(reference.displayOptions.show.lookupMode, ['reference']);
});

test('Platform transport has no retry configuration or application-token fields', () => {
	const transportSource = readCompiled(transportPath);
	// Positive control: if this stops matching the scan is reading the wrong file
	// and the leak assertion below would be vacuous.
	assert.match(transportSource, /convexTeamApi/);
	assert.doesNotMatch(
		transportSource,
		/convexApi|bearerToken|deploymentUrl|httpActionsUrl|retry/,
	);
});
