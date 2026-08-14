import type { IAuthenticate, ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class ConvexTeamApi implements ICredentialType {
	name = 'convexTeamApi';

	displayName = 'Convex Team API';

	icon: Icon = { light: 'file:../icons/convex.svg', dark: 'file:../icons/convex.dark.svg' };

	documentationUrl = 'https://docs.convex.dev/platform-apis/overview/';

	properties: INodeProperties[] = [
		{
			displayName: 'Team ID',
			name: 'teamId',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Team Access Token',
			name: 'teamAccessToken',
			type: 'string',
			default: '',
			required: true,
			typeOptions: { password: true },
		},
	];

	authenticate: IAuthenticate = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.teamAccessToken}}',
			},
		},
	};

	// The team scope of the token cannot be checked declaratively: credential test rules compare
	// literal values and never resolve `$credentials`. The Convex Platform node runs the check in
	// its `convexPlatform` credential test function instead.
}
