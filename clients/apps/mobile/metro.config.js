const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// Monorepo root: clients/
const workspaceRoot = path.resolve(__dirname, "../..");
// Project root: clients/apps/mobile
const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Watch the workspace root so Metro finds @mtg/shared (packages/shared)
config.watchFolders = [workspaceRoot];

// Let Metro resolve from both the project's and workspace's node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
