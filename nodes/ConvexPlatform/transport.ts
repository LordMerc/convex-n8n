import {
	NodeOperationError,
	type IDataObject,
	type DeclarativeRestApiSettings,
	type IExecutePaginationFunctions,
	type IExecuteSingleFunctions,
	type IHttpRequestOptions,
	type INodeExecutionData,
	type IN8nHttpFullResponse,
} from 'n8n-workflow';

import { assertTeamId, isDataObject, normalizeJsonOutput } from '../shared/convexUtils';

/**
 * Convex Platform identifiers are numeric in the API schema. A conservative superset is enforced so
 * a project or team ID can never add path segments, a query string, or a fragment to the endpoint.
 */
const platformIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

function createPlatformError(
	context: IExecuteSingleFunctions,
	message: string,
): NodeOperationError {
	return new NodeOperationError(context.getNode(), message);
}

/** Rewrites the plain errors raised by the validation helpers into node-aware errors. */
function runValidation<T>(context: IExecuteSingleFunctions, validate: () => T): T {
	try {
		return validate();
	} catch (error) {
		throw createPlatformError(
			context,
			error instanceof Error ? error.message : 'Convex Platform request could not be prepared',
		);
	}
}

function assertPlatformId(value: unknown, fieldName: string): string {
	const id =
		typeof value === 'number' && Number.isInteger(value)
			? String(value)
			: typeof value === 'string'
				? value.trim()
				: '';
	if (!platformIdPattern.test(id)) {
		throw new Error(`${fieldName} must contain only letters, numbers, hyphens, or underscores`);
	}
	return id;
}

function toExecutionItems(
	context: IExecuteSingleFunctions,
	values: unknown[],
): INodeExecutionData[] {
	const item = context.getItemIndex();
	return values.map((value) => ({ json: normalizeJsonOutput(value), pairedItem: { item } }));
}

function getStringParameter(context: IExecuteSingleFunctions, name: string): string {
	const value = context.getNodeParameter(name);
	return typeof value === 'string' ? value : '';
}

function getProjectPage(body: unknown): unknown[] {
	if (!isDataObject(body) || !Array.isArray(body.items)) {
		throw new Error('Convex returned an unexpected projects response');
	}
	return body.items;
}

function getProjectPagination(body: unknown): IDataObject {
	const pagination = isDataObject(body) ? body.pagination : undefined;
	if (!isDataObject(pagination) || typeof pagination.hasMore !== 'boolean') {
		throw new Error('Convex returned an unexpected projects pagination response');
	}
	return pagination;
}

function getBoundedLimit(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 50;
	return Math.min(100, Math.max(1, Math.floor(parsed)));
}

async function resolvePlatformUrl(
	context: IExecuteSingleFunctions,
	resource: string,
	operation: string,
): Promise<string> {
	if (resource === 'token') return '/token_details';

	if (resource === 'project') {
		const credentials = await context.getCredentials<{ teamId?: unknown }>('convexTeamApi');
		const teamId = runValidation(context, () => assertPlatformId(credentials.teamId, 'Team ID'));
		return `/teams/${teamId}/projects`;
	}

	if (resource === 'deployment') {
		const projectId = runValidation(context, () =>
			assertPlatformId(context.getNodeParameter('projectId'), 'Project ID'),
		);
		return operation === 'get'
			? `/projects/${projectId}/deployment`
			: `/projects/${projectId}/list_deployments`;
	}

	throw createPlatformError(context, 'Unsupported Convex Platform resource');
}

function preparePlatformQuery(
	context: IExecuteSingleFunctions,
	query: IDataObject | undefined,
	resource: string,
	operation: string,
): IDataObject | undefined {
	if (query === undefined) return undefined;

	const prepared: IDataObject = {};
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null) continue;
		if (typeof value === 'string' && value.trim() === '') continue;
		if (key === 'limit') {
			prepared.limit = getBoundedLimit(value);
			continue;
		}
		prepared[key] = key === 'reference' ? String(value).trim() : value;
	}

	if (
		resource === 'deployment' &&
		operation === 'get' &&
		getStringParameter(context, 'lookupMode') === 'reference' &&
		typeof prepared.reference !== 'string'
	) {
		throw createPlatformError(context, 'Reference is required when Lookup Mode is Reference');
	}

	return prepared;
}

export async function preparePlatformRequest(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const resource = getStringParameter(this, 'resource');
	const operation = getStringParameter(this, 'operation');

	requestOptions.disableFollowRedirect = true;
	// Rebuild the path from validated components so no parameter or credential value is interpolated raw.
	requestOptions.url = await resolvePlatformUrl(this, resource, operation);
	requestOptions.qs = preparePlatformQuery(this, requestOptions.qs, resource, operation);
	return requestOptions;
}

export async function handleTokenDetails(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const credentials = await this.getCredentials<{ teamId?: unknown }>('convexTeamApi');
	const body = response.body;
	if (!isDataObject(body)) {
		throw createPlatformError(this, 'Convex returned an unexpected token details response');
	}
	runValidation(this, () => assertTeamId(credentials.teamId, body.teamId));
	return toExecutionItems(this, [body]);
}

export function guardProjectCursor(current: unknown, next: unknown, page: unknown[]): boolean {
	if (page.length === 0) {
		throw new Error('Project pagination reported more results but returned an empty page');
	}
	const nextCursor = typeof next === 'string' || typeof next === 'number' ? String(next).trim() : '';
	if (nextCursor === '') {
		throw new Error('Project pagination reported more results but returned no cursor');
	}
	if (String(current ?? '').trim() === nextCursor) {
		throw new Error('Project pagination did not advance');
	}
	return true;
}

export async function extractProjects(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const page = runValidation(this, () => getProjectPage(response.body));
	return this.getNodeParameter('returnAll') === true
		? toExecutionItems(this, page)
		: toExecutionItems(this, page.slice(0, getBoundedLimit(this.getNodeParameter('limit'))));
}

export async function paginateProjects(
	this: IExecutePaginationFunctions,
	requestOptions: DeclarativeRestApiSettings.ResultOptions,
): Promise<INodeExecutionData[]> {
	let responseBody: unknown;
	let currentCursor: unknown;
	const seenCursors = new Set<string>();
	const projectItems: INodeExecutionData[] = [];
	const originalPostReceive = requestOptions.postReceive;
	const originalQuery = requestOptions.options.qs;
	const captureResponse = async (
		items: INodeExecutionData[],
		response: IN8nHttpFullResponse,
	): Promise<INodeExecutionData[]> => {
		responseBody = response.body;
		return items;
	};

	requestOptions.postReceive = originalPostReceive.map(({ data, actions }) => ({
		data,
		actions: [captureResponse, ...actions],
	}));

	try {
		while (true) {
			responseBody = undefined;
			projectItems.push(...(await this.makeRoutingRequest(requestOptions)));

			const body = responseBody;
			const pagination = runValidation(this, () => getProjectPagination(body));
			if (pagination.hasMore !== true) break;

			const page = runValidation(this, () => getProjectPage(body));
			const nextCursor = pagination.nextCursor;
			runValidation(this, () => guardProjectCursor(currentCursor, nextCursor, page));
			const normalizedCursor = String(nextCursor);
			if (seenCursors.has(normalizedCursor)) {
				throw createPlatformError(this, 'Project pagination did not advance');
			}
			seenCursors.add(normalizedCursor);
			currentCursor = nextCursor;
			requestOptions.options.qs = { ...requestOptions.options.qs, cursor: nextCursor as never };
		}
	} finally {
		requestOptions.postReceive = originalPostReceive;
		requestOptions.options.qs = originalQuery;
	}

	return projectItems;
}

export async function extractDeployments(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const body = response.body;
	if (getStringParameter(this, 'operation') === 'getMany') {
		if (!Array.isArray(body)) {
			throw createPlatformError(this, 'Convex returned an unexpected deployments response');
		}
		return toExecutionItems(this, body);
	}

	if (!isDataObject(body)) {
		throw createPlatformError(this, 'Convex returned an unexpected deployment response');
	}
	return toExecutionItems(this, [body]);
}
