import type {
	IAuthenticate,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class ConvexApi implements ICredentialType {
	name = 'convexApi';

	displayName = 'Convex API';

	icon: Icon = { light: 'file:../icons/convex.svg', dark: 'file:../icons/convex.dark.svg' };

	documentationUrl = 'https://docs.convex.dev/http-api/';

	properties: INodeProperties[] = [
		{
			displayName: 'Deployment URL',
			name: 'deploymentUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://example.convex.cloud',
		},
		{
			displayName: 'HTTP Actions URL',
			name: 'httpActionsUrl',
			type: 'string',
			default: '',
			placeholder: 'https://example.convex.site',
		},
		{
			displayName: 'Bearer Token',
			name: 'bearerToken',
			type: 'string',
			default: '',
			typeOptions: { password: true },
		},
	];

	authenticate: IAuthenticate = async (credentials, requestOptions) => {
		const token = String(credentials.bearerToken ?? '').trim();
		if (!token) return requestOptions;
		return {
			...requestOptions,
			headers: { ...requestOptions.headers, Authorization: `Bearer ${token}` },
		};
	};

	/**
	 * Queries a function path that no deployment is expected to define. Convex answers a well-formed
	 * request for a missing function with HTTP 200 and a `{"status":"error"}` envelope, so the test
	 * passes for every reachable deployment without depending on deployed functions, while a wrong
	 * URL (404) or a rejected Bearer Token (401) still fails.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.deploymentUrl}}',
			url: '/api/query',
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: { path: 'n8nCredentialTest:probe', args: {}, format: 'json' },
			disableFollowRedirect: true,
		},
		rules: [
			{
				type: 'responseCode',
				properties: { value: 401, message: 'Convex rejected the Bearer Token' },
			},
			{
				type: 'responseCode',
				properties: { value: 404, message: 'Deployment URL is not a Convex deployment' },
			},
		],
	};
}
