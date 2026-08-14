import type { IDataObject } from 'n8n-workflow';

import type { SafeConvexError } from './types';

/* eslint-disable @n8n/community-nodes/require-node-api-error -- Pure validation helpers lack a node execution context; the transports rewrite these errors into NodeOperationError. */

const reservedHeaderNames = new Set([
	'accept',
	'authorization',
	'host',
	'content-length',
	'transfer-encoding',
	'content-type',
]);

const redactedValue = '[REDACTED]';
const sensitiveKeyNames = new Set([
	'accesstoken',
	'apikey',
	'authorization',
	'bearer',
	'body',
	'cookie',
	'cookies',
	'credential',
	'credentials',
	'header',
	'headers',
	'password',
	'requestconfig',
	'requestoptions',
	'secret',
	'token',
]);
const sensitiveKeyPatterns = [
	/token$/,
	/apikey$/,
	/^apikey/,
	/secret$/,
	/^secret/,
	/password$/,
	/^password/,
	/credentials?$/,
	/cookies?$/,
];
const maxErrorContextDepth = 10;

export function isDataObject(value: unknown): value is IDataObject {
	return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function isSensitiveErrorKey(key: string): boolean {
	const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');
	return (
		sensitiveKeyNames.has(normalizedKey) ||
		sensitiveKeyPatterns.some((pattern) => pattern.test(normalizedKey))
	);
}

function sanitizeErrorString(value: string): string {
	return value
		.replace(/Bearer\s+[^\s,;]+/gi, `Bearer ${redactedValue}`)
		.replace(
			/\b(authorization|bearer|token|access[-_\s]?token|api[-_\s]?key|secret|password|credential|cookie)\b\s*([:=])\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
			(_match, key: string, separator: string) => `${key}${separator}${redactedValue}`,
		)
		.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, redactedValue);
}

function sanitizeErrorContext(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
	if (typeof value === 'string') return sanitizeErrorString(value);
	if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
	if (depth >= maxErrorContextDepth) return '[TRUNCATED]';
	if (typeof value !== 'object') return '[UNSERIALIZABLE]';
	if (seen.has(value)) return '[CIRCULAR]';
	seen.add(value);

	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeErrorContext(entry, depth + 1, seen));
	}

	let keys: string[];
	try {
		keys = Object.keys(value);
	} catch {
		return '[UNSERIALIZABLE]';
	}

	const sanitized: Record<string, unknown> = {};
	for (const key of keys) {
		if (isSensitiveErrorKey(key)) {
			sanitized[key] = redactedValue;
			continue;
		}
		try {
			sanitized[key] = sanitizeErrorContext((value as Record<string, unknown>)[key], depth + 1, seen);
		} catch {
			sanitized[key] = '[UNSERIALIZABLE]';
		}
	}
	return sanitized;
}

export interface ParseJsonObjectOptions {
	/** Treat empty, whitespace-only, undefined, and null input as an empty object. */
	allowEmpty?: boolean;
}

function isEmptyJsonInput(value: unknown): boolean {
	return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

export function parseJsonObject(
	value: unknown,
	fieldName: string,
	options: ParseJsonObjectOptions = {},
): IDataObject {
	if (options.allowEmpty === true && isEmptyJsonInput(value)) {
		return {};
	}

	let parsed = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new Error(`${fieldName} must be a JSON object`);
		}
	}
	if (!isDataObject(parsed)) {
		throw new Error(`${fieldName} must be a JSON object`);
	}
	return parsed;
}

export function normalizeBaseUrl(value: unknown, fieldName: string): string {
	if (typeof value !== 'string') {
		throw new Error(`${fieldName} must be an HTTP(S) URL`);
	}

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${fieldName} must be an HTTP(S) URL`);
	}

	if (
		(url.protocol !== 'http:' && url.protocol !== 'https:') ||
		url.username !== '' ||
		url.password !== '' ||
		url.search !== '' ||
		url.hash !== '' ||
		value.includes('?') ||
		value.includes('#')
	) {
		throw new Error(`${fieldName} must be an HTTP(S) URL without credentials, query, or hash`);
	}

	return url.toString().replace(/\/+$/, '');
}

export function resolveActionUrl(baseUrl: string, path: string): string {
	const base = new URL(normalizeBaseUrl(baseUrl, 'HTTP Actions URL'));
	if (
		typeof path !== 'string' ||
		!path.startsWith('/') ||
		path.startsWith('//') ||
		path.includes('\\') ||
		path.includes('?') ||
		path.includes('#')
	) {
		throw new Error(
			'Path must be an absolute path on the configured HTTP Actions origin without query or hash',
		);
	}

	let decoded = path;
	for (let index = 0; index < 2; index += 1) {
		try {
			decoded = decodeURIComponent(decoded);
		} catch {
			throw new Error('Path must be a valid percent-encoded absolute path');
		}
		if (
			decoded.includes('\\') ||
			decoded.split(/[\\/]/).some((segment) => segment === '.' || segment === '..')
		) {
			throw new Error('Path cannot contain traversal segments');
		}
	}

	const resolved = new URL(path, `${base.origin}/`);
	if (resolved.origin !== base.origin || resolved.search !== '' || resolved.hash !== '') {
		throw new Error('Path must remain on the configured origin');
	}
	return resolved.toString();
}

export function validateHeaders(value: unknown, options: ParseJsonObjectOptions = {}): IDataObject {
	const headers = parseJsonObject(value, 'Headers', options);
	for (const name of Object.keys(headers)) {
		if (reservedHeaderNames.has(name.toLowerCase())) {
			throw new Error(`Header ${name} cannot be overridden`);
		}
	}
	return headers;
}

export function normalizeJsonOutput(value: unknown): IDataObject {
	return isDataObject(value) ? value : { data: value as never };
}

export function assertTeamId(expected: unknown, actual: unknown): void {
	// Convex returns numeric team IDs while the credential stores a string, so compare both as text.
	const normalizeTeamId = (value: unknown): string => {
		if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
		return typeof value === 'string' ? value.trim() : '';
	};

	const expectedTeamId = normalizeTeamId(expected);
	if (expectedTeamId === '') {
		throw new Error('Team ID is missing from the Convex Team API credential');
	}

	const actualTeamId = normalizeTeamId(actual);
	if (actualTeamId === '') {
		throw new Error('Convex did not return a team ID for this Team Access Token');
	}

	if (expectedTeamId !== actualTeamId) {
		throw new Error('Team Access Token belongs to a different team');
	}
}

export function getSafeConvexError(body: unknown): SafeConvexError {
	if (!isDataObject(body)) {
		return { message: 'Convex request failed' };
	}

	const message =
		typeof body.errorMessage === 'string'
			? sanitizeErrorString(body.errorMessage)
			: 'Convex request failed';
	const descriptionParts: string[] = [];
	if (body.errorData !== undefined) {
		try {
			const serializedErrorData = JSON.stringify(sanitizeErrorContext(body.errorData));
			if (serializedErrorData !== undefined) {
				descriptionParts.push(serializedErrorData);
			}
		} catch {
			// Omit non-serializable error data rather than exposing the whole response body.
		}
	}
	if (Array.isArray(body.logLines)) {
		descriptionParts.push(
			...body.logLines
				.filter((line): line is string => typeof line === 'string')
				.map((line) => sanitizeErrorString(line)),
		);
	}

	return descriptionParts.length > 0
		? { message, description: descriptionParts.join('\n') }
		: { message };
}
