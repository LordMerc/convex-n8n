import type { INodeProperties } from 'n8n-workflow';

import { handleTokenDetails, preparePlatformRequest } from '../../transport';

const showOnlyForToken = {
	resource: ['token'],
};

export const tokenDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showOnlyForToken },
		options: [
			{
				name: 'Get Details',
				value: 'getDetails',
				action: 'Get token details',
				description: 'Get the current Team Access Token details',
				routing: {
					request: { method: 'GET', url: '/token_details' },
					send: { preSend: [preparePlatformRequest] },
					output: { postReceive: [handleTokenDetails] },
				},
			},
		],
		default: 'getDetails',
	},
];
