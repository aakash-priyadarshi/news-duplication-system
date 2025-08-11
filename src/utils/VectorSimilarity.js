const OpenAI = require('openai');
const logger = require('./logger');
const config = require('../config/config');

class VectorSimilarity {
  constructor() {
    this.openai = null;
    this.cohere = null;
    this.initialized = false;
    this.embeddingCache = new Map();
    this.maxCacheSize = 1000;
  }

  async initialize() {
    try {
      // Initialize OpenAI for embeddings if available
      if (config.ai.openai.apiKey && config.ai.openai.apiKey !== 'your_openai_api_key_here') {
        this.openai = new OpenAI({
          apiKey: config.ai.openai.apiKey,
        });
        logger.info('✅ OpenAI embeddings initialized');
      }

      // Initialize Cohere if available
      if (config.ai.cohere.apiKey && config.ai.cohere.apiKey !== 'your_cohere_api_key_here') {
        const { CohereClient } = require('cohere-ai');
        this.cohere = new CohereClient({
          token: config.ai.cohere.apiKey,
        });
        logger.info('✅ Cohere embeddings initialized');
      }

      this.initialized = true;
      logger.info('🔢 Vector similarity service initialized');
      
    } catch (error) {
      logger.warn('⚠️  Vector similarity initialization failed:', error.message);
      this.initialized = false;
    }
  }

  async generateEmbedding(text) {
    if (!text || typeof text !== 'string') {
      return null;
    }

    // Check cache first
    const cacheKey = this.generateCacheKey(text);
    if (this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey);
    }

    try {
      let embedding = null;

      // Try OpenAI first (usually better quality)
      if (this.openai) {
        embedding = await this.generateOpenAIEmbedding(text);
      } 
      // Fall back to Cohere
      else if (this.cohere) {
        embedding = await this.generateCohereEmbedding(text);
      }
      // Use mock embedding if no service available
      else {
        embedding = this.generateMockEmbedding(text);
      }

      // Cache the result
      if (embedding) {
        this.cacheEmbedding(cacheKey, embedding);
      }

      return embedding;

    } catch (error) {
      logger.warn('⚠️  Embedding generation failed:', error.message);
      return this.generateMockEmbedding(text);
    }
  }

  async generateOpenAIEmbedding(text) {
    // Truncate text if too long (OpenAI has token limits)
    const truncatedText = this.truncateText(text, 8000);
    
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: truncatedText,
    });

    return response.data[0].embedding;
  }

  async generateCohereEmbedding(text) {
    // Truncate text if too long
    const truncatedText = this.truncateText(text, 4000);
    
    const response = await this.cohere.embed({
      model: config.ai.cohere.model,
      texts: [truncatedText],
      inputType: 'search_document'
    });

    return response.embeddings[0];
  }

  generateMockEmbedding(text) {
    // Create a simple hash-based mock embedding
    const dimension = config.deduplication.vectorDimension;
    const embedding = new Array(dimension);
    
    // Use text characteristics to generate consistent vectors
    const words = text.toLowerCase().split(/\s+/);
    const charCodes = text.split('').map(char => char.charCodeAt(0));
    
    for (let i = 0; i < dimension; i++) {
      // Combine multiple text features for each dimension
      let value = 0;
      
      // Word-based features
      if (words[i % words.length]) {
        value += words[i % words.length].length * 0.1;
      }
      
      // Character-based features
      if (charCodes[i % charCodes.length]) {
        value += Math.sin(charCodes[i % charCodes.length] / 127.0) * 0.5;
      }
      
      // Text length influence
      value += (text.length % 100) / 100.0 * 0.2;
      
      // Position-based variation
      value += Math.cos(i / dimension * Math.PI) * 0.3;
      
      embedding[i] = value;
    }
    
    // Normalize the vector
    return this.normalizeVector(embedding);
  }

  calculateSimilarity(vector1, vector2) {
    if (!vector1 || !vector2 || vector1.length !== vector2.length) {
      return 0;
    }

    return this.cosineSimilarity(vector1, vector2);
  }

  cosineSimilarity(vectorA, vectorB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  euclideanDistance(vectorA, vectorB) {
    let sum = 0;
    for (let i = 0; i < vectorA.length; i++) {
      const diff = vectorA[i] - vectorB[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  manhattanDistance(vectorA, vectorB) {
    let sum = 0;
    for (let i = 0; i < vectorA.length; i++) {
      sum += Math.abs(vectorA[i] - vectorB[i]);
    }
    return sum;
  }

  normalizeVector(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    
    return vector.map(val => val / magnitude);
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    
    // Try to truncate at word boundaries
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    return lastSpace > maxLength * 0.8 ? truncated.substring(0, lastSpace) : truncated;
  }

  generateCacheKey(text) {
    // Create a hash of the text for caching
    let hash = 0;
    if (text.length === 0) return hash.toString();
    
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return hash.toString();
  }

  cacheEmbedding(key, embedding) {
    // Implement LRU cache
    if (this.embeddingCache.size >= this.maxCacheSize) {
      // Remove oldest entry
      const firstKey = this.embeddingCache.keys().next().value;
      this.embeddingCache.delete(firstKey);
    }
    
    this.embeddingCache.set(key, embedding);
  }

  // Batch processing for multiple texts
  async generateBatchEmbeddings(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    const embeddings = [];
    const batchSize = 10; // Process in smaller batches to avoid rate limits
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchPromises = batch.map(text => this.generateEmbedding(text));
      
      try {
        const batchResults = await Promise.all(batchPromises);
        embeddings.push(...batchResults);
        
        // Add small delay between batches to respect rate limits
        if (i + batchSize < texts.length) {
          await this.delay(100);
        }
      } catch (error) {
        logger.warn(`Batch embedding failed for batch ${i / batchSize + 1}:`, error.message);
        // Add null placeholders for failed batch
        embeddings.push(...new Array(batch.length).fill(null));
      }
    }
    
    return embeddings;
  }

  // Find most similar vectors from a collection
  findMostSimilar(queryVector, candidateVectors, topK = 5) {
    if (!queryVector || !candidateVectors || candidateVectors.length === 0) {
      return [];
    }

    const similarities = candidateVectors.map((vector, index) => ({
      index,
      similarity: this.calculateSimilarity(queryVector, vector.embedding || vector),
      vector: vector
    }));

    return similarities
      .filter(item => item.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // Cluster similar vectors using simple k-means
  async clusterVectors(vectors, numClusters = 5) {
    if (!vectors || vectors.length === 0) return [];
    if (vectors.length <= numClusters) {
      return vectors.map((vector, index) => ({ cluster: index, vectors: [vector] }));
    }

    try {
      // Initialize centroids randomly
      const centroids = this.initializeCentroids(vectors, numClusters);
      const maxIterations = 10;
      
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        // Assign vectors to closest centroids
        const clusters = this.assignToClusters(vectors, centroids);
        
        // Update centroids
        const newCentroids = this.updateCentroids(clusters);
        
        // Check for convergence
        if (this.centroidsConverged(centroids, newCentroids)) {
          break;
        }
        
        centroids.splice(0, centroids.length, ...newCentroids);
      }
      
      return this.assignToClusters(vectors, centroids);
      
    } catch (error) {
      logger.warn('Vector clustering failed:', error.message);
      return [{ cluster: 0, vectors }]; // Return all in one cluster as fallback
    }
  }

  initializeCentroids(vectors, numClusters) {
    const centroids = [];
    const dimension = vectors[0].length;
    
    for (let i = 0; i < numClusters; i++) {
      // Use random vectors from the dataset as initial centroids
      const randomIndex = Math.floor(Math.random() * vectors.length);
      centroids.push([...vectors[randomIndex]]);
    }
    
    return centroids;
  }

  assignToClusters(vectors, centroids) {
    const clusters = centroids.map((_, index) => ({ cluster: index, vectors: [] }));
    
    for (const vector of vectors) {
      let bestCluster = 0;
      let bestSimilarity = -1;
      
      for (let i = 0; i < centroids.length; i++) {
        const similarity = this.cosineSimilarity(vector, centroids[i]);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestCluster = i;
        }
      }
      
      clusters[bestCluster].vectors.push(vector);
    }
    
    return clusters;
  }

  updateCentroids(clusters) {
    const newCentroids = [];
    
    for (const cluster of clusters) {
      if (cluster.vectors.length === 0) {
        // Keep the old centroid if no vectors assigned
        newCentroids.push(new Array(config.deduplication.vectorDimension).fill(0));
        continue;
      }
      
      const dimension = cluster.vectors[0].length;
      const centroid = new Array(dimension).fill(0);
      
      // Calculate mean of all vectors in cluster
      for (const vector of cluster.vectors) {
        for (let i = 0; i < dimension; i++) {
          centroid[i] += vector[i];
        }
      }
      
      // Normalize by number of vectors
      for (let i = 0; i < dimension; i++) {
        centroid[i] /= cluster.vectors.length;
      }
      
      newCentroids.push(centroid);
    }
    
    return newCentroids;
  }

  centroidsConverged(oldCentroids, newCentroids, threshold = 0.001) {
    for (let i = 0; i < oldCentroids.length; i++) {
      const distance = this.euclideanDistance(oldCentroids[i], newCentroids[i]);
      if (distance > threshold) {
        return false;
      }
    }
    return true;
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get embedding statistics
  getEmbeddingStats() {
    return {
      cacheSize: this.embeddingCache.size,
      maxCacheSize: this.maxCacheSize,
      providersAvailable: this.getAvailableProviders(),
      isInitialized: this.initialized
    };
  }

  getAvailableProviders() {
    const providers = [];
    if (this.openai) providers.push('openai');
    if (this.cohere) providers.push('cohere');
    if (providers.length === 0) providers.push('mock');
    return providers;
  }

  // Clear cache (useful for memory management)
  clearCache() {
    this.embeddingCache.clear();
    logger.info('Embedding cache cleared');
  }

  // Get cache hit rate for monitoring
  getCacheStats() {
    return {
      size: this.embeddingCache.size,
      maxSize: this.maxCacheSize,
      memoryUsage: this.estimateCacheMemoryUsage()
    };
  }

  estimateCacheMemoryUsage() {
    // Rough estimate: each embedding is ~1.5KB (384 dimensions * 4 bytes)
    const avgEmbeddingSize = config.deduplication.vectorDimension * 4;
    return this.embeddingCache.size * avgEmbeddingSize;
  }

  // Check if service is available
  isAvailable() {
    return this.initialized;
  }
}

module.exports = VectorSimilarity;