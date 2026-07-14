/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "./App.tsx",
    "./index.ts",
  ],
  presets: [require("nativewind/preset")],
  // Class-based dark mode: the app hardcodes its dark palette (no `dark:` variants), and
  // NativeWind's web runtime throws if it tries to set the scheme under the default 'media'.
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [],
};
