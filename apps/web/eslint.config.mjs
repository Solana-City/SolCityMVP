import coreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...coreWebVitals,
  {
    // Same lint signal as the Next 14 setup (`next/core-web-vitals`).
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "@next/next/no-img-element": "off",
      // eslint-plugin-react-hooks v7 (pulled in by eslint-config-next 16) adds
      // rules written for the React Compiler, which this app does not use. They
      // flag ~115 existing effects/refs in the game UI that work as intended;
      // rewriting them is a refactor of its own, not part of the Next upgrade.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/static-components": "off",
    },
  },
];

export default config;
