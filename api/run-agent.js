import { kv } from '@vercel/kv';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Pusher from 'pusher';

// Inicializa os clientes com as variáveis de ambiente
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

const WORKANA_URL = 'https://www.workana.com/jobs?category=it-programming&has_few_bids=1&language=pt&publication=1d';
const BASE_URL = "https://www.workana.com";

// A função principal que a Vercel irá executar
export default async function handler(request, response) {
    console.log("Iniciando o agente de busca de projetos...");

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const chat = model.startChat();
    
    let newProjectsFound = 0;

    try {
        const { data: html } = await axios.get(WORKANA_URL, { 
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        
        // Extrai o JSON embutido no HTML
        const jsonString = html.match(/:results-initials="({[^"]+})"/);
        if (!jsonString || !jsonString[1]) {
            return response.status(200).json({ message: "Não foi possível encontrar dados de projetos." });
        }
        
        const projectsData = JSON.parse(jsonString[1].replace(/&quot;/g, '"'));
        const projects = projectsData.results || [];
        
        if (projects.length === 0) {
            return response.status(200).json({ message: "Nenhum projeto encontrado na busca." });
        }

        for (const project of projects) {
            const slug = project.slug;

            // Verifica no Vercel KV se o projeto já foi processado
            const isProcessed = await kv.sismember('processed_slugs', slug);
            if (isProcessed) {
                continue;
            }

            console.log(`Analisando novo projeto: ${project.title}`);
            newProjectsFound++;

            const cleanDescription = project.description.replace(/<[^>]*>/g, '');
            const prompt = `...seu prompt para o Gemini aqui...`; // Mantenha seu prompt original

            const result = await chat.sendMessage(prompt);
            const responseText = result.response.text();

            if (responseText.trim().toUpperCase() !== 'IRRELEVANTE') {
                const jsonMatch = responseText.match(/{[\s\S]*}/);
                if (jsonMatch) {
                    const analysis = JSON.parse(jsonMatch[0]);
                    const projectDetails = {
                        title: project.title,
                        slug: slug,
                        url: BASE_URL + project.url,
                        budget: project.budget,
                        publishedDate: project.publishedDate,
                        totalBids: project.totalBids,
                        summary: analysis.summary,
                        proposal: analysis.proposal,
                        processedAt: new Date().toISOString()
                    };

                    // Salva no KV e notifica via Pusher
                    await kv.sadd('processed_slugs', slug);
                    await kv.lpush('projects_log', JSON.stringify(projectDetails));
                    await pusher.trigger('projects-channel', 'new-project', projectDetails);
                    
                    console.log(`Projeto relevante salvo e notificado: ${project.title}`);
                }
            } else {
                 await kv.sadd('processed_slugs', slug); // Marca como processado mesmo se irrelevante
            }
        }
        
        return response.status(200).json({ message: `Agente executado. ${newProjectsFound} novos projetos analisados.` });

    } catch (error) {
        console.error("Erro no agente:", error);
        return response.status(500).json({ error: error.message });
    }
}
