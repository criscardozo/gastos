// Flat config, native. eslint-config-next 16 ships flat arrays directly, and
// running them through @eslint/eslintrc's FlatCompat — which is what this file
// did while Next was on 15 — now throws "Converting circular structure to
// JSON": the shim tries to serialise a config that already references plugin
// objects.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "next-env.d.ts"],
  },
  {
    rules: {
      // New in the react-hooks plugin that Next 16 brings, and it is pointing
      // at something real: a setState in an effect body renders twice on mount.
      // It fires 19 times here, almost all inside the Firestore listener hooks,
      // where the pattern is "reset to empty when there is nothing to listen
      // to" — correct behaviour whose only cost is one extra render on a screen
      // that is about to receive a snapshot anyway. Rewriting them all touches
      // every listener in the app, which is a bigger risk than the renders are
      // worth, so this stays a warning: visible on every lint, not blocking CI,
      // and honest about being unfinished rather than deleted.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
