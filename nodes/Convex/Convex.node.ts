import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';

import { functionDescription } from './resources/function';
import { httpActionDescription } from './resources/httpAction';

export class Convex implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Convex',
		name: 'convex',
		icon: { light: 'file:../../icons/convex.svg', dark: 'file:../../icons/convex.dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'Run Convex functions and JSON HTTP Actions',
		defaults: { name: 'Convex' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'convexApi', required: true }],
		requestDefaults: {
			baseURL: '={{$credentials.deploymentUrl}}',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Function', value: 'function' },
					{ name: 'HTTP Action', value: 'httpAction' },
				],
				default: 'function',
			},
			...functionDescription,
			...httpActionDescription,
		],
	};
}
