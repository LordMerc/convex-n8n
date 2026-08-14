import {
	NodeApiError,
	NodeOperationError,
	type IDataObject,
	type IExecuteSingleFunctions,
	type IHttpRequestOptions,
	type INodeExecutionData,
	type IN8nHttpFullResponse,
} from 'n8n-workflow';

import {
	getSafeConvexError,
	isDataObject,
	normalizeBaseUrl,
	normalizeJsonOutput,
	parseJsonObject,
	resolveActionUrl,
	validateHeaders,
} from '../shared/convexUtils';

function createSafeOperationError(
	context: IExecuteSingleFunctions,
	message: string,
	description?: string,
): NodeOperationError {
	return new NodeOperationError(context.getNode(), message, { description });
}

/**
 * Runs request validation and rewrites the plain errors raised by the shared helpers into
 * node-aware errors, so every validation failure surfaces with this node's context.
 */
function runValidation<T>(context: IExecuteSingleFunctions, validate: () => T): T {
	try {
		return validate();
	} catch (error) {
		throw createSafeOperationError(
			context,
			error instanceof Error ? error.message : 'Convex request could not be prepared',
		);
	}
}

function parseHttpActionBody(context: IExecuteSingleFunctions): IDataObject {
	return parseJsonObject(context.getNodeParameter('body'), 'Body', { allowEmpty: true });
}

const httpFieldName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const httpFieldValue = /^[\t\x20-\x7e\x80-\xff]*$/;

function validateCustomHeaderValues(headers: IDataObject): IDataObject {
	for (const [name, value] of Object.entries(headers)) {
		if (!httpFieldName.test(name)) {
			throw new Error('Headers must use valid HTTP field-name tokens');
		}
		if (typeof value !== 'string' || !httpFieldValue.test(value)) {
			throw new Error('Headers must use single-line string values without control characters');
		}
	}
	return headers;
}

function getJsonBody(response: IN8nHttpFullResponse): unknown | undefined {
	if (typeof response.body === 'string') {
		try {
			return JSON.parse(response.body);
		} catch {
			return undefined;
		}
	}

	if (Buffer.isBuffer(response.body)) {
		try {
			return JSON.parse(response.body.toString('utf8'));
		} catch {
			return undefined;
		}
	}

	return response.body;
}

function hasJsonContentType(headers: IDataObject): boolean {
	const contentType = headers['content-type'] ?? headers['Content-Type'];
	return typeof contentType === 'string' && /(?:^|[+/])json(?:\s*;|$)/i.test(contentType);
}

export async function prepareFunctionRequest(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const credentials = await this.getCredentials<{ deploymentUrl?: unknown }>('convexApi');
	return runValidation(this, () => {
		requestOptions.baseURL = normalizeBaseUrl(credentials.deploymentUrl, 'Deployment URL');

		const functionPath = this.getNodeParameter('functionPath');
		if (typeof functionPath !== 'string' || functionPath.trim() === '') {
			throw new Error('Function Path must be a non-empty string');
		}

		requestOptions.body = {
			path: functionPath.trim(),
			args: parseJsonObject(this.getNodeParameter('arguments'), 'Arguments'),
			format: 'json',
		};
		requestOptions.disableFollowRedirect = true;
		// Let handleFunctionResponse sanitize Convex error bodies instead of surfacing them raw.
		requestOptions.ignoreHttpStatusErrors = true;
		return requestOptions;
	});
}

function isConvexEnvelope(body: unknown): body is IDataObject & { status: 'success' | 'error' } {
	return isDataObject(body) && (body.status === 'success' || body.status === 'error');
}

export async function handleFunctionResponse(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const body = getJsonBody(response);
	const statusCode = typeof response.statusCode === 'number' ? response.statusCode : 200;

	if (isConvexEnvelope(body) && body.status === 'error') {
		throw new NodeApiError(this.getNode(), {}, getSafeConvexError(body));
	}

	if (statusCode < 200 || statusCode >= 300) {
		const safeError = getSafeConvexError(isDataObject(body) ? body : {});
		throw new NodeApiError(
			this.getNode(),
			{},
			{ ...safeError, httpCode: String(statusCode) },
		);
	}

	if (!isConvexEnvelope(body)) {
		throw createSafeOperationError(
			this,
			'Convex function response was not a Convex response envelope',
			'Expected a JSON object with a status of "success" or "error"',
		);
	}

	return [{ json: normalizeJsonOutput(body) }];
}

export async function prepareHttpActionRequest(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const credentials = await this.getCredentials<{ httpActionsUrl?: unknown }>('convexApi');
	if (typeof credentials.httpActionsUrl !== 'string' || credentials.httpActionsUrl.trim() === '') {
		throw createSafeOperationError(this, 'HTTP Actions URL is required');
	}

	return runValidation(this, () => {
		const baseUrl = normalizeBaseUrl(credentials.httpActionsUrl, 'HTTP Actions URL');
		const method = String(this.getNodeParameter('method'));
		if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
			throw new Error('HTTP Action method is not supported');
		}
		const headers = validateCustomHeaderValues(
			validateHeaders(this.getNodeParameter('headers'), { allowEmpty: true }),
		);

		requestOptions.method = method as IHttpRequestOptions['method'];
		requestOptions.url = resolveActionUrl(baseUrl, String(this.getNodeParameter('path')));
		requestOptions.qs = parseJsonObject(
			this.getNodeParameter('queryParameters'),
			'Query Parameters',
			{ allowEmpty: true },
		);
		requestOptions.headers = {
			...headers,
			Accept: 'application/json',
			'Content-Type': 'application/json',
		};
		if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
			requestOptions.body = parseHttpActionBody(this);
		} else {
			delete requestOptions.body;
		}
		requestOptions.disableFollowRedirect = true;
		// Let handleHttpActionResponse reject non-success statuses with a node-aware error.
		requestOptions.ignoreHttpStatusErrors = true;
		return requestOptions;
	});
}

export async function handleHttpActionResponse(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw createSafeOperationError(
			this,
			'HTTP Action request failed',
			`HTTP Action returned a non-success status (${response.statusCode})`,
		);
	}
	if (!hasJsonContentType(response.headers)) {
		throw createSafeOperationError(this, 'HTTP Action response must be JSON');
	}

	const body = getJsonBody(response);
	if (body === undefined) {
		throw createSafeOperationError(this, 'HTTP Action response was not valid JSON');
	}
	return [{ json: normalizeJsonOutput(body) }];
}
