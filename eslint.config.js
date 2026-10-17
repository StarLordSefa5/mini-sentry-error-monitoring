import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/generated/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: { globals: globals.node } },
  { files: ["examples/minified/src/**/*.js"], languageOptions: { globals: globals.browser } },
  {
    files: ["apps/dashboard/src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
