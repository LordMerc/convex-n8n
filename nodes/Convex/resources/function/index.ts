import type { INodeProperties } from 'n8n-workflow';

import { handleFunctionResponse, prepareFunctionRequest } from '../../transport';

const showOnlyForFunctions = {
	resource: ['function'],
};

const showFunctionParameters = {
	resource: ['function'],
	operation: ['runQuery', 'runMutation', 'runAction'],
};

export const functionDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForFunctions,
		},
		options: [
			{
				name: 'Run Query',
				value: 'runQuery',
				action: 'Run a query',
				description: 'Run a Convex query function',
				routing: {
					request: { method: 'POST', url: '/api/query' },
					send: { preSend: [prepareFunctionRequest] },
					output: { postReceive: [handleFunctionResponse] },
				},
			},
			{
				name: 'Run Mutation',
				value: 'runMutation',
				action: 'Run a mutation',
				description: 'Run a Convex mutation function',
				routing: {
					request: { method: 'POST', url: '/api/mutation' },
					send: { preSend: [prepareFunctionRequest] },
					output: { postReceive: [handleFunctionResponse] },
				},
			},
			{
				name: 'Run Action',
				value: 'runAction',
				action: 'Run an action',
				description: 'Run a Convex action function',
				routing: {
					request: { method: 'POST', url: '/api/action' },
					send: { preSend: [prepareFunctionRequest] },
					output: { postReceive: [handleFunctionResponse] },
				},
			},
		],
		default: 'runQuery',
	},
	{
		displayName: 'Function Path',
		name: 'functionPath',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: showFunctionParameters },
		description: 'Path of the Convex function to run',
	},
	{
		displayName: 'Arguments',
		name: 'arguments',
		type: 'json',
		default: '{}',
		required: true,
		displayOptions: { show: showFunctionParameters },
		description: 'JSON object passed as the function arguments',
	},
];
