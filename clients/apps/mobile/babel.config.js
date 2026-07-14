// Required for NativeWind v4: babel-preset-expo with `jsxImportSource: "nativewind"`
// plus the nativewind/babel preset is what transforms `className` props into styles.
// Without this, className is inert and every screen renders unstyled.
//
// In this workspace, dependencies are heavily nested rather than hoisted (expo lives at
// apps/mobile/node_modules/expo, with babel-preset-expo under it), and Babel resolves
// presets from clients/node_modules/@babel/core — where those names don't resolve. So we
// resolve the preset paths explicitly relative to where the packages actually live.
const path = require("path");
const expoDir = path.dirname(require.resolve("expo/package.json"));
const babelPresetExpo = require.resolve("babel-preset-expo", { paths: [expoDir] });
const nativewindBabel = require.resolve("nativewind/babel");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [babelPresetExpo, { jsxImportSource: "nativewind" }],
      nativewindBabel,
    ],
  };
};
