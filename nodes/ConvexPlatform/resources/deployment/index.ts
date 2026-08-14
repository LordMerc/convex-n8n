import type { INodeProperties } from 'n8n-workflow';

import { extractDeployments, preparePlatformRequest } from '../../transport';

const showOnlyForDeployments = {
	resource: ['deployment'],
};

const showDeploymentGet = {
	resource: ['deployment'],
	operation: ['get'],
};

const showDeploymentReference = {
	resource: ['deployment'],
	operation: ['get'],
	lookupMode: ['reference'],
};

export const deploymentDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showOnlyForDeployments },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get a deployment',
				description: 'Get a deployment by reference or default environment',
				routing: {
					request: {
						method: 'GET',
						url: '/projects/{{$parameter.projectId}}/deployment',
						qs: {
							reference: '={{$parameter.lookupMode === "reference" ? $parameter.reference : undefined}}',
							defaultProd: '={{$parameter.lookupMode === "defaultProd" ? true : undefined}}',
							defaultDev: '={{$parameter.lookupMode === "defaultDev" ? true : undefined}}',
						},
					},
					send: { preSend: [preparePlatformRequest] },
					output: { postReceive: [extractDeployments] },
				},
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many deployments',
				description: 'Get deployments for a project',
				routing: {
					request: { method: 'GET', url: '/projects/{{$parameter.projectId}}/list_deployments' },
					send: { preSend: [preparePlatformRequest] },
					output: { postReceive: [extractDeployments] },
				},
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Project ID',
		name: 'projectId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: showOnlyForDeployments },
		description: 'ID of the Convex project',
	},
	{
		displayName: 'Lookup Mode',
		name: 'lookupMode',
		type: 'options',
		default: 'reference',
		displayOptions: { show: showDeploymentGet },
		options: [
			{ name: 'Reference', value: 'reference' },
			{ name: 'Default Production', value: 'defaultProd' },
			{ name: 'Default Development', value: 'defaultDev' },
		],
		description: 'How to select the deployment',
	},
	{
		displayName: 'Reference',
		name: 'reference',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: showDeploymentReference },
		description: 'Deployment reference',
	},
];
