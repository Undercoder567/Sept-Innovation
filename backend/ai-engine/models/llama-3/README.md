# Llama 2 Model Setup for Sept Innovation

## Overview

Llama 2 is the primary language model used by Sept Innovation for:
- **SQL Query Generation** - Converting natural language to parameterized SQL
- **Intent Classification** - Understanding user analytical intent
- **Data Interpretation** - Explaining results in business terms
- **Insight Generation** - Creating actionable business insights

## Model Specifications

| Property | Value |
|----------|-------|
| **Model Name** | llama2 |
| **Model Size** | 7B (7 Billion parameters) |
| **Memory Required** | 4GB RAM |
| **Disk Space** | 3.8GB |
| **Context Window** | 4,096 tokens |
| **Architecture** | Transformer-based |
| **License** | Open Source (Llama Community License) |
| **Provider** | Meta AI |

## Installation

### Prerequisites
- **Ollama** installed and running (https://ollama.ai)
- **4GB minimum RAM** available
- **3.8GB disk space** for the model
- **Internet connection** for initial download

### Step-by-Step Installation

#### 1. Install Ollama
```bash
# Windows: Download from https://ollama.ai/download

# Linux
curl https://ollama.ai/install.sh | sh

# macOS
brew install ollama
```

#### 2. Start Ollama Server
```bash
# Start the Ollama server
ollama serve

# Expected output:
# Listening on [::]:11434
```

#### 3. Pull Llama 2 Model
In a new terminal window:
```bash
ollama pull llama2

# Expected output:
# pulling manifest
# pulling 3b4b1f5b7c5c...
# verifying sha256 digest
# writing manifest
# success
```

#### 4. Verify Installation
```bash
# Check if model is installed
ollama list

# Expected output:
# NAME        ID              SIZE    MODIFIED
# llama2      3b4b1f5b7c5c    3.8GB   2 minutes ago
```

#### 5. Test the Model
```bash
# Quick test
curl http://localhost:11434/api/generate \
  -d '{
    "model": "llama2",
    "prompt": "SELECT * FROM",
    "stream": false
  }'

# Expected: SQL completion response
```

## Configuration

The model is configured in `ollama-config.yaml` with these key parameters:

```yaml
temperature: 0.2          # Low = deterministic SQL
topK: 40                  # Diversity control
topP: 0.9                 # Nucleus sampling
numPredict: 512           # Max output tokens
numCtx: 4096              # Context window
```

### Tuning Parameters

**For SQL Generation (deterministic):**
```yaml
temperature: 0.1-0.3      # Lower = more consistent
topK: 20-40               # Restrict to top K options
topP: 0.8-0.95            # Nucleus sampling
```

**For Creative Insights (more diverse):**
```yaml
temperature: 0.6-0.8      # Higher = more creative
topK: 50-100              # More diverse options
topP: 0.9-0.95            # Allow more variety
```

## Usage Examples

### 1. SQL Generation
```typescript
const prompt = `
Generate a PostgreSQL query to find top 5 products by revenue:
User Query: "Show me the top 5 products by revenue this quarter"
Schema: products(id, name, price), sales(product_id, amount, date)
`;

const response = await axios.post('http://localhost:11434/api/generate', {
  model: 'llama2',
  prompt: prompt,
  stream: false,
  temperature: 0.2
});
```

### 2. Intent Classification
```typescript
const prompt = `Classify intent: "Show sales trend over the last 6 months"
Options: TREND, COMPARISON, AGGREGATION, TOP_BOTTOM
Response format: INTENT: [choice]`;

const response = await axios.post('http://localhost:11434/api/generate', {
  model: 'llama2',
  prompt: prompt,
  stream: false,
  temperature: 0.0  // Deterministic
});
```

### 3. Data Interpretation
```typescript
const prompt = `
Interpret these results in business terms:
Query: Revenue by region
Results:
- North America: $542,000 (+15% MoM)
- Europe: $389,000 (+8% MoM)
- Asia Pacific: $267,000 (+22% MoM)

Insight:
`;

const response = await axios.post('http://localhost:11434/api/generate', {
  model: 'llama2',
  prompt: prompt,
  stream: false,
  temperature: 0.6
});
```

## Performance Characteristics

### Response Times
- **SQL Generation**: 2-5 seconds (512 tokens)
- **Intent Classification**: 0.5-1 second (50 tokens)
- **Data Interpretation**: 1-3 seconds (200 tokens)
- **Embeddings** (nomic-embed-text): 100-200ms

### Memory Usage
- **Idle**: 2GB RAM
- **Active Query**: 3.5-4GB RAM
- **Peak Load**: 4GB RAM

### Throughput
- **Sequential Requests**: 12-30 requests/minute
- **Batch Processing**: Up to 5 concurrent requests (with 16GB RAM)

## Best Practices

### 1. Prompt Engineering
```typescript
// ✅ Good: Specific, structured
const prompt = `
Task: Generate PostgreSQL query
Intent: Find top customers by revenue
Schema: customers(id, name), orders(customer_id, amount)
Constraints: Use parameterized queries, add comments
Query:
`;

// ❌ Bad: Vague, no structure
const prompt = "Write a query about customers";
```

### 2. Temperature Selection
```typescript
// SQL generation (deterministic)
temperature: 0.1-0.2

// Intent classification (deterministic)
temperature: 0.0

// Explanations (balanced)
temperature: 0.5

// Creative insights (diverse)
temperature: 0.7-0.8
```

### 3. Context Optimization
```typescript
// ✅ Include relevant context
const prompt = `
Schema: ${schemaContext}
Business Rules: ${businessRules}
Recent Examples: ${examples}
User Query: ${query}
`;

// ❌ Avoid irrelevant context
const prompt = `Generate SQL for: ${query}`;
```

### 4. Error Handling
```typescript
try {
  const response = await llmClient.generate(prompt);
  if (!response || response.includes('ERROR')) {
    // Fallback to template-based approach
    return generateBasicSQL(query);
  }
  return parseResponse(response);
} catch (error) {
  logger.warn('LLM failed, using fallback', error);
  return generateBasicSQL(query);
}
```

## Optimization Tips

### Reduce Memory Usage
```yaml
# Option 1: Use quantized model
ollama pull llama2:7b-q4

# Option 2: Reduce context window
numCtx: 2048  # Instead of 4096

# Option 3: Enable unloading
keep_alive: 0  # Unload after each request
```

### Improve Response Speed
```yaml
# Reduce output tokens
numPredict: 256  # Instead of 512

# Increase threads (if available)
numThread: 8  # More CPU cores

# Enable GPU acceleration
gpuAcceleration: true  # If CUDA available
```

### Improve Quality
```yaml
# Lower temperature for consistency
temperature: 0.1

# Smaller top-k for focused sampling
topK: 20

# Better system prompt
systemPrompt: "You are an expert SQL generator..."
```

## Monitoring

### Health Check
```bash
curl http://localhost:11434/api/health

# Expected: OK
```

### Model Status
```bash
ollama list

# Shows: Model name, ID, size, last modified
```

### Performance Metrics
```bash
# Monitor response time and token generation
curl -X POST http://localhost:11434/api/generate \
  -d '{"model":"llama2","prompt":"test","stream":false}' \
  | grep -E 'eval_count|eval_duration'
```

## Troubleshooting

### Issue: Connection Refused
```bash
# Check if Ollama is running
curl http://localhost:11434/api/health

# Restart Ollama
ollama serve
```

### Issue: Out of Memory
```bash
# Check available memory
free -h  # Linux
Get-PhysicalMemory | Select-Object -ExpandProperty Size  # Windows

# Solutions:
# 1. Close other applications
# 2. Use lighter model: ollama pull mistral
# 3. Reduce context: numCtx: 2048
```

### Issue: Slow Responses
```bash
# Check if CPU is maxed out
top  # Linux
Get-Process ollama | Select -ExpandProperty ProcessorAffinity  # Windows

# Solutions:
# 1. Enable GPU acceleration
# 2. Reduce numPredict
# 3. Lower temperature
```

### Issue: Poor SQL Quality
```bash
# Improve prompt with:
# 1. More specific instructions
# 2. Schema examples
# 3. Desired query examples
# 4. Constraints and rules

# Lower temperature to 0.1-0.2 for consistency
# Increase numPredict to 512 for longer queries
```

## Advanced: Model Fine-tuning

For production deployments with specific needs, you can fine-tune Llama 2:

```bash
# Export training data
ollama export llama2 model.safetensors

# Fine-tune (requires more advanced setup)
# See: https://llama.meta.com/docs/getting-started

# Create custom model
ollama create custom-llama2 -f ./Modelfile
```

## Alternatives

If Llama 2 doesn't meet your needs:

| Model | Size | Speed | Quality | Memory |
|-------|------|-------|---------|--------|
| **llama2** | 7B | Medium | High | 4GB |
| mistral | 7B | Fast | Good | 3GB |
| neural-chat | 7B | Fast | Good | 3GB |
| dolphin-mixtral | 8x7B | Slow | Excellent | 16GB |

## References

- [Ollama Documentation](https://ollama.ai/library)
- [Llama 2 Paper](https://arxiv.org/abs/2307.09288)
- [Meta Llama 2 License](https://github.com/facebookresearch/llama/blob/main/LICENSE)
- [Sept Innovation Architecture](../docs/architecture.md)

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review `ollama-config.yaml` for configuration
3. Enable debug logging: `level: "debug"`
4. Check Ollama logs for detailed errors
