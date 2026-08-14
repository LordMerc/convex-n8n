const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('required documentation and automation files exist', () => {
	for (const file of [
		'AGENTS.md',
		'README.md',
		'LICENSE.md',
		'CODE_OF_CONDUCT.md',
		'CONTRIBUTING.md',
		'CHANGELOG.md',
		'.github/workflows/ci.yml',
		'.github/workflows/publish.yml',
	]) {
		assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);
	}
});

test('package metadata is publishable and registers both nodes and credentials', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

	assert.equal(pkg.name, '@lordmerc/n8n-nodes-convex');
	assert.equal(pkg.version, '0.1.0');
	assert.equal(pkg.license, 'MIT');
	assert.equal(pkg.author.email, 'lordmercrbx@gmail.com');
	assert.equal(pkg.engines.node, '>=20.19');
	assert.deepEqual(pkg.keywords, ['n8n-community-node-package']);
	assert.equal(pkg.n8n.n8nNodesApiVersion, 1);
	assert.equal(pkg.n8n.strict, true);
	assert.deepEqual(pkg.n8n.credentials.sort(), [
		'dist/credentials/ConvexApi.credentials.js',
		'dist/credentials/ConvexTeamApi.credentials.js',
	]);
	assert.deepEqual(pkg.n8n.nodes.sort(), [
		'dist/nodes/Convex/Convex.node.js',
		'dist/nodes/ConvexPlatform/ConvexPlatform.node.js',
	]);
	assert.equal(pkg.dependencies, undefined);
	assert.equal(pkg.peerDependencies['n8n-workflow'], '*');
	assert.equal(pkg.publishConfig.access, 'public');
	assert.equal(pkg.publishConfig.provenance, true);
	assert.deepEqual(pkg.repository, {
		type: 'git',
		url: 'git+https://github.com/LordMerc/convex-n8n.git',
	});
	assert.equal(pkg.homepage, 'https://github.com/LordMerc/convex-n8n#readme');
});
