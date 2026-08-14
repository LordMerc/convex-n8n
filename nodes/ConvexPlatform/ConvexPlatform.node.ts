import {
	NodeConnectionTypes,
	type ICredentialTestFunctions,
	type ICredentialsDecrypted,
	type IDataObject,
	type INodeCredentialTestResult,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

import { assertTeamId, isDataObject } from '../shared/convexUtils';
import { deploymentDescription } from './resources/deployment';
import { projectDescription } from './resources/project';
import { tokenDescription } from './resources/token';

const tokenDetailsUrl = 'https://api.convex.dev/v1/token_details';

function getCredentialString(data: IDataObject, name: string): string {
	const value = data[name];
	return typeof value === 'string' ? value.trim() : '';
}

/** Reads a status code from a request helper failure without touching the response body. */
function getErrorStatusCode(error: unknown): number | undefined {
	if (!isDataObject(error)) return undefined;
	if (typeof error.statusCode === 'number') return error.statusCode;
	const response = error.response;
	return isDataObject(response) && typeof response.status === 'number' ? response.status : undefined;
}

function parseTokenDetails(body: unknown): IDataObject | undefined {
	if (isDataObject(body)) return body;
	if (typeof body !== 'string') return undefined;
	try {
		const parsed: unknown = JSON.parse(body);
		return isDataObject(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export class ConvexPlatform implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Convex Platform',
		name: 'convexPlatform',
		icon: { light: 'file:../../icons/convex.svg', dark: 'file:../../icons/convex.dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Discover Convex Platform resources',
		defaults: { name: 'Convex Platform' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'convexTeamApi', required: true, testedBy: 'convexPlatform' }],
		requestDefaults: {
			baseURL: 'https://api.convex.dev/v1',
			headers: { Accept: 'application/json' },
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Deployment', value: 'deployment' },
					{ name: 'Project', value: 'project' },
					{ name: 'Token', value: 'token' },
				],
				default: 'deployment',
			},
			...deploymentDescription,
			...projectDescription,
			...tokenDescription,
		],
	};

	methods = {
		credentialTest: {
			/**
			 * Confirms the Team Access Token is accepted by the Convex Platform API and is scoped to
			 * the configured team. Failures stay generic so no token or response content is echoed.
			 */
			async convexPlatform(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const data = credential.data ?? {};
				const teamId = getCredentialString(data, 'teamId');
				const teamAccessToken = getCredentialString(data, 'teamAccessToken');
				if (teamId === '') return { status: 'Error', message: 'Team ID is required' };
				if (teamAccessToken === '') {
					return { status: 'Error', message: 'Team Access Token is required' };
				}

				let body: unknown;
				try {
					// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions -- Credential test contexts only expose `helpers.request`.
					body = await this.helpers.request({
						method: 'GET',
						url: tokenDetailsUrl,
						headers: {
							Accept: 'application/json',
							Authorization: `Bearer ${teamAccessToken}`,
						},
						json: true,
						followRedirect: false,
					});
				} catch (error) {
					const statusCode = getErrorStatusCode(error);
					return {
						status: 'Error',
						message:
							statusCode === undefined
								? 'Could not reach the Convex Platform API'
								: `Convex Platform API returned HTTP ${statusCode}`,
					};
				}

				const details = parseTokenDetails(body);
				if (details === undefined) {
					return {
						status: 'Error',
						message: 'Convex returned an unexpected token details response',
					};
				}

				try {
					assertTeamId(teamId, details.teamId);
				} catch (error) {
					return {
						status: 'Error',
						message:
							error instanceof Error
								? error.message
								: 'Team Access Token could not be verified',
					};
				}

				return { status: 'OK', message: 'Connection tested successfully' };
			},
		},
	};
}
