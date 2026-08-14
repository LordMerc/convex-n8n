import type { INodeProperties } from 'n8n-workflow';

import { handleHttpActionResponse, prepareHttpActionRequest } from '../../transport';

const showOnlyForHttpActions = {
	resource: ['httpAction'],
};

const showHttpActionBody = {
	resource: ['httpAction'],
	method: ['POST', 'PUT', 'PATCH'],
};

export const httpActionDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showOnlyForHttpActions },
		options: [
			{
				name: 'Request',
				value: 'request',
				action: 'Make an HTTP action request',
				description: 'Make a JSON request to a configured Convex HTTP Action',
				routing: {
					send: { preSend: [prepareHttpActionRequest] },
					output: { postReceive: [handleHttpActionResponse] },
				},
			},
		],
		default: 'request',
	},
	{
		displayName: 'Method',
		name: 'method',
		type: 'options',
		displayOptions: { show: showOnlyForHttpActions },
		options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({ name: method, value: method })),
		default: 'GET',
	},
	{
		displayName: 'Path',
		name: 'path',
		type: 'string',
		default: '/',
		required: true,
		placeholder: '/hooks/example',
		displayOptions: { show: showOnlyForHttpActions },
		description: 'Absolute path on the configured HTTP Actions origin',
	},
	{
		displayName: 'Query Parameters',
		name: 'queryParameters',
		type: 'json',
		default: '{}',
		displayOptions: { show: showOnlyForHttpActions },
		description: 'JSON object of query parameters',
	},
	{
		displayName: 'Headers',
		name: 'headers',
		type: 'json',
		default: '{}',
		displayOptions: { show: showOnlyForHttpActions },
		description: 'JSON object of additional request headers',
	},
	{
		displayName: 'Body',
		name: 'body',
		type: 'json',
		default: '{}',
		displayOptions: { show: showHttpActionBody },
		description: 'JSON object sent as the request body',
	},
];
