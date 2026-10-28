/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Le serveur garde la clé AethexAI : on n'expose aucune variable d'environnement au navigateur.
  poweredByHeader: false,
};

export default nextConfig;
