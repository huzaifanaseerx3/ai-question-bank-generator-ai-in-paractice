const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const defaultApiUrl = import.meta.env.PROD
  ? 'https://ai-question-bank-generator-ai-in.onrender.com'
  : 'http://localhost:3001';

export const API_URL = (configuredApiUrl || defaultApiUrl).replace(/\/+$/, '');
