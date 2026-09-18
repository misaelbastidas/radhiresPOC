export default {
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { target: 'es2022' }
};
