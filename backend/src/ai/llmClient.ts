import axios, { AxiosInstance, AxiosError } from 'axios';

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: boolean;
  context?: number[];
  temperature?: number;
  top_k?: number;
  top_p?: number;
}

interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
}

interface OllamaEmbeddingRequest {
  model: string;
  prompt: string;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * Local LLM Client using Ollama
 * Handles communication with local Ollama instances for:
 * - Natural language query understanding
 * - Prompt generation
 * - Semantic embeddings
 * 
 * All processing happens locally - no data sent to external services
 */
class LLMClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private model: string;
  private embeddingModel: string;
  private timeout: number;

  constructor(
    baseUrl: string = process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: string = process.env.OLLAMA_MODEL || 'llama2',
    embeddingModel: string = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
    timeout: number = 30000
  ) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.embeddingModel = embeddingModel;
    this.timeout = timeout;

    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Check if Ollama service is available
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/tags', { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * List available models
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.client.get('/api/tags');
      return response.data.models?.map((m: any) => m.name) || [];
    } catch (error) {
      console.error('Error fetching available models:', error);
      return [];
    }
  }

  /**
   * Generate text using local Ollama model
   * Used for understanding user queries and generating SQL context
   */
  async generate(
    prompt: string,
    options?: {
      temperature?: number;
      topK?: number;
      topP?: number;
      maxTokens?: number;
    }
  ): Promise<string> {
    try {
      const request: OllamaGenerateRequest = {
        model: this.model,
        prompt: prompt,
        stream: false,
        temperature: options?.temperature || 0.7,
        top_k: options?.topK || 40,
        top_p: options?.topP || 0.9,
      };

      const response = await this.client.post<OllamaGenerateResponse>(
        '/api/generate',
        request
      );

      if (!response.data.done) {
        console.warn('Ollama response incomplete');
      }

      return response.data.response.trim();
    } catch (error) {
      this.handleError('generate', error);
      throw error;
    }
  }

async chat(
messages: { role: "system" | "user" | "assistant"; content: string }[],
options?: { temperature?: number }
): Promise<string> {
try {
const response = await this.client.post("/api/chat", {
model: this.model,
messages,
stream: false,
options: {
temperature: options?.temperature ?? 0.7,
},
});
return response.data.message.content.trim();

} catch (error) {
this.handleError("chat", error);
throw error;
}
}



  /**
   * Generate embeddings for semantic search
   * Used for understanding query intent and finding similar queries
   */
  async embed(text: string): Promise<number[]> {
    try {
      const request: OllamaEmbeddingRequest = {
        model: this.embeddingModel,
        prompt: text,
      };

      const response = await this.client.post<OllamaEmbeddingResponse>(
        '/api/embeddings',
        request
      );

      return response.data.embedding;
    } catch (error) {
      this.handleError('embed', error);
      throw error;
    }
  }

  /**
   * Batch embedding generation
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const embeddings = await Promise.all(
        texts.map(text => this.embed(text))
      );
      return embeddings;
    } catch (error) {
      this.handleError('embedBatch', error);
      throw error;
    }
  }

  /**
   * Extract structured information from unstructured text
   * Used to parse user intent and extract parameters
   */
  async extractStructure(
    text: string,
    format: string
  ): Promise<Record<string, any>> {
    const extractionPrompt = `Extract structured information from the following text and return as JSON.
Format: ${format}
Text: "${text}"

Return ONLY valid JSON without markdown formatting.`;

    try {
      const response = await this.generate(extractionPrompt, {
        temperature: 0.2, // Lower temperature for more consistent extraction
      });

      return JSON.parse(response);
    } catch (error) {
      console.error('Error extracting structure:', error);
      return {};
    }
  }

  /**
   * Classify text into predefined categories
   * Used to categorize user queries
   */
  async classify(
    text: string,
    categories: string[]
  ): Promise<{ category: string; confidence: number }> {
    const classificationPrompt = `Classify the following text into one of these categories: ${categories.join(', ')}
Text: "${text}"

Respond with only the category name.`;

    try {
      const response = await this.generate(classificationPrompt, {
        temperature: 0.1, // Very low temperature for classification
      });

      const category = response.trim().toLowerCase();
      const matched = categories.find(c => c.toLowerCase() === category);

      return {
        category: matched || categories[0],
        confidence: matched ? 0.95 : 0.5,
      };
    } catch (error) {
      console.error('Error classifying text:', error);
      return { category: categories[0], confidence: 0 };
    }
  }

  /**
   * Summarize text
   * Used to create concise insight summaries
   */
  async summarize(text: string, maxLength: number = 200): Promise<string> {
    const summaryPrompt = `Summarize the following text in ${maxLength} characters or less:
"${text}"

Provide only the summary, no additional text.`;

    try {
      const response = await this.generate(summaryPrompt, {
        temperature: 0.5,
      });
      return response.trim();
    } catch (error) {
      console.error('Error summarizing text:', error);
      return text.substring(0, maxLength);
    }
  }

  /**
   * Generate insights based on data context
   * Uses few-shot learning to generate business-relevant insights
   */
  async generateInsights(
    dataContext: string,
    queryContext: string
  ): Promise<string[]> {
    const insightPrompt = `Based on the following data analysis context, generate 3-5 key business insights:

Data Context:
${dataContext}

Query Context:
${queryContext}

Return ONLY a JSON array of insight strings, no additional text.
Example: ["Insight 1", "Insight 2", "Insight 3"]`;

    try {
      const response = await this.generate(insightPrompt, {
        temperature: 0.6,
      });

      // Parse JSON array response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return [response.trim()];
    } catch (error) {
      console.error('Error generating insights:', error);
      return [];
    }
  }

  /**
   * Semantic similarity comparison using cosine similarity
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Find most similar text from a list
   */
  async findMostSimilar(
    query: string,
    candidates: string[]
  ): Promise<{ text: string; similarity: number }> {
    try {
      const queryEmbedding = await this.embed(query);
      const candidateEmbeddings = await this.embedBatch(candidates);

      let maxSimilarity = -1;
      let bestMatch = candidates[0];

      candidateEmbeddings.forEach((embedding, index) => {
        const similarity = LLMClient.cosineSimilarity(queryEmbedding, embedding);
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          bestMatch = candidates[index];
        }
      });

      return {
        text: bestMatch,
        similarity: Math.max(0, maxSimilarity),
      };
    } catch (error) {
      console.error('Error finding similar text:', error);
      return {
        text: candidates[0],
        similarity: 0,
      };
    }
  }

  /**
   * Handle API errors
   */
  private handleError(operation: string, error: unknown): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error(`LLM ${operation} error:`, {
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        message: axiosError.message,
      });
    } else {
      console.error(`LLM ${operation} error:`, error);
    }
  }
}

export { LLMClient, OllamaGenerateResponse, OllamaEmbeddingResponse };
export default new LLMClient();
