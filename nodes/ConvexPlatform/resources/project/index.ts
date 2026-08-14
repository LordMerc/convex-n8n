import type { INodeProperties } from 'n8n-workflow';

import { extractProjects, paginateProjects, preparePlatformRequest } from '../../transport';

const showOnlyForProjects = {
	resource: ['project'],
};

const showWhenNotReturningAll = {
	resource: ['project'],
	returnAll: [false],
};

export const projectDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showOnlyForProjects },
		options: [
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many projects',
				description: 'Get projects for the configured team',
				routing: {
					request: {
						method: 'GET',
						url: '/teams/{{$credentials.teamId}}/projects',
						qs: { limit: '={{$parameter.returnAll ? undefined : $parameter.limit}}' },
					},
					operations: {
						pagination: paginateProjects,
					},
					send: { paginate: '={{$parameter.returnAll}}', preSend: [preparePlatformRequest] },
					output: {
						maxResults: '={{$parameter.returnAll ? undefined : $parameter.limit}}',
						postReceive: [extractProjects],
					},
				},
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: showOnlyForProjects },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: 100 },
		displayOptions: { show: showWhenNotReturningAll },
		description: 'Max number of results to return',
	},
];
