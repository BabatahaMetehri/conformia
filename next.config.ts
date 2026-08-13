/**
 * L'import qui suit n'est pas décoratif : il force la validation des variables
 * d'environnement AVANT que Next ne commence à construire quoi que ce soit.
 * Une variable manquante fait donc échouer `npm run build` et `npm run dev`
 * immédiatement, en la nommant, plutôt qu'au premier accès en production.
 */
import "./src/config/env";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
};

export default nextConfig;
