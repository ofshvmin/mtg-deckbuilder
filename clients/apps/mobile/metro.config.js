const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
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

// react-native-css-interop (NativeWind's runtime, incl. its jsx-runtime) is nested under
// nativewind/node_modules in this workspace and isn't resolvable from every importer.
// Map the bare name to its real location (resolved via nativewind, so this also works if
// it's ever hoisted) so NativeWind's JSX transform resolves everywhere.
const nativewindDir = path.dirname(require.resolve("nativewind/package.json"));
const cssInteropDir = path.dirname(
  require.resolve("react-native-css-interop/package.json", { paths: [nativewindDir] })
);
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "react-native-css-interop": cssInteropDir,
};

// Wire NativeWind's CSS pipeline (processes global.css / Tailwind for web + native).
module.exports = withNativeWind(config, { input: "./global.css" });
