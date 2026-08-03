/** @type {import("prettier").Config} */
const config = {
  printWidth: 100,
  tabWidth: 2,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  endOfLine: "lf",
  plugins: ["prettier-plugin-tailwindcss"],
  // Tailwind v4 : le tri des classes se base sur la feuille de style, pas sur un
  // fichier de configuration JS.
  tailwindStylesheet: "./src/app/globals.css",
};

export default config;
