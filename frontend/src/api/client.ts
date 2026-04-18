import axios from 'axios';

// Siempre usa la URL relativa — el proxy de Vite (dev) o el servidor
// estático (prod) reenvían /api al backend sin necesidad de CORS.
const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const apiKey = localStorage.getItem('jacox_api_key') || 'sk-dev-key-123';
  
  if (apiKey) {
    config.headers = config.headers || {};
    config.headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return config;
});

api.interceptors.response.use(
    (response) => {
        return response;
    },
    async (error) => {
        if (!error.response) {
            console.error('Network Error / Backend Unreachable');
        } else if (error.response.status >= 500) {
            console.error('Backend Server Error:', error.response.status);
        }
        return Promise.reject(error);
    }
);

export default api;
