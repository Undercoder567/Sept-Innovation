# Nomic Embed Text Model Setup for Sept Innovation

## Overview

Nomic Embed Text is a semantic embedding model used by Sept Innovation for:
- **Text Embeddings** - Converting text to dense vectors (768 dimensions)
- **Semantic Search** - Finding semantically similar queries and data
- **Query Similarity** - Matching incoming queries to cached results
- **Document Clustering** - Grouping related data insights

## Model Specifications

| Property | Value |
|----------|-------|
| **Model Name** | nomic-embed-text |
| **Model Size** | 274MB |
| **Memory Required** | 500MB |
| **Output Dimension** | 768 |
| **Context Window** | 2,048 tokens |
| **Max Sequence Length** | 2,048 tokens |
| **Architecture** | Transformer (nomic.ai) |
| **License** | Open Source (Apache 2.0) |
| **Provider** | Nomic.ai |

## Installation

### Prerequisites
- **Ollama** installed and running
- **300MB disk space** for the model
- **500MB RAM** available
- **Internet connection** for initial download

### Step-by-Step Installation

#### 1. Install Ollama (if not already done)
```bash
# Download from https://ollama.ai or use package manager
```

#### 2. Start Ollama Server
```bash
ollama serve
```

#### 3. Pull Nomic Embed Text Model
```bash
ollama pull nomic-embed-text

# Expected output:
# pulling manifest
# pulling 91efbd6e4e3c...
# verifying sha256 digest
# writing manifest
# success
```

#### 4. Verify Installation
```bash
ollama list

# Expected output:
# NAME                ID              SIZE      MODIFIED
# nomic-embed-text    91efbd6e4e3c    274MB     2 minutes ago
# llama2              3b4b1f5b7c5c    3.8GB     1 hour ago
```

#### 5. Test the Model
```bash
curl http://localhost:11434/api/embeddings \
  -d '{
    "model": "nomic-embed-text",
    "prompt": "What are your top selling products?"
  }'

# Expected: 768-dimensional embedding vector
```

## Configuration

The embedding model is configured in `ollama-config.yaml`:

```yaml
embeddings:
  name: "nomic-embed-text"
  displayName: "Nomic Embed Text"
  embeddingDimension: 768
  parameters:
    temperature: 0.0
    numCtx: 2048
```

## Usage Examples

### 1. Generate Query Embedding
```typescript
async function embedQuery(query: string): Promise<number[]> {
  const response = await axios.post(
    'http://localhost:11434/api/embeddings',
    {
      model: 'nomic-embed-text',
      prompt: query
    }
  );
  return response.data.embedding;  // 768-dimensional vector
}

// Usage
const embedding = await embedQuery("Show top 10 products by revenue");
// Result: [0.123, -0.456, 0.789, ..., 0.234] (768 values)
```

### 2. Semantic Similarity (Cosine Distance)
```typescript
function cosineSimilarity(vec1: number[], vec2: number[]): number {
  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitude1 * magnitude2);
}

const embedding1 = await embedQuery("Top products by revenue");
const embedding2 = await embedQuery("Best selling items");
const similarity = cosineSimilarity(embedding1, embedding2);
// Result: 0.87 (highly similar)
```

### 3. Query Caching with Similarity
```typescript
async function findCachedQuery(query: string, threshold = 0.85) {
  const currentEmbedding = await embedQuery(query);
  
  for (const cached of queryCache) {
    const similarity = cosineSimilarity(
      currentEmbedding,
      cached.embedding
    );
    
    if (similarity > threshold) {
      return cached.results;  // Found similar cached query
    }
  }
  
  return null;  // No similar queries found
}
```

### 4. Batch Embeddings
```typescript
async function embedBatch(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  for (const text of texts) {
    const embedding = await embedQuery(text);
    embeddings.push(embedding);
  }
  
  return embeddings;
}

// Usage
const texts = [
  "Revenue by region",
  "Top customers this month",
  "Sales trends over time"
];
const embeddings = await embedBatch(texts);
```

### 5. Document Clustering
```typescript
async function clusterQueries(queries: string[], k = 3) {
  // Get embeddings for all queries
  const embeddings = await embedBatch(queries);
  
  // K-means clustering
  const clusters = kMeansClustering(embeddings, k);
  
  // Group original queries by cluster
  const grouped = new Map<number, string[]>();
  clusters.forEach((cluster, index) => {
    if (!grouped.has(cluster)) {
      grouped.set(cluster, []);
    }
    grouped.get(cluster)!.push(queries[index]);
  });
  
  return grouped;
}

// Usage
const results = await clusterQueries([
  "Total revenue",
  "Sum of sales",
  "Customer count",
  "Number of users",
  "Monthly growth"
]);
// Result:
// Cluster 0: ["Total revenue", "Sum of sales"]
// Cluster 1: ["Customer count", "Number of users"]
// Cluster 2: ["Monthly growth"]
```

## Performance Characteristics

### Response Times
- **Single Embedding**: 50-150ms
- **Batch (10 texts)**: 500ms-1s
- **Similarity Search (1000 vectors)**: 1-2 seconds

### Memory Usage
- **Idle**: 300MB disk + 200MB RAM
- **Active Embedding**: 300MB RAM
- **Batch Processing**: 400-500MB RAM

### Accuracy
- **Semantic Similarity**: 90%+ accuracy for queries
- **Duplicate Detection**: 95%+ accuracy
- **Language Support**: English (optimized), multilingual capable

## Best Practices

### 1. Query Normalization
```typescript
function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[?!.]+$/, '');  // Remove trailing punctuation
}

// Before embedding
const normalized = normalizeQuery(userQuery);
const embedding = await embedQuery(normalized);
```

### 2. Similarity Thresholding
```typescript
// Conservative (high precision): Find very similar queries
const threshold = 0.90;

// Moderate (balanced): Find reasonably similar queries
const threshold = 0.85;

// Aggressive (high recall): Find loosely related queries
const threshold = 0.75;

// Usage
if (similarity > threshold) {
  return cachedResult;
}
```

### 3. Batch Processing
```typescript
// ✅ Efficient: Process multiple at once
const embeddings = await embedBatch(queries);

// ❌ Inefficient: One at a time in loop
for (const query of queries) {
  const embedding = await embedQuery(query);
}
```

### 4. Caching Embeddings
```typescript
// Cache embeddings to avoid re-computing
const embeddingCache = new Map<string, number[]>();

async function getEmbedding(query: string): Promise<number[]> {
  if (embeddingCache.has(query)) {
    return embeddingCache.get(query)!;
  }
  
  const embedding = await embedQuery(query);
  embeddingCache.set(query, embedding);
  return embedding;
}
```

## Integration with Query Caching

### Cached Query Lookup Strategy
```typescript
class SmartQueryCache {
  private cache: Map<string, QueryResult> = new Map();
  private embeddings: Map<string, number[]> = new Map();
  private similarityThreshold = 0.85;

  async getCachedResult(query: string): Promise<QueryResult | null> {
    // 1. Exact match first (fastest)
    if (this.cache.has(query)) {
      return this.cache.get(query)!;
    }

    // 2. Semantic similarity search
    const embedding = await embedQuery(query);
    let bestMatch: { similarity: number; result: QueryResult } | null = null;

    for (const [cached, result] of this.cache) {
      const cachedEmbedding = this.embeddings.get(cached)!;
      const similarity = cosineSimilarity(embedding, cachedEmbedding);

      if (similarity > this.similarityThreshold) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { similarity, result };
        }
      }
    }

    return bestMatch?.result || null;
  }

  async cacheQuery(query: string, result: QueryResult): Promise<void> {
    const embedding = await embedQuery(query);
    this.cache.set(query, result);
    this.embeddings.set(query, embedding);
  }
}
```

## Comparison with Alternatives

| Model | Size | Speed | Quality | Dimension | Memory |
|-------|------|-------|---------|-----------|--------|
| **nomic-embed-text** | 274MB | Fast | Excellent | 768 | 500MB |
| all-MiniLM-L6-v2 | 22MB | Very Fast | Good | 384 | 100MB |
| all-mpnet-base-v2 | 438MB | Medium | Excellent | 768 | 600MB |
| UAE-Large-V1 | 1.3GB | Slow | Excellent | 1024 | 1.5GB |

**Nomic Embed Text is optimal for:**
- ✅ Semantic search and similarity
- ✅ Query caching and deduplication
- ✅ Balanced performance vs quality
- ✅ Local-only deployments
- ✅ Fast inference (100ms)

## Advanced Usage

### Dimension Reduction (if needed)
```typescript
// Reduce 768 dimensions to 256 using PCA
function reduceDimensions(embedding: number[], targetDim = 256): number[] {
  // Simplified: take first N dimensions
  // For production, use proper PCA implementation
  return embedding.slice(0, targetDim);
}

// Trade-off: Smaller vectors, faster similarity, less precision
```

### Re-ranking Results
```typescript
async function reRankResults(
  query: string,
  candidates: string[]
): Promise<Array<{ text: string; score: number }>> {
  const queryEmbedding = await embedQuery(query);
  const scores = [];

  for (const candidate of candidates) {
    const candEmbedding = await embedQuery(candidate);
    const similarity = cosineSimilarity(queryEmbedding, candEmbedding);
    scores.push({ text: candidate, score: similarity });
  }

  return scores.sort((a, b) => b.score - a.score);
}
```

## Monitoring

### Embedding Quality Checks
```typescript
// Check if embeddings are valid
function validateEmbedding(embedding: number[]): boolean {
  return (
    embedding.length === 768 &&
    embedding.every(val => typeof val === 'number') &&
    !embedding.some(val => isNaN(val))
  );
}

// Check embedding magnitude (should be ~1.0 for normalized embeddings)
function checkMagnitude(embedding: number[]): number {
  const sum = embedding.reduce((acc, val) => acc + val * val, 0);
  return Math.sqrt(sum);
}
```

### Cache Performance
```typescript
class CacheMetrics {
  hits = 0;
  misses = 0;
  avgSimilarity = 0;

  getHitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  // Monitor over time for optimization
  report(): string {
    return `Cache Hit Rate: ${(this.getHitRate() * 100).toFixed(2)}% (${this.hits}/${this.hits + this.misses})`;
  }
}
```

## Troubleshooting

### Issue: Connection Refused
```bash
# Verify Ollama is running
curl http://localhost:11434/api/health

# Restart Ollama
ollama serve
```

### Issue: Slow Embeddings
```bash
# Check if CPU is maxed
# Reduce batch size
# Use dimension reduction
```

### Issue: Low Similarity Scores
```typescript
// Possible causes:
// 1. Queries are semantically different (expected)
// 2. Query normalization needed
// 3. Threshold too high

// Solution: Adjust threshold or normalize queries
```

## References

- [Nomic AI Website](https://www.nomic.ai)
- [Embedding Model Comparison](https://huggingface.co/spaces/mteb/leaderboard)
- [Cosine Similarity](https://en.wikipedia.org/wiki/Cosine_similarity)
- [Semantic Search Guide](https://www.sbert.net)
