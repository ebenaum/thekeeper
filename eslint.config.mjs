import js from "@eslint/js";
import globals from "globals";
import jsdoc from "eslint-plugin-jsdoc";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { jsdoc },
    extends: ["jsdoc/recommended"],
    rules: {
      "jsdoc/require-param-description": "off",
      "jsdoc/require-property-description": "off",
      "jsdoc/require-returns-description": "off",
      "jsdoc/require-jsdoc": "off",
      "jsdoc/tag-lines": "off",
      "jsdoc/no-undefined-types": [
        "warn",
        {
          definedTypes: ["NodeListOf"],
        },
      ],
      "jsdoc/reject-any-type": "warn",
    },
  },
]);
