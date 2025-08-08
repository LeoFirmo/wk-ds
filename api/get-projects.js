import { kv } from '@vercel/kv';

export default async function handler(request, response) {
  try {
    // Busca os últimos 50 projetos do log no KV
    const projectStrings = await kv.lrange('projects_log', 0, 50);
    const projects = projectStrings.map(p => JSON.parse(p));
    return response.status(200).json(projects);
  } catch (error) {
    console.error('Erro ao buscar projetos:', error);
    return response.status(500).json({ error: 'Falha ao buscar dados.' });
  }
}
